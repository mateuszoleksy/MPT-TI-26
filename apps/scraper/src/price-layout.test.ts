import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPriceLayout } from './adapters/price-layout.js';
import { parseProductDetails } from './adapters/product-details.js';
import { parsePromotionConditions } from './adapters/promotion-conditions.js';

const url = 'https://blix.pl/sklep/biedronka/gazetka/535098/';
const line = (text: string, x: number, y: number, width = 80, confidence = 0.99) => ({
  text,
  confidence,
  box: [
    [x, y],
    [x + width, y],
    [x + width, y + 14],
    [x, y + 14],
  ],
});

test('reads a reference caption split across three OCR lines', () => {
  const result = readPriceLayout(
    [
      line('Cena za 1 szt.', 10, 100),
      line('przed obniżką/', 10, 116),
      line('poza promocją', 10, 132),
      line('5,79', 110, 116, 40),
    ],
    url,
  );
  assert.deepEqual(result.regular[0]?.value, { amount: 5.79, basis: 'item' });
});

test('keeps the read reference price instead of reversing a rounded discount', () => {
  const source = [
    'Przy zakupie 2 sztuk',
    'Drugi 50% taniej',
    'Cena za 1 szt. przed obniżką/poza promocją: 5,79',
  ].map((text) => ({
    text,
    sourceUrl: url,
    origin: 'html' as const,
  }));
  const details = parseProductDetails(
    'Twaróg półtłusty wiejski Piątnica 250 g',
    url,
    source,
    [],
    4.29,
  );
  assert.deepEqual(details.regularPrice.value, { amount: 5.79, basis: 'item' });
  assert.equal(parsePromotionConditions(source).multiBuy.value?.kind, 'nth-discount');
  assert.equal(
    parseProductDetails('Twaróg', url, source.slice(0, 2), [], 4.29).regularPrice.value,
    null,
  );
});

test('reads a buy-get promotion without inventing a discounted item price', () => {
  const source = [
    '2+1 gratis',
    'Z kartą lub apką Moja Biedronka',
    'Cena za 1 szt. przed obniżką/poza promocją: 4,19',
  ].map((text) => ({
    text,
    sourceUrl: url,
    origin: 'html' as const,
  }));
  const promotion = parsePromotionConditions(source);
  assert.deepEqual(promotion.multiBuy.value, { kind: 'buy-get', paid: 2, free: 1 });
  assert.equal(promotion.loyalty.value, 'card-or-app');
  assert.deepEqual(
    parseProductDetails('Parówki Sokoliki Sokołów 140 g', url, source).regularPrice.value,
    { amount: 4.19, basis: 'item' },
  );
});

test('associates a price on the right and retains its source evidence', () => {
  const result = readPriceLayout(
    [line('Cena za 1 szt.', 10, 100), line('poza promocją:', 10, 116), line('6,99', 110, 100, 40)],
    url,
  );
  assert.deepEqual(result.regular[0].value, { amount: 6.99, basis: 'item' });
  assert.ok(result.regular[0].evidence.text.includes('poza promocją:'));
  assert.ok(result.regular[0].evidence.text.includes('6,99'));
});

test('keeps distant, ambiguous, low-confidence and separator-free prices unresolved', () => {
  const label = line('cena poza promocją:', 10, 100);
  assert.equal(readPriceLayout([label, line('7,99', 500, 100, 40)], url).regular.length, 0);
  assert.equal(readPriceLayout([label, line('799', 110, 100, 40)], url).regular.length, 0);
  assert.equal(readPriceLayout([label, line('7,99', 110, 100, 40, 0.8)], url).regular.length, 0);
  assert.equal(
    readPriceLayout([label, { text: '7,99', confidence: 0.99, box: [] }], url).regular.length,
    0,
  );
  const raw = [label, line('7,99', 110, 100, 40), line('8,99', 110, 115, 40)];
  assert.equal(parseProductDetails('Produkt', url, [], raw).regularPrice.status, 'conflict');
});

test('does not treat a unit reference as package weight', () => {
  assert.equal(
    parseProductDetails(
      'Produkt',
      url,
      [],
      [line('Cena za 1kg', 10, 100), line('8,00/100g', 10, 120)],
    ).quantity.value,
    null,
  );
});

test('does not fill regular prices when an uncertain label changes their meaning', () => {
  const raw = [
    line('Najniższa cena z 30 dni', 10, 80, 80, 0.8),
    line('cena poza promocją:', 10, 100),
    line('7,99', 110, 100, 40),
  ];
  assert.equal(readPriceLayout(raw, url).regular.length, 0);
  assert.equal(
    readPriceLayout(
      [
        line('Cena za 1kg', 10, 80, 80, 0.8),
        line('poza promocją:', 10, 100),
        line('7,99', 110, 100, 40),
      ],
      url,
    ).regular.length,
    0,
  );
});

test('reads captured references in separate columns without mixing price types', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/price-layout.json', import.meta.url), 'utf8'),
  );
  const results = fixtures.map(
    (row: {
      name: string;
      sourceUrl: string;
      lines: { text: string; confidence: number }[];
      ocrLines: unknown[];
    }) =>
      parseProductDetails(
        row.name,
        row.sourceUrl,
        row.lines.map((l) => ({ ...l, sourceUrl: row.sourceUrl, origin: 'ocr' })),
        row.ocrLines,
      ),
  );
  assert.equal(results[0].regularPrice.value, null);
  assert.equal(results[0].lowest30DaysPrice.value?.amount, 4.49);
  assert.equal(results[1].regularPrice.value, null);
  assert.deepEqual(results[1].lowest30DaysPrice.value, { amount: 9.99, basis: 'item' });
  assert.equal(results[2].regularPrice.value, null);
  assert.deepEqual(results[2].quantity.value, { unit: 'kg', amount: 0.4 });
  assert.equal(results[3].regularPrice.value, null);
  assert.equal(results[4].regularPrice.value, null);
  assert.equal(results[4].lowest30DaysPrice.value?.amount, 27.99);
  assert.equal(results[5].regularPrice.value?.amount, 24.99);
  assert.equal(results[5].lowest30DaysPrice.value?.amount, 24.99);
  assert.equal(results[6].regularPrice.value?.amount, 5.99);
  assert.equal(results[7].regularPrice.value?.amount, 6.99);
  assert.equal(results[8].regularPrice.value?.amount, 9.99);
  assert.equal(results[9].regularPrice.value?.amount, 10.49);
  assert.deepEqual(results[10].regularPrice.value, { amount: 79.99, basis: 'kg' });
  assert.equal(results[10].quantity.value, null);
  assert.equal(results[11].regularPrice.value, null);
});
