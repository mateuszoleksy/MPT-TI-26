import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichProductDetails, parseProductDetails } from './adapters/product-details.js';

const url = 'https://blix.pl/sklep/lidl/gazetka/534417/?pageNumber=9';
const source = (text: string) => ({ text, origin: 'html' as const, sourceUrl: url });
const line = (text: string, x: number, y: number, w = 100, h = 16) => ({
  text,
  confidence: 0.99,
  box: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

test('separates previous and current regular prices and retains unit references', () => {
  const result = parseProductDetails('Bułka pszenna 65 g', url, [
    source('Stara cena regularna / cena przed obniżką: 0,70/szt., 100 g = 1,08'),
    source('Nowa cena regularna: 0,59 zł'),
  ]);
  assert.equal(result.previousPrice.value?.amount, 0.7);
  assert.equal(result.currentRegularPrice.value?.amount, 0.59);
  assert.equal(result.regularPrice.value?.amount, 0.59);
  assert.equal(result.lowest30DaysPrice.value, null);
  assert.equal(result.quantity.value?.amount, 0.065);
});

test('links split old labels and new price captions without calculating from a discount', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./adapters/__fixtures__/target-offers.json', import.meta.url), 'utf8'),
  )[0];
  const raw = [
    line('stara cena regularna/', 10, 20),
    line('cena przed obniżką:', 10, 40),
    line('0,70/szt.,100g=1,08', 10, 60),
    line('0,', 10, 170, 60, 80),
    line('59', 75, 170, 50, 55),
    line('Nowa cena', 10, 260),
    line('regularna', 10, 280),
  ];
  const candidate = { ...fixture.candidate, name: 'Bułka pszenna 65 g', reportedPrice: 0.59 };
  const result = enrichProductDetails(candidate, [], raw);
  assert.equal(result.pricePrevious, 0.7);
  assert.equal(result.priceRegular, 0.59);
  assert.equal(result.productDetails.currentRegularPrice.value?.amount, 0.59);
  assert.equal(result.reportedPrice, 0.59);
  assert.equal(
    enrichProductDetails({ ...candidate, reportedPrice: 0.69 }, [], raw).productDetails
      .currentRegularPrice.value,
    null,
  );
});

test('does not use a 30-day price or conflicting old prices as the previous price', () => {
  assert.equal(
    parseProductDetails('Produkt', url, [source('Najniższa cena z 30 dni: 0,70 zł')]).previousPrice
      .value,
    null,
  );
  assert.equal(
    parseProductDetails('Produkt', url, [
      source('Stara cena regularna: 0,70'),
      source('Stara cena regularna: 0,80'),
    ]).previousPrice.status,
    'conflict',
  );
});
