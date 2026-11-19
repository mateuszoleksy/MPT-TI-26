import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readCaptured } from './test/captured-fixtures.js';
import { enrichConditions } from './adapters/blix-conditions.js';
import { classifyOffer } from './adapters/offer-kind.js';
const entries = readCaptured('offer-kinds');
test('classifies captured plain regular-price offers without removing reductions', () => {
  for (const e of entries) {
    const row = enrichConditions(
      e.candidate,
      e.ocr.lines.map((l: any) => ({ ...l, origin: 'ocr', sourceUrl: e.candidate.sourceUrl })),
      e.ocr.ocrLines ?? [],
    );
    assert.equal(
      row.offerKind,
      /Croissant|Play/.test(e.candidate.name) ? 'price-reduction' : 'regular',
      e.candidate.name,
    );
    assert.ok(row.offerKindEvidence.length);
  }
});
test('does not infer regular prices from missing data, weak labels or reference prices', () => {
  const parse = (text: string, confidence = 0.99) =>
    classifyOffer([{ text, confidence, origin: 'ocr', sourceUrl: 'https://example.com' }])
      .offerKind;
  assert.equal(classifyOffer([]).offerKind, 'unknown');
  assert.equal(parse('Cena regularna', 0.8), 'unknown');
  assert.equal(parse('Stara cena regularna / najniższa cena z 30 dni'), 'unknown');
  assert.equal(parse('Cena poza promocją: 3,79'), 'unknown');
  const sources = ['Cena regularna', '30% taniej przy zakupie 2'].map((text) => ({
    text,
    origin: 'ocr' as const,
    confidence: 0.99,
    sourceUrl: 'https://example.com',
  }));
  assert.equal(classifyOffer(sources).offerKind, 'unknown');
});
