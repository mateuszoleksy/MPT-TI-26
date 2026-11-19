import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichConditions } from './adapters/blix-conditions.js';
import {
  hasDetectedConditions,
  parsePromotionConditions,
} from './adapters/promotion-conditions.js';
import { detectedConditionLabels, SourceOfferSchema } from '@promo/shared';

const rows = JSON.parse(
  readFileSync(new URL('./adapters/__fixtures__/target-offers.json', import.meta.url), 'utf8'),
);
const enrich = (row: (typeof rows)[number]) =>
  enrichConditions(
    row.candidate,
    row.lines.map((line: { text: string; confidence: number }) => ({
      ...line,
      sourceUrl: row.candidate.sourceUrl,
      origin: 'ocr' as const,
    })),
    row.ocrLines,
  );

test('recovers captured Tic Tac size and both reference prices with corroboration', () => {
  const result = enrich(rows[0]);
  assert.equal(result.unitQuantity, 0.018);
  assert.equal(result.unit, 'kg');
  assert.equal(result.priceRegular, 2.99);
  assert.equal(result.productDetails.lowest30DaysPrice.value?.amount, 1.99);
  assert.equal(result.reportedPrice, 1.79);
  assert.equal(result.promotion.minimumQuantity.value, 3);
  assert.equal(result.requiresApp, null);
});

test('does not recover weaker size/price readings without matching numerical evidence', () => {
  const row = structuredClone(rows[0]);
  for (const line of row.ocrLines) if (line.text === '99,44zt/kg') line.text = '49,72zt/kg';
  const result = enrich(row);
  assert.equal(result.unitQuantity, null);
  assert.equal(result.priceRegular, null);
});

test('shows the captured Niteo basket requirement on both additional offers', () => {
  for (const row of rows.slice(1)) {
    const result = enrich(row);
    assert.equal(result.promotion.minimumSpend.value, 129);
    assert.equal(result.promotion.selectedProducts.value, true);
    assert.equal(result.promotion.addOn.value, true);
    assert.equal(result.promotion.minimumQuantity.value, null);
    assert.equal(result.reportedPrice, row.candidate.reportedPrice);
    assert.ok(
      detectedConditionLabels(SourceOfferSchema.parse(result)).includes(
        'Po zakupie wybranych produktów za min. 129 zł',
      ),
    );
    assert.ok(
      detectedConditionLabels(SourceOfferSchema.parse(result)).includes('Oferta dodatkowa'),
    );
    assert.equal(hasDetectedConditions(result.promotion), true);
  }
});

test('keeps ambiguous spend amounts unresolved and does not join separate digits', () => {
  const source = (text: string) => ({
    text,
    origin: 'html' as const,
    sourceUrl: 'https://blix.pl/',
  });
  assert.equal(
    parsePromotionConditions([source('Za min. 129 zł'), source('Za min. 149 zł')]).minimumSpend
      .status,
    'conflict',
  );
  assert.equal(parsePromotionConditions([source('Za min. 1 2 9 zł')]).minimumSpend.value, null);
  assert.equal(hasDetectedConditions(parsePromotionConditions([])), false);
});

const labels = (...texts: string[]) => {
  const row = enrichConditions(
    rows[0].candidate,
    texts.map((text) => ({ text, sourceUrl: rows[0].candidate.sourceUrl, origin: 'html' })),
  );
  return { row, labels: detectedConditionLabels(SourceOfferSchema.parse(row)) };
};

test('distinguishes an explicit per-item quantity label from the second-item discount', () => {
  const result = labels('DRUGI 64% TANIEJ', 'KAŻDE Z 2 OPAKOWAŃ');
  assert.ok(result.labels.includes('Cena za sztukę przy zakupie 2 szt.'));
  assert.ok(result.labels.includes('2. produkt 64% taniej'));
  assert.equal(result.row.promotion.priceQuantity.value, 2);
  assert.equal(result.row.reportedPrice, rows[0].candidate.reportedPrice);
  assert.equal(result.row.priceBasis, 'unknown');
});

test('shows a purchase prerequisite without inventing a per-item price basis', () => {
  const result = labels('DRUGI 50% TANIEJ');
  assert.ok(result.labels.includes('Przy zakupie 2 szt.'));
  assert.equal(result.row.promotion.priceQuantity.value, null);
  assert.ok(!result.labels.some((label) => label.startsWith('Cena za sztukę')));
});
