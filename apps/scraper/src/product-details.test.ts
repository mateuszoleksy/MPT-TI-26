import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProductDetails, enrichProductDetails } from './adapters/product-details.js';
import { parseBlixCandidates } from './adapters/blix-parser.js';
import type { ConditionEvidence } from './adapters/promotion-conditions.js';

const url = 'https://blix.pl/sklep/lidl/gazetka/534294/';
const source = (text: string, confidence = 0.99): ConditionEvidence => ({
  text,
  confidence,
  origin: 'ocr',
  sourceUrl: url,
});
const parse = (name: string, ...texts: string[]) =>
  parseProductDetails(
    name,
    url,
    texts.map((text) => source(text)),
  );

test('normalizes package quantities and multipacks', () => {
  for (const [name, unit, amount] of [
    ['Masło 200 g', 'kg', 0.2],
    ['Napój 750 ml', 'l', 0.75],
    ['Mleko 1 L', 'l', 1],
    ['Sok 1,5 l', 'l', 1.5],
    ['Napój 6 × 330 ml', 'l', 1.98],
    ['Lody 8x25 ml', 'l', 0.2],
    ['Kawa 2 x 250 g', 'kg', 0.5],
  ] as const)
    assert.deepEqual(parse(name).quantity.value, { unit, amount });
});

test('does not use unit-price references or purchase limits as package size', () => {
  assert.equal(
    parse('Masło', '100g=1,25', '14,95 zł/kg', 'Limit dzienny 9 kg na kartę').quantity.value,
    null,
  );
  assert.equal(parse('Produkt 200–300 g').quantity.value, null);
  assert.equal(parse('Produkt 0 g').quantity.value, null);
  assert.equal(parse('Produkt', 'Masa po odsączeniu 150 g').quantity.value, null);
  assert.deepEqual(parse('Masło 200 g', '100g=1,25').quantity.value, { unit: 'kg', amount: 0.2 });
});

test('keeps conflicting sizes and uncertain OCR unresolved', () => {
  assert.equal(parse('Lody Carte d’Or 825 ml - 1000 ml').quantity.value, null);
  assert.equal(parse('Lody Carte d’Or 825 ml - 1000 ml').quantity.status, 'conflict');
  assert.deepEqual(parse('Lody Marletto 900 ml').quantity.value, { unit: 'l', amount: 0.9 });
  const conflict = parse('Napój 500 ml', '750 ml');
  assert.equal(conflict.quantity.value, null);
  assert.equal(conflict.quantity.status, 'conflict');
  assert.equal(conflict.quantity.evidence.length, 2);
  assert.equal(parseProductDetails('Produkt', url, [source('200 g', 0.8)]).quantity.value, null);
  assert.equal(parse('Masło 200 g', 'Przy zakupie 3 szt.').quantity.value?.amount, 0.2);
});

test('separates reference prices without guessing from discounts or crossed numbers', () => {
  assert.equal(parse('Herbata TET', 'CENAZA1OPAKPOZA PROMOCJA 1799').regularPrice.value, null);
  assert.equal(parse('Produkt', 'Cena poza promocją: 2,50/100g').regularPrice.value, null);
  assert.equal(parse('Produkt', 'Cena regularna: 7,49-9,99 zł').regularPrice.value, null);
  assert.deepEqual(parse('Produkt', 'Cena regularna: 7,49 zł').regularPrice.value, {
    amount: 7.49,
    basis: 'item',
  });
  assert.equal(
    parse('Produkt', 'Najniższa cena z 30 dni przed obniżką: 6,99 zł').regularPrice.value,
    null,
  );
  assert.equal(
    parse('Produkt', 'Najniższa cena z 30 dni przed obniżką/cena poza promocją: 6,99/opak.')
      .regularPrice.value,
    null,
  );
  assert.equal(
    parse('Produkt', 'Najniższa cena z 30 dni przed obniżką/cena poza promocją: 6,99/opak.')
      .lowest30DaysPrice.value?.amount,
    6.99,
  );
  assert.equal(
    parse('Produkt', 'Cena poza promocją: 4,99', 'Cena poza promocją: 5,99').regularPrice.status,
    'conflict',
  );
  assert.equal(
    parse('Produkt', '7,49', '-50%', 'Cena przed obniżką: 7,49').regularPrice.value,
    null,
  );
  assert.equal(
    parse('Produkt', 'Cena przy zakupie 1 szt: 9,99').withoutMultiBuyPrice.value?.amount,
    9.99,
  );
});

test('recovers captured sizes and prices from both stores', () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/product-details.json', import.meta.url), 'utf8'),
  );
  const results = fixtures.map(
    (row: { name: string; sourceUrl: string; texts: { text: string; confidence: number }[] }) =>
      parseProductDetails(
        row.name,
        row.sourceUrl,
        row.texts.map((line) => ({ ...line, origin: 'ocr', sourceUrl: row.sourceUrl })),
      ),
  );
  assert.deepEqual(results[0].quantity.value, { unit: 'kg', amount: 0.2 });
  assert.equal(results[0].regularPrice.value?.amount, 4.99);
  assert.deepEqual(results[1].quantity.value, { unit: 'l', amount: 1 });
  assert.equal(results[1].regularPrice.value, null);
  assert.equal(results[1].lowest30DaysPrice.value?.amount, 4.49);
  assert.deepEqual(results[2].quantity.value, { unit: 'kg', amount: 1 });
  assert.deepEqual(results[2].regularPrice.value, { amount: 33.99, basis: 'item' });
  assert.equal(results[3].regularPrice.value?.amount, 6.99);
  assert.deepEqual(results[4].quantity.value, { unit: 'kg', amount: 0.2 });
  assert.equal(results[4].regularPrice.value, null);
});

test('exports compatible reference prices and preserves source price and identity', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/blix-sample.json', import.meta.url), 'utf8'),
  );
  const html = `<script>window.offers = ${JSON.stringify(fixture.offers)};</script>`;
  const candidate = parseBlixCandidates(html, fixture.sourceUrl).candidates[0];
  const row = enrichProductDetails({ ...candidate, name: 'Produkt 200 g' }, [
    source('Cena poza promocją: 24,95 zł/kg'),
  ]);
  assert.equal(row.priceRegular, 4.99);
  assert.equal(row.unitQuantity, 0.2);
  assert.equal(row.reportedPrice, candidate.reportedPrice);
  assert.equal(row.id, candidate.id);
  assert.equal(row.priceBasis, 'unknown');
  assert.equal(row.requiresApp, null);
  assert.equal(
    enrichProductDetails(candidate, [source('Cena poza promocją: 24,95 zł/kg')]).priceRegular,
    null,
  );
});
