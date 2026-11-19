import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readCaptured } from './test/captured-fixtures.js';
import { enrichConditions } from './adapters/blix-conditions.js';
import { readAssortment } from './adapters/assortment.js';
const entries = readCaptured('assortments');
const rows = entries.map((e: any) =>
  enrichConditions(
    e.candidate,
    e.ocr.lines.map((l: any) => ({ ...l, origin: 'ocr', sourceUrl: e.candidate.sourceUrl })),
    e.ocr.ocrLines,
  ),
);
test('reads three captured assortment occurrences without losing original names', () => {
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.name, 'Cukierki Tic Tac - różne rodzaje');
    assert.equal(row.assortment?.amount, 0.018);
    assert.equal(row.priceRegular, 2.99);
    assert.equal(row.reportedPrice, 1.79);
  }
  assert.equal(rows[0].sourceName, 'Cukierki Tic Tac Orange');
});
test('requires explicit assortment text, a package caption and a matching variant', () => {
  const e = entries[0],
    texts = e.ocr.lines.map((l: any) => ({
      ...l,
      origin: 'ocr',
      sourceUrl: e.candidate.sourceUrl,
    }));
  assert.equal(
    readAssortment(
      e.candidate.name,
      texts.filter((t: any) => !t.text.includes('roznerodzaje')),
      e.ocr.ocrLines,
    ),
    null,
  );
  assert.equal(readAssortment('Cukierki Tic Tac Chocolate', texts, e.ocr.ocrLines), null);
  assert.equal(readAssortment(e.candidate.name, texts, []), null);
});
