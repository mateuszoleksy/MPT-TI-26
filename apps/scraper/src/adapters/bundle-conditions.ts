import type { OcrResult } from '../condition-ocr.js';
import { validatedOcrLines } from './price-layout.js';
import {
  appOnlyCondition,
  bundleAddOnMinConfidence,
  cardOrAppCondition,
  type ConditionEvidence,
} from './promotion-conditions.js';

type Line = ReturnType<typeof validatedOcrLines>[number];
type Evidence = Pick<ConditionEvidence, 'text' | 'scope'> & { confidence: number };
type Bundle = {
  product: string;
  priceInGrosze: number;
  evidence: Evidence;
  loyalty?: Evidence;
};

const currency = String.raw`(?:z[lt1])`;
const pricedReward = new RegExp(
  String.raw`^([a-z][a-z0-9,-]*?)za(\d{1,3})(?:[,.](\d{2}))?` + currency,
);
const pricedPurchase = new RegExp(String.raw`za\d{1,3}(?:[,.]\d{2})?` + currency + '$');
const loyaltyText = (text: string) =>
  cardOrAppCondition.test(text) ||
  appOnlyCondition.test(text) ||
  /ofertazaplikacja|tylkozkarta/u.test(text);

function rewardFrom(text: string) {
  const rewardFirst = /^(?:dobierz|odbierz|wez|dokup)(?:1(?=[a-z]))?/.exec(text);
  if (rewardFirst) {
    const offer = text.slice(rewardFirst[0].length);
    const match = pricedReward.exec(offer);
    return match && /^przyzakupie[a-z0-9]/.test(offer.slice(match[0].length)) ? match : null;
  }
  if (!/^kup(?:jednorazowo)?[a-z0-9]/.test(text)) return null;
  const split = /(?:i|,|;)(?:dobierz|odbierz|wez|dokup)|oraz(?:1|jedna)/.exec(text);
  if (!split || split.index <= 3) return null;
  if (split[0].startsWith('oraz') && !pricedPurchase.test(text.slice(0, split.index))) return null;
  return pricedReward.exec(text.slice(split.index + split[0].length).replace(/^1(?=[a-z])/, ''));
}

function follows(previous: Line, next: Line) {
  const height = Math.max(previous.y2 - previous.y1, next.y2 - next.y1);
  const overlap = Math.min(previous.x2, next.x2) - Math.max(previous.x1, next.x1);
  return (
    next.y1 > previous.y1 + height / 2 &&
    next.y1 <= previous.y2 + height &&
    overlap >= Math.min(previous.x2 - previous.x1, next.x2 - next.x1) / 2
  );
}

export function readPageBundles(page: OcrResult) {
  if (page.error) return [];
  const lines = validatedOcrLines(page.ocrLines ?? [], bundleAddOnMinConfidence).sort(
    (a, b) => a.y1 - b.y1,
  );
  const bundles: Bundle[] = [];
  for (const first of lines) {
    if (!/^(?:kup|dobierz|odbierz|wez|dokup)/.test(first.compact)) continue;
    const paragraph = [first];
    for (const line of lines) {
      if (paragraph.length < 4 && follows(paragraph.at(-1)!, line)) paragraph.push(line);
    }
    const match = rewardFrom(paragraph.map((line) => line.compact).join(''));
    if (!match) continue;
    const [, product, whole, cents] = match;
    const loyalty = paragraph.find((line) => loyaltyText(line.compact));
    bundles.push({
      product: product.replace(/,?\d+(?:[,.]\d+)?(?:ml|kg|g|l|szt)$/, ''),
      priceInGrosze: Number(whole) * 100 + Number(cents ?? 0),
      evidence: {
        text: paragraph.map((line) => line.text).join(' '),
        confidence: Math.min(...paragraph.map((line) => line.confidence)),
        scope: 'bundle-add-on',
      },
      ...(loyalty && {
        loyalty: { text: loyalty.text, confidence: loyalty.confidence, scope: 'bundle-loyalty' },
      }),
    });
  }

  const pageHeight = page.bbox?.[3];
  if (bundles.length === 1 && !bundles[0].loyalty && pageHeight) {
    const heading = validatedOcrLines(page.ocrLines ?? [], 0.85).find(
      (line) => line.y2 < pageHeight / 4 && line.compact.includes('zestaw'),
    );
    const loyalty =
      heading &&
      lines.find(
        (line) =>
          line.y2 < pageHeight / 4 &&
          line.y1 > heading.y2 &&
          line.compact.startsWith('oferta') &&
          loyaltyText(line.compact),
      );
    if (loyalty)
      bundles[0].loyalty = {
        text: loyalty.text,
        confidence: loyalty.confidence,
        scope: 'bundle-loyalty',
      };
  }
  return bundles;
}

const productWord = (value: string) =>
  value.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').replace(/q/g, 'a');

export function matchBundleConditions(
  bundles: Bundle[],
  product: { name: string; priceInGrosze: number } | undefined,
): Evidence[] {
  if (!product) return [];
  const words = productWord(product.name).match(/[a-z0-9]+/g) ?? [];
  if (words.length < 2 || !words.every((word) => word.length > 1)) return [];
  const name = new RegExp(
    '^' +
      words
        .map((word) => (word.length >= 4 && /[ae]$/.test(word) ? word.slice(0, -1) + '[ae]' : word))
        .join('') +
      '$',
  );
  const match = bundles.filter(
    (bundle) =>
      bundle.priceInGrosze === product.priceInGrosze &&
      name.test(productWord(bundle.product).replace(/[^a-z0-9]/g, '')),
  );
  if (match.length !== 1) return [];
  const [{ evidence, loyalty }] = match;
  return loyalty ? [evidence, loyalty] : [evidence];
}
