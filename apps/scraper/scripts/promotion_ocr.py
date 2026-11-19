import hashlib
import io
import json
import math
import sys
import time
import urllib.request
import urllib.error
import os
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


def groups(lines):
    accepted = []
    for box, text, confidence in lines:
        if confidence < .94:
            continue
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        accepted.append({'text': text, 'confidence': confidence,
                         'rect': [min(xs), min(ys), max(xs), max(ys)]})
    result = []
    for line in accepted:
        group = [line]
        for other in sorted(accepted, key=lambda row: row['rect'][1]):
            a, b = group[-1]['rect'], other['rect']
            overlap = min(a[2], b[2]) - max(a[0], b[0])
            vertical = b[1] > a[1] + 2 and -max(4, (a[3]-a[1]) * .4) <= b[1] - a[3] <= min(50, (a[3]-a[1]) * 1.5)
            beside = other['text'].strip().lower() == 'gratis' and abs(b[1]-a[1]) < (a[3]-a[1]) and 0 <= b[0]-a[2] <= (a[3]-a[1]) * .6
            if other not in group and len(group) < 3 and ((vertical and overlap > min(a[2]-a[0], b[2]-b[0]) * .5) or beside):
                group.append(other)
        result.append({'text': ' '.join(row['text'] for row in group),
                       'confidence': min(row['confidence'] for row in group)})
    return result


def crop_cache_key(crop):
    image = crop.convert('RGB')
    digest = hashlib.sha256(json.dumps([image.size, 'rapidocr-1.4.4-crop-v2']).encode())
    digest.update(image.tobytes())
    return digest.hexdigest()


def cached_page(url, cache, opener=urllib.request.urlopen, sleep=time.sleep, clock=time.time):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname != 'imgproxy.blix.pl' or parsed.username or parsed.password:
        raise ValueError('Unexpected image URL')
    key = hashlib.sha256(url.encode()).hexdigest()
    target = cache / key
    metadata = cache / (key + '.http.json')
    if target.exists() and clock() - target.stat().st_mtime < 6 * 60 * 60:
        return target.read_bytes(), True
    headers = {'User-Agent': 'PromoStudentCourse/0.1'}
    if target.exists() and metadata.exists():
        try:
            previous = json.loads(metadata.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            previous = {}
        for field, header in [('etag', 'If-None-Match'), ('modified', 'If-Modified-Since')]:
            if isinstance(previous.get(field), str):
                headers[header] = previous[field]
    sleep(2)
    try:
        with opener(urllib.request.Request(url, headers=headers), timeout=30) as response:
            if response.url != url:
                raise ValueError('Unexpected image redirect')
            raw = response.read(20_000_001)
            if len(raw) > 20_000_000:
                raise ValueError('Image exceeds 20 MB')
            image = Image.open(io.BytesIO(raw))
            if image.width * image.height > 25_000_000:
                raise ValueError('Image dimensions exceed limit')
            target.write_bytes(raw)
            metadata.write_text(json.dumps({'etag': response.headers.get('ETag'), 'modified': response.headers.get('Last-Modified')}), encoding='utf-8')
            return raw, False
    except urllib.error.HTTPError as error:
        if error.code != 304 or not target.exists():
            raise
        os.utime(target, None)
        return target.read_bytes(), True


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    request = json.load(sys.stdin)
    items = request['items']
    if not 1 <= len(items) <= 36:
        raise ValueError('Choose between 1 and 36 regions')
    cache = Path(request['cacheDirectory'])
    cache.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = 25_000_000
    engine = None
    results = []
    for item in items:
        started = time.perf_counter()
        try:
            raw, page_cached = cached_page(item['imageUrl'], cache)
            image = Image.open(io.BytesIO(raw))
            if image.width * image.height > 25_000_000:
                raise ValueError('Image dimensions exceed limit')
            image = image.convert('RGB')
            x1, y1, x2, y2 = item['area']
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in [x1, y1, x2, y2]) or not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
                raise ValueError('Invalid product region')
            box = [round(x1*image.width), round(y1*image.height), round(x2*image.width), round(y2*image.height)]
            crop = image.crop(box)
            image_hash = hashlib.sha256(raw).hexdigest()
            ocr_key = crop_cache_key(crop)
            saved = cache / (ocr_key + '.json')
            legacy_key = hashlib.sha256(json.dumps([image_hash, box, 'rapidocr-1.4.4-v1']).encode()).hexdigest()
            legacy = cache / (legacy_key + '.json')
            if not saved.exists() and legacy.exists():
                saved.write_bytes(legacy.read_bytes())
            ocr_cached = saved.exists()
            if ocr_cached:
                lines = json.loads(saved.read_text(encoding='utf-8'))
            else:
                if engine is None:
                    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2, det_limit_side_len=1600)
                found, _ = engine(crop)
                lines = [{'box': box, 'text': text, 'confidence': confidence} for box, text, confidence in (found or [])]
                saved.write_text(json.dumps(lines, ensure_ascii=False), encoding='utf-8')
            grouped = groups([(row['box'], row['text'], row['confidence']) for row in lines])
            results.append({'id': item['id'], 'sourceUrl': item['sourceUrl'], 'lines': grouped,
                            'ocrLines': lines, 'imageSha256': image_hash, 'bbox': box,
                            'seconds': time.perf_counter()-started, 'pageCached': page_cached, 'ocrCached': ocr_cached})
        except Exception as error:
            results.append({'id': item['id'], 'sourceUrl': item['sourceUrl'], 'lines': [], 'error': str(error)})
    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
