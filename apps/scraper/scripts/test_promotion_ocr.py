import unittest
from promotion_ocr import groups, cached_page, crop_cache_key
import hashlib
import io
import json
import os
import tempfile
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch
from PIL import Image


def line(text, x, y, width=60, height=20, confidence=.99):
    return ([[x, y], [x+width, y], [x+width, y+height], [x, y+height]], text, confidence)


class GroupTests(unittest.TestCase):
    def test_reads_vertical_loyalty_label(self):
        values = groups([line('ZKARTA', 40, 110), line('LUB', 40, 125, 30),
                         line('MOJA', 114, 129), line('APKA', 40, 140, 40)])
        self.assertIn('ZKARTA LUB APKA', [row['text'] for row in values])

    def test_does_not_join_distant_product_text(self):
        values = groups([line('2+2', 10, 10), line('gratis', 500, 10)])
        self.assertNotIn('2+2 gratis', [row['text'] for row in values])

    def test_joins_nearby_free_label(self):
        values = groups([line('2+2', 10, 10), line('gratis', 75, 10)])
        self.assertIn('2+2 gratis', [row['text'] for row in values])

    def test_discards_uncertain_lines(self):
        self.assertEqual(groups([line('2+2 gratis', 10, 10, confidence=.8)]), [])


class CacheTests(unittest.TestCase):
    url = 'https://imgproxy.blix.pl/test.webp'

    def png(self, colour):
        output = io.BytesIO()
        Image.new('RGB', (20, 20), colour).save(output, format='PNG')
        return output.getvalue()

    def test_reuses_fresh_page_without_request(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            target = cache / hashlib.sha256(self.url.encode()).hexdigest()
            target.write_bytes(self.png('red'))
            opener = MagicMock(side_effect=AssertionError('Unexpected download'))
            raw, reused = cached_page(self.url, cache, opener=opener)
            self.assertTrue(reused)
            self.assertEqual(raw, target.read_bytes())
            opener.assert_not_called()

    def test_revalidates_expired_page_with_etag(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            key = hashlib.sha256(self.url.encode()).hexdigest()
            target = cache / key
            target.write_bytes(self.png('red'))
            os.utime(target, (0, 0))
            (cache / (key + '.http.json')).write_text(json.dumps({'etag': 'version-1'}))
            def opener(request, **kwargs):
                self.assertEqual(request.get_header('If-none-match'), 'version-1')
                raise urllib.error.HTTPError(self.url, 304, 'Not modified', {}, None)
            raw, reused = cached_page(self.url, cache, opener=opener, sleep=lambda _: None)
            self.assertTrue(reused)
            self.assertEqual(raw, self.png('red'))

    def test_replaces_changed_image_and_updates_validator(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            key = hashlib.sha256(self.url.encode()).hexdigest()
            target = cache / key
            target.write_bytes(self.png('red'))
            os.utime(target, (0, 0))
            response = MagicMock()
            response.__enter__.return_value = response
            response.url = self.url
            response.read.return_value = self.png('blue')
            response.headers = {'ETag': 'version-2'}
            raw, reused = cached_page(self.url, cache, opener=lambda *a, **k: response, sleep=lambda _: None)
            self.assertFalse(reused)
            self.assertEqual(raw, self.png('blue'))
            self.assertEqual(json.loads((cache / (key + '.http.json')).read_text())['etag'], 'version-2')

    def test_rejects_unexpected_image_hosts(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                cached_page('https://example.com/image.png', Path(directory))


class CropCacheTests(unittest.TestCase):
    def test_reuses_identical_crop_from_different_pages_and_positions(self):
        first = Image.new('RGB', (40, 40), 'red')
        second = Image.new('RGB', (80, 80), 'blue')
        second.paste(first, (20, 20))
        self.assertEqual(crop_cache_key(first), crop_cache_key(second.crop((20, 20, 60, 60))))

    def test_engine_runs_once_for_identical_crops_from_different_pages(self):
        import promotion_ocr
        class Stream(io.StringIO):
            def reconfigure(self, **kwargs):
                pass
        first = Image.new('RGB', (40, 40), 'red')
        second = Image.new('RGB', (80, 80), 'blue')
        second.paste(first, (20, 20))
        pages = []
        for image in [first, second]:
            output = io.BytesIO()
            image.save(output, format='PNG')
            pages.append((output.getvalue(), False))
        engine = MagicMock(return_value=([], None))
        with tempfile.TemporaryDirectory() as directory:
            request = {'cacheDirectory': directory, 'items': [
                {'id': 'a', 'sourceUrl': 'page-a', 'imageUrl': 'image-a', 'area': [0, 0, 1, 1]},
                {'id': 'b', 'sourceUrl': 'page-b', 'imageUrl': 'image-b', 'area': [.25, .25, .75, .75]},
            ]}
            output = Stream()
            with patch.object(promotion_ocr, 'cached_page', side_effect=pages), \
                    patch.object(promotion_ocr, 'RapidOCR', return_value=engine), \
                    patch.object(promotion_ocr.sys, 'stdin', Stream(json.dumps(request))), \
                    patch.object(promotion_ocr.sys, 'stdout', output):
                promotion_ocr.main()
            results = json.loads(output.getvalue())
            self.assertEqual(engine.call_count, 1)
            self.assertFalse(results[0]['ocrCached'])
            self.assertTrue(results[1]['ocrCached'])
            self.assertEqual(results[1]['sourceUrl'], 'page-b')
            self.assertNotEqual(results[0]['imageSha256'], results[1]['imageSha256'])
            self.assertNotEqual(results[0]['bbox'], results[1]['bbox'])

    def test_changed_pixels_or_dimensions_invalidate_cache(self):
        image = Image.new('RGB', (40, 40), 'red')
        changed = image.copy()
        changed.putpixel((0, 0), (0, 0, 255))
        self.assertNotEqual(crop_cache_key(image), crop_cache_key(changed))
        self.assertNotEqual(crop_cache_key(image), crop_cache_key(image.crop((0, 0, 20, 40))))


if __name__ == '__main__':
    unittest.main()
