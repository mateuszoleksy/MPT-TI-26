import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { readCaptured, enrichCaptured } from './test/captured-fixtures.js';
import { enrichProductDetails, parseProductDetails } from './adapters/product-details.js';

describe('captured product details', () => {
  const entries = readCaptured('audit-regressions');
  const read = (index: number) => enrichCaptured(entries[index]);
  test('recovers inline previous-price text with an independent strong crossed-price reading', () => {
    const row = read(0);
    assert.equal(row.pricePrevious, 1.79);
    assert.equal(row.priceRegular, 1.59);
    assert.equal(row.unitQuantity, 0.06);
    assert.equal(row.productDetails.lowest30DaysPrice.value, null);
    const e = structuredClone(entries[0]);
    e.ocr.ocrLines = e.ocr.ocrLines.filter((line: { text: string }) => line.text !== '1,79*');
    const noProof = enrichProductDetails(e.candidate, [], e.ocr.ocrLines);
    assert.equal(noProof.pricePrevious, null);
  });

  test('reads a count directly following punctuation and separates per-bag from package price', () => {
    const row = read(1);
    assert.equal(row.unit, 'szt');
    assert.equal(row.unitQuantity, 20);
    assert.equal(row.priceRegular, 2.79);
    assert.equal(row.productDetails.pieceQuantity.value?.amount, 20);
    assert.equal(row.reportedPrice, 1.89);
  });

  test('prioritizes the matching product caption over neighbouring variant weights', () => {
    assert.equal(read(2).unitQuantity, 0.082);
    assert.equal(read(7).unitQuantity, 0.35);
  });

  test('does not promote capacity, steam flow, gift-set components to net quantity', () => {
    for (const index of [3, 4, 5])
      assert.equal(read(index).unitQuantity, null, entries[index].candidate.name);
    assert.equal(parseProductDetails('Mąka typ 450', 'https://blix.pl/', []).quantity.value, null);
  });

  test('uses a captured explicit multipack total instead of one carton size', () => {
    assert.equal(read(6).unitQuantity, 0.8);
  });
});

describe('captured layouts', () => {
  const entries = readCaptured('layout-followup');
  const read = enrichCaptured;
  test('recovers split price captions, corroborated references and a previous price', () => {
    const expected = [
      ['Schiacciata', 2.49, 0.08],
      ['Jogurty owocowe Fruvita', 2.99, 0.4],
      ['Tortilla pszenna Pano', 3.99, 0.306],
    ] as const;
    for (const [name, price, quantity] of expected) {
      const row = read(entries.find((e) => e.candidate.name === name));
      assert.equal(row.priceRegular, price, name);
      assert.equal(row.unitQuantity, quantity, name);
    }
    const bread = read(entries.find((e) => e.candidate.name.startsWith('Pain au')));
    assert.equal(bread.pricePrevious, 2.99);
    for (const e of entries.filter((e) => e.candidate.name.startsWith('Ser topiony'))) {
      assert.ok(e);
      const r = read(e);
      assert.equal(r.priceRegular, r.reportedPrice === 1.79 ? 2.49 : 4.29);
    }
  });
  test('recognizes a confirmed multipack but keeps an unsupported one unresolved', () => {
    const e = entries.find((e) => e.candidate.name.startsWith('Napój Riviva'));
    assert.ok(e);
    const r = read(e);
    assert.equal(r.unitQuantity, 0.8);
    assert.equal(r.priceRegular, 3.15);
    const noPriceProof = read(
      e,
      e.ocr.ocrLines.filter((l) => !(l.text === '3,15' && l.confidence > 0.97)),
    );
    assert.equal(noPriceProof.priceRegular, null);
    const without = read(
      e,
      e.ocr.ocrLines.filter((l) => !l.text.startsWith('4x')),
    );
    assert.notEqual(without.unitQuantity, 0.8);
  });
  test('does not read a number inside an OCR word as grams', () => {
    const r = parseProductDetails('Pieczywo', 'https://example.com', [
      { text: '30G0DZINNY', origin: 'ocr', confidence: 0.99, sourceUrl: 'https://example.com' },
    ]);
    assert.equal(r.quantity.value, null);
  });
});

describe('mixed price captions', () => {
  const [entry] = readCaptured('mixed-price-label');
  test('reads a previous price from a mixed old-regular/30-day bottle caption', () => {
    const result = enrichCaptured(entry);
    assert.equal(result.pricePrevious, 2.49);
    assert.equal(result.unitQuantity, 0.4);
    assert.equal(result.priceRegular, 2.39);
    assert.equal(result.reportedPrice, 2.39);
    assert.ok(
      result.productDetails.previousPrice.evidence.some((e) => e.text.includes('2,49/but.')),
    );
  });
});
