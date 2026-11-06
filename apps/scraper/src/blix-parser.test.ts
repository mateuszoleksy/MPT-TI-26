import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OfferSchema } from '@promo/shared';
import {
  blixLeafletUrl,
  discoverBlixLeaflets,
  parseBlixCandidates,
  todayInWarsaw,
} from './adapters/blix-parser.js';
import {
  fetchBlixCandidates,
  listBlixLeaflets,
  fetchCurrentBlixCandidates,
} from './adapters/blix.js';

const fixture = JSON.parse(
  readFileSync(new URL('./adapters/__fixtures__/blix-sample.json', import.meta.url), 'utf8'),
);
const html = (rows: unknown[]) => `<script>window.offers = ${JSON.stringify(rows)};</script>`;
const sample = () => structuredClone(fixture.offers[0]);
const parse = (rows: unknown[]) => parseBlixCandidates(html(rows), fixture.sourceUrl);

test('reads priced records', () => {
  const result = parse(fixture.offers);
  assert.equal(result.total, 3);
  assert.deepEqual(
    result.candidates.map((row) => row.reportedPrice),
    [4.99, 1.99],
  );
  assert.deepEqual(result.rejected, [{ index: 2, reason: 'Missing price' }]);
  assert.equal(result.candidates[0].pageNumber, 1);
  assert.ok(result.candidates[0].sourceUrl.endsWith('?pageNumber=1'));
});

test('keeps unknown conditions', () => {
  const row = parse(fixture.offers).candidates[1];
  assert.equal(row.requiresApp, null);
  assert.equal(row.priceBasis, 'unknown');
  assert.equal('pricePromo' in row, false);
  assert.equal(row.conditions, null);
  assert.equal(row.unit, null);
  assert.equal(row.unitQuantity, null);
  assert.equal(row.priceRegular, null);
  assert.equal(row.reviewRequired, true);
  assert.equal(OfferSchema.safeParse(row).success, false);
});

test('rejects invalid source JSON', () => {
  for (const text of [
    '<script>window.offers = [</script>',
    '<script>window.offers = run()</script>',
    '<html></html>',
    '<script>window.offers = [{bad}]</script>',
  ]) {
    assert.throws(() => parseBlixCandidates(text, fixture.sourceUrl));
  }
  assert.equal(parse([]).total, 0);
  const row = sample();
  row.name = 'Name [x] "quote" \\';
  assert.equal(parse([row]).candidates[0].name, row.name);
});

test('rejects invalid records', () => {
  const values = ['499', -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1];
  for (const price of values)
    assert.equal(parse([{ ...sample(), price }]).rejected[0].reason, 'Invalid grosze price');
  assert.equal(parse([null, [], {}, sample()]).candidates.length, 1);
});

test('validates offer dates', () => {
  const row = sample();
  row.dateStart.date = '2026-02-30 00:00:00';
  assert.equal(parse([row]).rejected[0].reason, 'Invalid calendar date');
  row.dateStart.date = '2026-11-08 00:00:00';
  assert.equal(parse([row]).rejected[0].reason, 'Reversed dates');
  row.dateStart.date = '2026-11-06 00:00:00';
  assert.equal(parse([row]).candidates[0].validFrom, '2026-11-06');
  row.dateStart.timezone = 'UTC';
  assert.equal(parse([row]).rejected[0].reason, 'Invalid Warsaw date');
});

test('handles repeated occurrences', () => {
  const row = sample();
  assert.equal(parse([row, row]).duplicates, 1);
  assert.equal(parse([row, row]).candidates.length, 1);
  assert.throws(() => parse([row, { ...row, price: 599 }]), /Conflicting occurrence/);
  const differentOccurrence = { ...row, productLeafletPageUuid: 'different-occurrence' };
  const result = parse([row, differentOccurrence]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.possibleDuplicates, 1);
});

test('validates store and source', () => {
  const row = { ...sample(), leafletId: 534102 };
  const result = parseBlixCandidates(html([row]), blixLeafletUrl('lidl', '534102'));
  assert.equal(result.candidates[0].store, 'lidl');
  assert.ok(result.candidates[0].id.startsWith('blix:lidl:534102:'));
  assert.equal(parse([row]).rejected[0].reason, 'Wrong leaflet');
  assert.equal(parse([{ ...sample(), pageNumber: -1 }]).rejected[0].reason, 'Invalid page');
  assert.equal(
    parse([{ ...sample(), image: 'https://example.com/p.jpg' }]).rejected[0].reason,
    'Unexpected image URL',
  );
  assert.throws(() =>
    parseBlixCandidates(html([]), 'https://example.com/sklep/lidl/gazetka/534102/'),
  );
  assert.throws(() => blixLeafletUrl('lidl', '../other'));
});

const card = (
  id = '534003',
  from = 'November 5, 2026 00:00',
  to = 'November 7, 2026 23:59',
  store = 'biedronka',
) =>
  `<div class="leaflet" data-leaflet-id="${id}" data-leaflet-name="Weekly" data-date-start="${from}" data-date-end="${to}"><a href="/sklep/${store}/gazetka/${id}/?pageNumber=1">Leaflet</a></div>`;

test('selects active leaflets', () => {
  const current = card('100', 'November 6, 2026 00:00', 'November 6, 2026 23:59');
  const text =
    current +
    current +
    card('999', 'November 9, 2026 00:00', 'November 10, 2026 23:59') +
    card('101', 'November 1, 2026 00:00', 'November 4, 2026 23:59') +
    card('102', '', '') +
    card('103', undefined, undefined, 'lidl');
  const refs = discoverBlixLeaflets(text, 'biedronka', '2026-11-06');
  assert.deepEqual(
    refs.filter((row) => row.active).map((row) => row.id),
    ['100'],
  );
  assert.equal(refs.filter((row) => row.id === '100').length, 1);
  assert.equal(refs.find((row) => row.id === '100')?.title, 'Weekly');
  assert.ok(!refs.some((row) => row.id === '103'));
});

test('validates leaflet dates', () => {
  assert.equal(
    discoverBlixLeaflets(card('1', 'February 30, 2026 00:00'), 'biedronka', '2026-11-06')[0].active,
    false,
  );
  assert.equal(
    discoverBlixLeaflets(
      card('1', 'December 1, 2026 00:00', 'November 1, 2026 00:00'),
      'biedronka',
      '2026-11-06',
    )[0].active,
    false,
  );
  assert.throws(
    () =>
      discoverBlixLeaflets(
        card() + card('534003', 'November 6, 2026 00:00'),
        'biedronka',
        '2026-11-06',
      ),
    /Conflicting leaflet metadata/,
  );
  assert.throws(() => discoverBlixLeaflets(card(), 'biedronka', 'invalid'));
  assert.equal(
    discoverBlixLeaflets(
      '<a href="/sklep/biedronka/gazetka/9/">Undated</a>',
      'biedronka',
      '2026-11-06',
    ).length,
    0,
  );
});

test('uses the Warsaw date', () => {
  assert.equal(todayInWarsaw(new Date('2026-11-05T23:30:00Z')), '2026-11-06');
});

test('fetches offers and leaflets', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(options?.redirect, 'error');
      assert.ok(options?.signal);
      assert.equal(String(input), fixture.sourceUrl);
      return new Response(html(fixture.offers), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
    assert.equal((await fetchBlixCandidates('biedronka', '534003')).candidates.length, 2);
    globalThis.fetch = async () =>
      new Response(card('534102', undefined, undefined, 'lidl'), {
        headers: { 'content-type': 'text/html' },
      });
    assert.equal((await listBlixLeaflets('lidl'))[0].id, '534102');
  } finally {
    globalThis.fetch = original;
  }
});

test('handles fetch failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Unavailable', { status: 429 });
    await assert.rejects(fetchBlixCandidates('biedronka', '534003'), /HTTP 429/);
    globalThis.fetch = async () =>
      new Response('{}', { headers: { 'content-type': 'application/json' } });
    await assert.rejects(fetchBlixCandidates('biedronka', '534003'), /Expected HTML/);
    globalThis.fetch = async () =>
      new Response(html([]), { headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchBlixCandidates('biedronka', '534003'), /No priced candidates/);
    globalThis.fetch = async () => {
      throw new Error('Connection failed');
    };
    await assert.rejects(fetchBlixCandidates('biedronka', '534003'), /Connection failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test('limits response size', async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      );
    await assert.rejects(fetchBlixCandidates('biedronka', '534003'), /exceeds 10 MB/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('keeps partial batch results', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const body = url.endsWith('/sklep/biedronka/')
        ? card() + card('534004') + card('999', 'November 9, 2026 00:00', 'November 10, 2026 23:59')
        : url.includes('/534003/')
          ? html(fixture.offers)
          : html([]);
      return new Response(body, { headers: { 'content-type': 'text/html' } });
    };
    const result = await fetchCurrentBlixCandidates('biedronka', '2026-11-06');
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
      result.failures.map((row) => row.leafletId),
      ['534004'],
    );
    assert.equal(result.results.length, 1);
    assert.equal(calls.length, 3);
    assert.ok(!calls.some((url) => url.includes('/999/')));
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects unusable batches', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      new Response(String(input).endsWith('/sklep/biedronka/') ? card() : html([]), {
        headers: { 'content-type': 'text/html' },
      });
    await assert.rejects(
      fetchCurrentBlixCandidates('biedronka', '2026-11-06'),
      /All active leaflets failed/,
    );
    globalThis.fetch = async () =>
      new Response(card('1', '', ''), { headers: { 'content-type': 'text/html' } });
    await assert.rejects(
      fetchCurrentBlixCandidates('biedronka', '2026-11-06'),
      /No dated active leaflets/,
    );
    globalThis.fetch = async () =>
      new Response(Array.from({ length: 21 }, (_, i) => card(String(i + 1))).join(''), {
        headers: { 'content-type': 'text/html' },
      });
    await assert.rejects(
      fetchCurrentBlixCandidates('biedronka', '2026-11-06'),
      /Too many active leaflets/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
