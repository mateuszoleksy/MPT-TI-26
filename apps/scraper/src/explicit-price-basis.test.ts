import assert from 'node:assert/strict';
import { readCaptured } from './test/captured-fixtures.js';
import { test } from 'vitest';
import { enrichProductDetails } from './adapters/product-details.js';
import { readExplicitPriceBasis } from './adapters/explicit-price-basis.js';
const examples = readCaptured('price-basis');
function parse(entry: any) {
  return enrichProductDetails(
    entry.candidate,
    entry.ocr.lines.map((l: any) => ({
      ...l,
      origin: 'ocr',
      sourceUrl: entry.candidate.sourceUrl,
    })),
    entry.ocr.ocrLines ?? [],
  );
}
test('reads milk reference price from an unambiguous saved caption without raw boxes', () => {
  const row = parse(examples.find((e: any) => e.candidate.name.includes('Uchate')));
  assert.equal(row.priceRegular, 3.79);
  assert.equal(row.unitQuantity, 1);
  assert.equal(row.priceQuantity, null);
});
test('keeps deli price per 100 g separate from package weight', () => {
  const row = parse(examples.find((e: any) => e.candidate.name.includes('Indykpol')));
  assert.deepEqual(row.priceQuantity, { unit: 'kg', amount: 0.1 });
  assert.equal(row.unitQuantity, null);
  assert.equal(row.priceRegular, 2.19);
  assert.equal(row.reportedPrice, 1.79);
});
test('does not assign multiple unpositioned amounts or a lowest-30-days price as regular', () => {
  const sources = ['Cena za 1 szt. przed obniżką/ poza promocją:', '3,79', '4,99'].map((text) => ({
    text,
    origin: 'ocr' as const,
    sourceUrl: 'https://example.com',
    confidence: 0.99,
  }));
  assert.equal(readExplicitPriceBasis(sources, []).regular.length, 0);
  sources.pop();
  sources.push({ ...sources[0], text: 'Najniższa cena z 30 dni' });
  assert.equal(readExplicitPriceBasis(sources, []).regular.length, 0);
});
test('conflicting advertised portions remain unknown', () => {
  const sources = ['/100g', '/1kg'].map((text) => ({
    text,
    origin: 'ocr' as const,
    sourceUrl: 'https://example.com',
    confidence: 0.99,
  }));
  assert.equal(readExplicitPriceBasis(sources, []).priceQuantity.status, 'conflict');
});

test('does not mistake an isolated leaflet date for a reference price', () => {
  const sources = ['Cena za 1 szt. przed obniżką/ poza promocją:', '14.11'].map((text) => ({
    text,
    origin: 'ocr' as const,
    sourceUrl: 'https://example.com',
    confidence: 0.99,
  }));
  assert.equal(readExplicitPriceBasis(sources, []).regular.length, 0);
});
