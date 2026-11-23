import unittest
from promotion_ocr import groups, cached_page, crop_cache_key
import hashlib
import io
import json
import os
import tempfile
import urllib.error
from pathlib import Path
from threading import Event
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

    def test_reads_crop_and_full_page_with_one_ocr_engine(self):
        import promotion_ocr

        class Stream(io.StringIO):
            def reconfigure(self, **kwargs):
                pass

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        engine = MagicMock(return_value=([], None))
        with tempfile.TemporaryDirectory() as directory:
            region = {'id': 'product', 'sourceUrl': 'leaflet', 'imageUrl': 'page', 'area': [0, 0, .5, .5]}
            request = {'cacheDirectory': directory, 'items': [region],
                       'pages': [{**region, 'id': 'page', 'area': [0, 0, 1, 1]}]}
            output = Stream()
            with patch.object(promotion_ocr, 'cached_page', return_value=(image.getvalue(), False)), \
                    patch.object(promotion_ocr, 'RapidOCR', return_value=engine) as factory, \
                    patch.object(promotion_ocr.sys, 'stdin', Stream(json.dumps(request))), \
                    patch.object(promotion_ocr.sys, 'stdout', output):
                promotion_ocr.main()
            results = json.loads(output.getvalue())
            self.assertEqual([row['id'] for row in results], ['product', 'page'])
            self.assertEqual([row['bbox'] for row in results], [[0, 0, 20, 20], [0, 0, 40, 40]])
            factory.assert_called_once()
            self.assertEqual(engine.call_count, 2)

    def test_worker_reuses_engine_across_requests(self):
        import promotion_ocr

        class Stream(io.StringIO):
            def reconfigure(self, **kwargs):
                pass

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        engine = MagicMock(return_value=([], None))
        with tempfile.TemporaryDirectory() as directory:
            first = {'id': 'first', 'sourceUrl': 'leaflet', 'imageUrl': 'page', 'area': [0, 0, .5, .5]}
            second = {**first, 'id': 'second', 'area': [0, 0, 1, 1]}
            requests = [json.dumps({'cacheDirectory': directory, 'items': [region]})
                        for region in (first, second)]
            output = Stream()
            with patch.dict(os.environ, {'OCR_THREADS': '4'}), \
                    patch.object(promotion_ocr, 'cached_page', return_value=(image.getvalue(), False)), \
                    patch.object(promotion_ocr, 'RapidOCR', return_value=engine) as factory, \
                    patch.object(promotion_ocr.sys, 'stdin', Stream('\n'.join(requests))), \
                    patch.object(promotion_ocr.sys, 'stdout', output):
                promotion_ocr.serve()
            results = [json.loads(row)[0] for row in output.getvalue().splitlines()]
            self.assertEqual([row['id'] for row in results], ['first', 'second'])
            factory.assert_called_once_with(
                intra_op_num_threads=4, inter_op_num_threads=2, det_limit_side_len=1600,
            )
            self.assertEqual(engine.call_count, 2)

    def test_page_limit_reuses_crop_cache_but_not_full_resolution_page_cache(self):
        import promotion_ocr

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        original = lambda size: ('original', size)
        engine = MagicMock()
        engine.text_det.get_preprocess = original
        engine.side_effect = lambda crop: ([], None)
        with tempfile.TemporaryDirectory() as directory:
            crop = {'id': 'offer', 'sourceUrl': 'leaflet',
                    'imageUrl': 'page', 'area': [0, 0, .5, .5]}
            page = {**crop, 'id': 'page', 'area': [0, 0, 1, 1]}
            request = {'cacheDirectory': directory, 'items': [crop], 'pages': [page]}
            with patch.object(promotion_ocr, 'cached_page', return_value=(image.getvalue(), True)):
                with patch.dict(os.environ, {'OCR_PAGE_MAX_SIDE': '0'}):
                    baseline, _ = promotion_ocr.read_regions(request, engine)
                with patch.dict(os.environ, {'OCR_PAGE_MAX_SIDE': '1280'}):
                    with patch.object(promotion_ocr, 'DetPreProcess', return_value='limited') as preprocess:
                        engine.side_effect = lambda crop: (
                            [] if engine.text_det.get_preprocess(1800) == 'limited' else None, None
                        )
                        limited, _ = promotion_ocr.read_regions(request, engine)
                        preprocess.assert_called_once_with(
                            1280, 'max', engine.text_det.mean, engine.text_det.std,
                        )
                    repeated, _ = promotion_ocr.read_regions(request, engine)

        self.assertEqual([row['ocrCached'] for row in baseline], [False, False])
        self.assertEqual([row['ocrCached'] for row in limited], [True, False])
        self.assertEqual([row['ocrCached'] for row in repeated], [True, True])
        self.assertIs(engine.text_det.get_preprocess, original)

    def test_reuses_page_image_and_keeps_input_order(self):
        import promotion_ocr

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        engine = MagicMock(return_value=([], None))
        region = {'id': 'a', 'sourceUrl': 'leaflet-a', 'imageUrl': 'first', 'area': [0, 0, .5, .5]}
        other = {**region, 'id': 'b', 'sourceUrl': 'leaflet-b', 'imageUrl': 'second'}
        stray = {**region, 'id': 'invalid', 'area': [0, 0, 5, 5]}
        page = {**region, 'id': 'full-page', 'area': [0, 0, 1, 1]}
        with tempfile.TemporaryDirectory() as directory:
            request = {'cacheDirectory': directory, 'items': [region, other, stray], 'pages': [page]}
            with patch.object(promotion_ocr, 'cached_page', return_value=(image.getvalue(), False)) as fetch:
                rows, _ = promotion_ocr.read_regions(request, engine)
            self.assertEqual([args.args[0] for args in fetch.call_args_list], ['first', 'second'])
            self.assertEqual([row['id'] for row in rows], ['a', 'b', 'invalid', 'full-page'])
            self.assertEqual(rows[2]['error'], 'Invalid product region')
            self.assertEqual(rows[3]['bbox'], [0, 0, 40, 40])
            self.assertTrue(rows[3]['pageCached'])
            self.assertEqual(engine.call_count, 2)

    def test_reuses_unchanged_result_without_decoding_and_rechecks_a_changed_image(self):
        import promotion_ocr

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        raw = image.getvalue()
        signature = hashlib.sha256(raw).hexdigest()
        region = {'id': 'offer', 'sourceUrl': 'leaflet', 'imageUrl': 'page',
                  'area': [0, 0, .5, .5], 'reuseImageSha256': signature}
        page = {**region, 'id': 'full-page', 'area': [0, 0, 1, 1]}
        engine = MagicMock(return_value=([], None))
        with tempfile.TemporaryDirectory() as directory:
            request = {'cacheDirectory': directory, 'items': [region], 'pages': [page]}
            with patch.object(promotion_ocr, 'cached_page', return_value=(raw, True)):
                with patch.object(promotion_ocr.Image, 'open') as decode:
                    rows, _ = promotion_ocr.read_regions(request, engine)
                    decode.assert_not_called()

                self.assertTrue(rows[0]['stateReused'])
                self.assertEqual(rows[0]['imageSha256'], signature)
                self.assertNotIn('ocrLines', rows[1])
                engine.assert_not_called()

                changed = {**region, 'reuseImageSha256': '0' * 64}
                reread, _ = promotion_ocr.read_regions({**request, 'items': [changed]}, engine)
                self.assertNotIn('stateReused', reread[0])
                self.assertIn('ocrLines', reread[1])
                self.assertEqual(engine.call_count, 2)

    def test_changed_pixels_or_dimensions_invalidate_cache(self):
        image = Image.new('RGB', (40, 40), 'red')
        changed = image.copy()
        changed.putpixel((0, 0), (0, 0, 255))
        self.assertNotEqual(crop_cache_key(image), crop_cache_key(changed))
        self.assertNotEqual(crop_cache_key(image), crop_cache_key(image.crop((0, 0, 20, 40))))

    def test_prefetches_one_page_during_ocr_and_continues_after_fetch_failure(self):
        import promotion_ocr

        image = io.BytesIO()
        Image.new('RGB', (40, 40), 'red').save(image, format='PNG')
        next_started = Event()
        requests = []

        def fetch(url, _cache):
            requests.append(url)
            if url == 'second':
                next_started.set()
                raise OSError('page unavailable')
            return image.getvalue(), False

        def recognize(_crop):
            self.assertTrue(next_started.wait(2), 'next page was not fetched during OCR')
            self.assertEqual(requests, ['first', 'second'])
            return [], None

        items = [{'id': url, 'sourceUrl': url, 'imageUrl': url, 'area': [0, 0, 1, 1]}
                 for url in ('first', 'second', 'third')]
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'OCR_PREFETCH_PAGES': '1'}), \
                    patch.object(promotion_ocr, 'cached_page', side_effect=fetch):
                rows, _ = promotion_ocr.read_regions(
                    {'cacheDirectory': directory, 'items': items}, recognize,
                )
        self.assertEqual(requests, ['first', 'second', 'third'])
        self.assertEqual([row['id'] for row in rows], ['first', 'second', 'third'])
        self.assertEqual([row.get('error') for row in rows], [None, 'page unavailable', None])


if __name__ == '__main__':
    unittest.main()
