import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import {
  parsePromotionConditions,
  type ConditionEvidence,
} from './adapters/promotion-conditions.js';
import { enrichConditions, ocrRegion, readConditionSources } from './adapters/blix-conditions.js';
import { parseBlixCandidates } from './adapters/blix-parser.js';
import { breakfastAddOn } from './condition-ocr.js';
import { matchBundleConditions, readPageBundles } from './adapters/bundle-conditions.js';

const url = 'https://blix.pl/sklep/biedronka/gazetka/534219/';
const parse = (...texts: string[]) =>
  parsePromotionConditions(texts.map((text) => ({ text, sourceUrl: url, origin: 'html' })));
const fixtures = JSON.parse(
  await readFile(new URL('./adapters/__fixtures__/promotion-texts.json', import.meta.url), 'utf8'),
) as {
  id: string;
  sourceUrl: string;
  origin: ConditionEvidence['origin'];
  evidence: Omit<ConditionEvidence, 'sourceUrl' | 'origin'>[];
}[];
function example(id: string) {
  const row = fixtures.find((row) => row.id === id)!;
  return parsePromotionConditions(
    row.evidence.map((line) => ({ ...line, origin: row.origin, sourceUrl: row.sourceUrl })),
  );
}

test('keeps absent terms unknown', () => {
  const result = parse('Szczegóły dostępne w aplikacji Lidl Plus');
  assert.equal(result.requiresApp.value, null);
  assert.equal(result.couponActivation.value, null);
});

test('detects an explicit purchase of an add-on and ignores uncertain or negated text', () => {
  const evidence = {
    text: 'KUPJEDENDOWOLNYDODATEK',
    sourceUrl: url,
    origin: 'ocr' as const,
  };
  assert.equal(parsePromotionConditions([{ ...evidence, confidence: 0.994 }]).addOn.value, true);
  assert.equal(parsePromotionConditions([{ ...evidence, confidence: 0.8 }]).addOn.value, null);
  assert.equal(parse('Możesz kupić jeden dowolny dodatek').addOn.value, null);
});

test('uses a shared breakfast condition only for rolls with the matching advertised price', () => {
  const line = (text: string, confidence: number) => ({
    text,
    confidence,
    box: [
      [0, 0],
      [100, 0],
      [100, 12],
      [0, 12],
    ],
  });
  const crop = {
    id: 'roll',
    sourceUrl: url,
    lines: [],
    ocrLines: [line('BULKIWPROMOCJI', 0.937), line('WOLNYDODATEK', 0.99)],
  };
  const page = {
    ...crop,
    ocrLines: [
      line('KUPJEDENDOWOLNYDODATEK', 0.987),
      line('I ODBIERZ BULKE 20 GROSZY SZT.', 0.905),
    ],
  };
  const caption = breakfastAddOn(crop, page, 20);
  assert.ok(caption);
  assert.equal(
    parsePromotionConditions([{ ...caption, sourceUrl: url, origin: 'ocr' }]).addOn.value,
    true,
  );
  assert.equal(breakfastAddOn(crop, page, 30), undefined);
  assert.equal(breakfastAddOn(crop, page, undefined), undefined);
  assert.equal(breakfastAddOn({ ...crop, ocrLines: [] }, page, 20), undefined);
});

function bundlePage(texts: string[], headerCount = 0) {
  return {
    id: 'page',
    sourceUrl: url,
    lines: [],
    bbox: [0, 0, 600, 900],
    ocrLines: texts.map((text, index) => {
      const y = index < headerCount ? 40 + index * 20 : 700 + (index - headerCount) * 20;
      return {
        text,
        confidence: 0.97,
        box: [
          [40, y],
          [500, y],
          [500, y + 18],
          [40, y + 18],
        ],
      };
    }),
  };
}

function bundlePromotion(page: ReturnType<typeof bundlePage>, name: string, priceInGrosze: number) {
  const evidence = matchBundleConditions(readPageBundles(page), { name, priceInGrosze });
  return parsePromotionConditions(
    evidence.map((line) => ({ ...line, origin: 'ocr', sourceUrl: url })),
  );
}

test('matches a priced bundle with a page-wide loyalty label only to the named reward', () => {
  const page = bundlePage(
    [
      'ZtAPZESTAW',
      'OFERTAZKARTAMOJABIEDRONKALUBAPLIKACJA',
      'Kupjednorazowo1NapojgazowanyCoca-Cola',
      'lubCoca-ColaZeroCukru,330mlza4,99zt',
      'oraz1Przekqskekebab,120gza2,99zt',
    ],
    2,
  );
  // Confidence scores from the original leaflet rather than the browser screenshot.
  const [heading, , , , reward] = page.ocrLines;
  heading.confidence = 0.874;
  reward.confidence = 0.933;
  const promotion = bundlePromotion(page, 'Przekąska kebab', 299);
  assert.equal(promotion.addOn.value, true);
  assert.equal(promotion.loyalty.value, 'card-or-app');
  assert.equal(bundlePromotion(page, 'Przekąska kebab', 199).addOn.value, null);
  assert.equal(bundlePromotion(page, 'Przekąska serowa', 299).addOn.value, null);
  assert.equal(bundlePromotion(page, 'Napój gazowany Coca-Cola', 499).loyalty.value, null);
  reward.confidence = 0.9;
  assert.equal(bundlePromotion(page, 'Przekąska kebab', 299).addOn.value, null);
});

test('reads a one-zloty reward without copying terms to the other products', () => {
  const page = bundlePage([
    'Kup sok pomarańczowy i dobierz bułkę maślaną za 1 zł',
    'Tylko z aplikacją',
  ]);
  const reward = bundlePromotion(page, 'Bułka maślana', 100);
  assert.equal(reward.addOn.value, true);
  assert.equal(reward.requiresApp.value, true);
  assert.equal(bundlePromotion(page, 'Sok pomarańczowy', 100).addOn.value, null);
  assert.equal(bundlePromotion(page, 'Bułka maślana z makiem', 100).requiresApp.value, null);
});

test('reads the condition when the reward is listed first', () => {
  const page = bundlePage(['Dobierz zestaw ołówków za 1 zł przy zakupie zeszytu']);
  assert.equal(bundlePromotion(page, 'Zestaw ołówków', 100).addOn.value, true);
  assert.equal(bundlePromotion(page, 'Zestaw ołówków', 199).addOn.value, null);
});

test('requires a priced reward and rejects ambiguous bundle matches', () => {
  const text = 'Kup sok i dobierz bułkę maślaną za 1 zł';
  assert.equal(
    bundlePromotion(bundlePage(['Kup sok i dobierz bułkę maślaną gratis']), 'Bułka maślana', 100)
      .addOn.value,
    null,
  );
  assert.equal(bundlePromotion(bundlePage([text, text]), 'Bułka maślana', 100).addOn.value, null);
});

test('reads an app and coupon requirement', () => {
  const result = parse('Aktywuj kupon i zeskanuj aplikację');
  assert.equal(result.requiresApp.value, true);
  assert.equal(result.couponActivation.value, true);
});

test('distinguishes a card from an app', () => {
  const result = parse('Z kartą lub apką Moja Biedronka');
  assert.equal(result.requiresApp.value, false);
  assert.equal(result.loyalty.value, 'card-or-app');
});

test('reads explicit negative requirements', () => {
  const result = parse('Bez aplikacji. Nie wymaga aktywacji kuponu');
  assert.equal(result.requiresApp.value, false);
  assert.equal(result.couponActivation.value, false);
});

test('does not mix alternative price conditions', () => {
  assert.equal(
    parse('Tylko z aplikacją 2,49 zł; cena bez aplikacji 4,99 zł').requiresApp.value,
    null,
  );
});

test('reads 2+2 and 2+1 rules', () => {
  assert.deepEqual(parse('2+2 gratis').multiBuy.value, { kind: 'buy-get', paid: 2, free: 2 });
  assert.equal(parse('2+2 gratis').minimumQuantity.value, 4);
  assert.equal(parse('2+1 gratis').minimumQuantity.value, 3);
  assert.equal(parse('2+2').multiBuy.value, null);
});

test('reads a quantity-dependent unit price', () => {
  const result = parse('Cena za 1 opak. przy zakupie 3 opak.');
  assert.equal(result.minimumQuantity.value, 3);
  assert.deepEqual(result.priceLabels.value, ['conditional-unit']);
});

test('keeps conflicting requirements unresolved', () => {
  const result = parse('Tylko z aplikacją', 'Bez aplikacji');
  assert.equal(result.requiresApp.value, null);
  assert.equal(result.requiresApp.status, 'conflict');
  assert.ok(result.conflicts.includes('requiresApp'));
});

test('rejects low-confidence OCR signals', () => {
  const result = parsePromotionConditions([
    { text: '2+2 gratis', sourceUrl: url, origin: 'ocr', confidence: 0.8 },
  ]);
  assert.equal(result.multiBuy.value, null);
  assert.equal(result.sourceTexts.length, 1);
});

test('does not join separate numbers', () => {
  assert.equal(parse('przy zakupie 3 49').minimumQuantity.value, 3);
  assert.equal(parse('przy zakupie 349').minimumQuantity.value, null);
});

test('reads captured Pilos terms', () => {
  const result = example('lidl-009');
  assert.equal(result.requiresApp.value, true);
  assert.equal(result.couponActivation.value, true);
  assert.equal(result.minimumQuantity.value, 3);
  assert.equal(result.limitText.value, 'limit:3opak.nakupon');
});

test('reads captured turkey terms', () => {
  const result = example('lidl-014');
  assert.equal(result.requiresApp.value, true);
  assert.equal(result.couponActivation.value, true);
  assert.equal(result.limitText.value, 'limit:3kgnakupon');
});

test('reads captured Biedronka butter terms', () => {
  const result = example('biedronka-015');
  assert.equal(result.requiresApp.value, false);
  assert.equal(result.loyalty.value, 'card-or-app');
  assert.equal(result.minimumQuantity.value, 3);
});

test('reads a captured second-item discount', () => {
  assert.deepEqual(example('biedronka-016').multiBuy.value, {
    kind: 'nth-discount',
    position: 2,
    percent: 60,
  });
});

test('reads a captured milk quantity', () => {
  assert.equal(example('biedronka-023').minimumQuantity.value, 6);
  assert.equal(example('lidl-045').minimumQuantity.value, 6);
  assert.equal(example('lidl-045').requiresApp.value, null);
});

test('reads a captured 1+1 rule without changing its price', () => {
  const result = example('pdf-lidl-060');
  assert.deepEqual(result.multiBuy.value, { kind: 'buy-get', paid: 1, free: 1 });
  assert.deepEqual(result.priceLabels.value, ['regular']);
});

test('reads captured coffee terms', () => {
  const result = example('biedronka-005');
  assert.deepEqual(result.multiBuy.value, { kind: 'nth-discount', position: 2, percent: 80 });
});

test('preserves the candidate and source text', async () => {
  const rows = JSON.parse(
    await readFile(new URL('./adapters/__fixtures__/blix-sample.json', import.meta.url), 'utf8'),
  );
  const raw = Array.isArray(rows) ? rows : rows.offers;
  const html = `<script>window.offers = ${JSON.stringify(raw)};</script>`;
  const candidate = parseBlixCandidates(html, 'https://blix.pl/sklep/biedronka/gazetka/534003/')
    .candidates[0];
  assert.ok(candidate);
  const result = enrichConditions(candidate, [
    { text: '2+2 gratis', sourceUrl: candidate.sourceUrl, origin: 'html' },
  ]);
  assert.equal(result.requiresApp, null);
  assert.equal(result.reportedPrice, candidate.reportedPrice);
  assert.equal(result.priceBasis, 'unknown');
  assert.equal(result.promotion.sourceTexts[0].text, '2+2 gratis');
});

test('rejects ambiguous or missing image metadata', () => {
  assert.throws(
    () =>
      ocrRegion('<script>window.offers = [];</script>', {
        id: 'blix:biedronka:534219:x',
        store: 'biedronka',
        leafletId: '534219',
      } as never),
    /Ambiguous product region/,
  );
});

test('does not borrow unrelated product descriptions', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./adapters/__fixtures__/blix-sample.json', import.meta.url), 'utf8'),
  );
  const rows = Array.isArray(fixture) ? fixture : fixture.offers;
  const html = `<script>window.offers = ${JSON.stringify(rows)};</script>`;
  const candidate = parseBlixCandidates(html, 'https://blix.pl/sklep/biedronka/gazetka/534003/')
    .candidates[0];
  const unrelated = {
    ...rows[0],
    productLeafletPageUuid: 'different-product',
    description: 'Tylko z aplikacją',
  };
  assert.equal(
    readConditionSources(
      `<script>window.offers = ${JSON.stringify([...rows, unrelated, null])};</script>`,
      candidate,
    ).length,
    0,
  );
});

test('reads a percentage discount for a quantity', () => {
  assert.deepEqual(parse('30% taniej przy zakupie 2').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 2,
    percent: 30,
  });
  assert.deepEqual(parse('26% taniej przy zakupie 3 sztuk 5,49 zł').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 3,
    percent: 26,
  });
  assert.deepEqual(parse('Przy zakupie 2 opak. 30% taniej').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 2,
    percent: 30,
  });
});

test('combines a quantity with its more specific discount', () => {
  const result = parse('przy zakupie 2', '30% taniej przy zakupie 2');
  assert.deepEqual(result.multiBuy.value, { kind: 'quantity-discount', quantity: 2, percent: 30 });
  assert.equal(result.multiBuy.status, 'detected');
});

test('keeps inconsistent quantity discounts conflicting', () => {
  const result = parse('30% taniej przy zakupie 2', '40% taniej przy zakupie 2');
  assert.equal(result.multiBuy.value, null);
  assert.equal(result.multiBuy.status, 'conflict');
});

test('does not mistake alcohol strength for a discount', () => {
  assert.deepEqual(parse('40% alkoholu przy zakupie 2 butelek').multiBuy.value, {
    kind: 'minimum-quantity',
    quantity: 2,
  });
  assert.deepEqual(parse('-21% przy zakupie 2').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 2,
    percent: 21,
  });
});

test('reads captured quantity discounts', () => {
  assert.deepEqual(example('live-pierogi').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 3,
    percent: 26,
  });
  assert.deepEqual(example('live-circus').multiBuy.value, {
    kind: 'quantity-discount',
    quantity: 2,
    percent: 21,
  });
});
