import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPackageContents } from './adapters/package-contents.js';
import { enrichProductDetails } from './adapters/product-details.js';
import { SourceOfferSchema } from '@promo/shared';

const url = 'https://blix.pl/';
const source = (text: string) => ({ text, sourceUrl: url, origin: 'html' as const });
const parse = (...texts: string[]) => readPackageContents(texts.map(source));

test('reads pieces, tea bags, capsules, tablets and multipacks', () => {
  for (const [text, amount] of [
    ['Herbata 20 torebek', 20],
    ['Kawa 10 kapsułek', 10],
    ['Tabletki 30 szt.', 30],
    ['2 x 20 tabletek', 40],
    ['Lody 8-pak', 8],
  ] as const)
    assert.equal(parse(text).pieceQuantity.value?.amount, amount);
});

test('does not confuse purchase requirements or unit-price denominators with contents', () => {
  for (const text of [
    'Przy zakupie 3 szt.',
    'KAŻDA Z 2 SZTUK',
    'Limit 4 szt.',
    'Cena za 1 szt.',
    '0,09 zł/szt.',
    '1 szt.=2,79',
  ])
    assert.equal(parse(text).pieceQuantity.value, null, text);
  assert.equal(parse('20 lub 40 torebek').pieceQuantity.value, null);
  assert.equal(parse('20 torebek', '40 torebek').pieceQuantity.status, 'conflict');
});

test('preserves unit prices with their original denominator and unassigned role', () => {
  const result = parse('0,09 zł/szt.', '99,44 zł/kg', '100 g = 1,25', '4,99/100ml');
  assert.deepEqual(
    result.unitPrices.map(({ amount, unit, perQuantity, priceRole }) => ({
      amount,
      unit,
      perQuantity,
      priceRole,
    })),
    [
      { amount: 0.09, unit: 'szt', perQuantity: 1, priceRole: 'unassigned' },
      { amount: 99.44, unit: 'kg', perQuantity: 1, priceRole: 'unassigned' },
      { amount: 1.25, unit: 'kg', perQuantity: 0.1, priceRole: 'unassigned' },
      { amount: 4.99, unit: 'l', perQuantity: 0.1, priceRole: 'unassigned' },
    ],
  );
});

test('retains uncertain source readings without accepting them as known values', () => {
  const result = readPackageContents([
    { ...source('20 torebek, 0,09 zł/szt.'), origin: 'ocr', confidence: 0.8 },
  ]);
  assert.equal(result.pieceQuantity.value, null);
  assert.equal(result.unitPrices.length, 0);
  assert.equal(result.unassignedReadings.length, 1);
});

test('exports count-based quantities and keeps weight and count as separate data', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/target-offers.json', import.meta.url), 'utf8'),
  )[0];
  const tea = enrichProductDetails({ ...fixture.candidate, name: 'Herbata 20 torebek' }, [
    source('Cena poza promocją: 2,79 zł'),
    source('0,09 zł/szt.'),
  ]);
  assert.equal(tea.unit, 'szt');
  assert.equal(tea.unitQuantity, 20);
  assert.equal(tea.priceRegular, 2.79);
  assert.equal(SourceOfferSchema.parse(tea).productDetails !== undefined, true);
  const both = enrichProductDetails({ ...fixture.candidate, name: 'Herbata 20 torebek 40 g' }, []);
  assert.equal(both.unit, 'kg');
  assert.equal(both.unitQuantity, 0.04);
  assert.equal(both.productDetails.pieceQuantity.value?.amount, 20);
});

test('corroborates a weaker regular-price label using a rounded per-piece reference', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/target-offers.json', import.meta.url), 'utf8'),
  )[0];
  const line = (text: string, x: number, y: number, confidence = 0.99) => ({
    text,
    confidence,
    box: [
      [x, y],
      [x + 70, y],
      [x + 70, y + 14],
      [x, y + 14],
    ],
  });
  const raw = [
    line('pozapromocjq:', 10, 100, 0.93),
    line('2,79', 110, 84),
    line('0,14/szt.', 110, 100),
  ];
  const candidate = { ...fixture.candidate, name: 'Herbata 20 torebek' };
  assert.equal(enrichProductDetails(candidate, [], raw).priceRegular, 2.79);
  raw[2].text = '0,25/szt.';
  assert.equal(enrichProductDetails(candidate, [], raw).priceRegular, null);
});
