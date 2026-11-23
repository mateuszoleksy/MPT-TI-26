import hashlib
import io
import json
import math
import sys
import time
import urllib.request
import urllib.error
import os
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from rapidocr_onnxruntime.ch_ppocr_det.utils import DetPreProcess


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


def crop_cache_key(crop, page_limit=0):
    image = crop.convert('RGB')
    version = 'rapidocr-1.4.4-crop-v2'
    if page_limit:
        version += f'-page-max-{page_limit}'
    digest = hashlib.sha256(json.dumps([image.size, version]).encode())
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


def recognize_region(engine, crop, page_limit):
    if not page_limit:
        return engine(crop)
    detector = engine.text_det
    preprocess = detector.get_preprocess
    detector.get_preprocess = lambda _: DetPreProcess(
        page_limit, 'max', detector.mean, detector.std,
    )
    try:
        return engine(crop)
    finally:
        detector.get_preprocess = preprocess


def load_pages(urls, cache):
    if len(urls) < 2 or os.environ.get('OCR_PREFETCH_PAGES') != '1':
        for url in urls:
            yield url, partial(cached_page, url, cache)
        return

    remaining = iter(urls)
    url = next(remaining)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(cached_page, url, cache)
        for next_url in remaining:
            current = pending
            pending = executor.submit(cached_page, next_url, cache)
            yield url, current.result
            url = next_url
        yield url, pending.result


def read_regions(request, engine=None):
    try:
        threads = int(os.environ.get('OCR_THREADS', '2'))
    except ValueError:
        raise ValueError('OCR_THREADS must be a positive integer') from None
    if threads < 1:
        raise ValueError('OCR_THREADS must be a positive integer')

    page_limit = os.environ.get('OCR_PAGE_MAX_SIDE', '0')
    if page_limit not in ('0', '1280'):
        raise ValueError('OCR_PAGE_MAX_SIDE must be 0 or 1280')
    page_limit = int(page_limit)

    items = request['items']
    pages = request.get('pages', [])
    if not 1 <= len(items) <= 36 or len(pages) > 36:
        raise ValueError('Choose between 1 and 36 regions and at most 36 full pages')
    cache = Path(request['cacheDirectory'])
    cache.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = 25_000_000
    regions = items + pages
    results = [None] * len(regions)
    by_image = {}
    for index, item in enumerate(regions):
        by_image.setdefault(item['imageUrl'], []).append(index)

    for image_url, load_page in load_pages(by_image, cache):
        indices = by_image[image_url]
        image_started = time.perf_counter()
        try:
            raw, page_cached = load_page()
            image_hash = hashlib.sha256(raw).hexdigest()
            pending = []
            for index in indices:
                item = regions[index]
                if index < len(items) and item.get('reuseImageSha256') == image_hash:
                    results[index] = {'id': item['id'], 'sourceUrl': item['sourceUrl'],
                                      'lines': [], 'imageSha256': image_hash, 'stateReused': True}
                else:
                    pending.append(index)
            if not any(index < len(items) for index in pending):
                for index in pending:
                    item = regions[index]
                    results[index] = {'id': item['id'], 'sourceUrl': item['sourceUrl'], 'lines': []}
                continue
            with Image.open(io.BytesIO(raw)) as source:
                if source.width * source.height > 25_000_000:
                    raise ValueError('Image dimensions exceed limit')
                image = source.convert('RGB')
        except Exception as error:
            for index in indices:
                item = regions[index]
                results[index] = {'id': item['id'], 'sourceUrl': item['sourceUrl'],
                                  'lines': [], 'error': str(error)}
            continue

        for position, index in enumerate(pending):
            item = regions[index]
            limit = page_limit if index >= len(items) else 0
            started = image_started if position == 0 else time.perf_counter()
            try:
                x1, y1, x2, y2 = item['area']
                if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in [x1, y1, x2, y2]) or not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
                    raise ValueError('Invalid product region')
                box = [round(x1*image.width), round(y1*image.height), round(x2*image.width), round(y2*image.height)]
                crop = image.crop(box)
                ocr_key = crop_cache_key(crop, limit)
                saved = cache / (ocr_key + '.json')
                legacy_key = hashlib.sha256(json.dumps([image_hash, box, 'rapidocr-1.4.4-v1']).encode()).hexdigest()
                legacy = cache / (legacy_key + '.json')
                if not limit and not saved.exists() and legacy.exists():
                    saved.write_bytes(legacy.read_bytes())
                ocr_cached = saved.exists()
                if ocr_cached:
                    lines = json.loads(saved.read_text(encoding='utf-8'))
                else:
                    if engine is None:
                        engine = RapidOCR(
                            intra_op_num_threads=threads,
                            inter_op_num_threads=2,
                            det_limit_side_len=1600,
                        )
                    found, _ = recognize_region(engine, crop, limit)
                    lines = [{'box': box, 'text': text, 'confidence': confidence} for box, text, confidence in (found or [])]
                    saved.write_text(json.dumps(lines, ensure_ascii=False), encoding='utf-8')
                grouped = groups([(row['box'], row['text'], row['confidence']) for row in lines])
                results[index] = {'id': item['id'], 'sourceUrl': item['sourceUrl'], 'lines': grouped,
                                'ocrLines': lines, 'imageSha256': image_hash, 'bbox': box,
                                'seconds': time.perf_counter()-started, 'pageCached': page_cached or position > 0,
                                'ocrCached': ocr_cached}
            except Exception as error:
                results[index] = {'id': item['id'], 'sourceUrl': item['sourceUrl'],
                                  'lines': [], 'error': str(error)}
    return results, engine


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    results, _ = read_regions(json.load(sys.stdin))
    json.dump(results, sys.stdout, ensure_ascii=False)


def serve():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    engine = None
    for line in sys.stdin:
        results, engine = read_regions(json.loads(line), engine)
        print(json.dumps(results, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    if '--worker' in sys.argv[1:]:
        serve()
    else:
        main()
