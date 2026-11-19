import type { ConditionEvidence, Finding } from './promotion-conditions.js';
import { validatedOcrLines, type PriceReading } from './price-layout.js';

type Portion = { unit: 'kg' | 'l'; amount: number };
const compact = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}|\s/gu, '');
const portion = (text: string): Portion | null => {
  const m = /^(\d+(?:[.,]\d+)?)(kg|g|l|ml)$/.exec(text);
  if (!m) return null;
  const amount = Number(m[1].replace(',', '.')) / (m[2] === 'g' || m[2] === 'ml' ? 1000 : 1);
  return amount > 0 && amount <= 100
    ? { unit: m[2] === 'g' || m[2] === 'kg' ? 'kg' : 'l', amount }
    : null;
};
export function readExplicitPriceBasis(sources: ConditionEvidence[], raw: unknown[]) {
  const accepted = sources.filter((s) => s.origin !== 'ocr' || (s.confidence ?? 0) >= 0.94);
  const lines = validatedOcrLines(raw);
  const evidence = [
    ...accepted,
    ...lines.map((l) => ({
      text: l.text,
      confidence: l.confidence,
      origin: 'ocr' as const,
      sourceUrl: sources[0]?.sourceUrl ?? '',
    })),
  ];
  const portions = evidence.flatMap((e) => {
    const m = /(?:^|\s|\d)\/(\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l))\.?$/.exec(e.text.toLowerCase());
    const value = m && portion(compact(m[1]));
    return value ? [{ value, evidence: e }] : [];
  });
  const unique = new Map(portions.map((p) => [JSON.stringify(p.value), p.value]));
  const priceQuantity: Finding<Portion> = {
    value: unique.size === 1 ? [...unique.values()][0] : null,
    status: unique.size > 1 ? 'conflict' : unique.size ? 'detected' : 'unknown',
    evidence: portions.map((p) => p.evidence),
  };
  const regular: PriceReading[] = [];
  if (raw.length) {
    for (const label of lines.filter((l) => /przedobnizk[aąq]/.test(l.compact))) {
      const h = label.y2 - label.y1;
      const basisLines = lines.filter(
        (l) =>
          l.y1 <= label.y1 &&
          label.y1 - l.y2 <= 2 * h &&
          Math.abs(l.x1 - label.x1) <= h &&
          l.compact.startsWith('cenaza'),
      );
      const bases = basisLines
        .map((l) => portion(l.compact.replace(/^cenaza/, '')))
        .filter((p) => p !== null);
      if (bases.length !== 1) continue;
      for (const amount of lines) {
        if (
          !/^\d+[.,]\d{2}$/.test(amount.compact) ||
          amount.x1 < label.x2 ||
          amount.x1 - label.x2 > 5 * h ||
          Math.abs((amount.y1 + amount.y2 - label.y1 - label.y2) / 2) > 1.5 * h
        )
          continue;
        const value = Number(amount.compact.replace(',', '.'));
        if (value > 0)
          regular.push({
            value: {
              amount: Math.round((value / bases[0].amount) * 1e6) / 1e6,
              basis: bases[0].unit,
            },
            evidence: {
              text: [...basisLines, label, amount].map((l) => l.text).join('\n'),
              origin: 'ocr',
              sourceUrl: sources[0]?.sourceUrl ?? '',
              confidence: Math.min(
                label.confidence,
                amount.confidence,
                ...basisLines.map((l) => l.confidence),
              ),
            },
          });
      }
    }
  } else {
    const captions = accepted.filter((e) =>
      /^cenaza1szt\.?przedobnizk[aąq]\/pozapromocj[aąq]:?$/.test(compact(e.text)),
    );
    const amounts = new Map(
      accepted.filter((e) => /^\d+,\d{2}$/.test(compact(e.text))).map((e) => [compact(e.text), e]),
    );
    if (
      captions.length &&
      amounts.size === 1 &&
      !accepted.some((e) => /najniz|30dni/.test(compact(e.text)))
    ) {
      const amount = [...amounts.values()][0];
      regular.push({
        value: { amount: Number(compact(amount.text).replace(',', '.')), basis: 'item' },
        evidence: {
          text: captions[0].text + '\n' + amount.text,
          origin: amount.origin,
          sourceUrl: amount.sourceUrl,
          confidence: Math.min(captions[0].confidence ?? 1, amount.confidence ?? 1),
        },
      });
    }
  }
  return { priceQuantity, regular };
}
