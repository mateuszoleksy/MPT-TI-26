import type { ConditionEvidence } from './promotion-conditions.js';

export type ReferencePrice = { amount: number; basis: 'item' | 'kg' | 'l' };
export type PriceReading = { value: ReferencePrice; evidence: ConditionEvidence };
type Line = {
  text: string;
  compact: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}|\s/gu, '');
const height = (line: Line) => line.y2 - line.y1;
const center = (line: Line) => (line.y1 + line.y2) / 2;
const aligned = (a: Line, b: Line) =>
  Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 * Math.min(a.x2 - a.x1, b.x2 - b.x1);

export function validatedOcrLines(input: unknown[], minimumConfidence = 0.94) {
  const lines: Line[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const row = value as { text?: unknown; confidence?: unknown; box?: unknown };
    if (
      typeof row.text !== 'string' ||
      typeof row.confidence !== 'number' ||
      !Number.isFinite(row.confidence) ||
      row.confidence < minimumConfidence ||
      !Array.isArray(row.box) ||
      row.box.length !== 4
    )
      continue;
    if (
      !row.box.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0),
      )
    )
      continue;
    const box = row.box as number[][];
    const [x1, y1, x2, y2] = [
      Math.min(...box.map((p) => p[0])),
      Math.min(...box.map((p) => p[1])),
      Math.max(...box.map((p) => p[0])),
      Math.max(...box.map((p) => p[1])),
    ];
    if (x2 > x1 && y2 > y1)
      lines.push({
        text: row.text,
        compact: normalize(row.text),
        confidence: row.confidence,
        x1,
        y1,
        x2,
        y2,
      });
  }
  return lines;
}

export function readCorroboratedQuantity(
  input: unknown[],
  sourceUrl: string,
  reportedPrice?: number,
) {
  if (!reportedPrice || !Number.isFinite(reportedPrice)) return [];
  const lines = validatedOcrLines(input, 0.9);
  const result: { value: { unit: 'kg' | 'l'; amount: number }; evidence: ConditionEvidence }[] = [];
  for (const label of lines.filter((line) => line.confidence >= 0.92)) {
    if (/limit|cena|maks|obciaz|\/|\d[x×]\d/.test(label.compact)) continue;
    const size = /(\d+(?:[.,]\d+)?)(kg|g|ml|l)$/.exec(label.compact);
    if (!size) continue;
    const unit = size[2] === 'kg' || size[2] === 'g' ? ('kg' as const) : ('l' as const);
    const amount =
      Number(size[1].replace(',', '.')) / (size[2] === 'g' || size[2] === 'ml' ? 1000 : 1);
    for (const rate of lines) {
      const price = /^(\d+[.,]\d{2})(?:zl|zt|z1)?\/(kg|l)$/.exec(rate.compact);
      if (
        !price ||
        price[2] !== unit ||
        !aligned(rate, label) ||
        rate.y1 < label.y2 ||
        rate.y1 - label.y2 > 3 * height(label)
      )
        continue;
      if (
        amount <= 0 ||
        Math.abs(Number(price[1].replace(',', '.')) * amount - reportedPrice) > 0.005
      )
        continue;
      result.push({
        value: { unit, amount },
        evidence: {
          text: label.text + '\n' + rate.text,
          sourceUrl,
          origin: 'ocr',
          confidence: Math.min(label.confidence, rate.confidence),
        },
      });
    }
  }
  return result;
}

export function readPriceLayout(
  input: unknown[],
  sourceUrl: string,
  quantity?: { unit: 'kg' | 'l' | 'szt'; amount: number } | null,
) {
  const lines = validatedOcrLines(input);
  const uncertainLines = validatedOcrLines(input, 0.7);
  const labels = validatedOcrLines(input, 0.9);
  for (const first of lines.filter((l) => /^cena(?:za1(?:szt|opak)\.?)?$/.test(l.compact))) {
    const following = lines
      .filter(
        (l) =>
          l.y1 >= first.y2 &&
          l.y1 - first.y2 <= 3 * height(first) &&
          aligned(l, first) &&
          /^(?:za1(?:szt|opak)\.?)?(?:przedobnizka\/?)?(?:poza(?:promocj[a-z]?:?)?|promocj[a-z]?:?)?$/.test(
            l.compact,
          ),
      )
      .sort((a, b) => a.y1 - b.y1)
      .slice(0, 3);
    const compact = first.compact + following.map((l) => l.compact).join('');
    if (/^cenaza1(?:szt|opak)\.?(?:przedobnizka\/?)?pozapromocj[a-z]?:?$/.test(compact))
      labels.push({
        ...first,
        text: [first, ...following].map((l) => l.text).join(' '),
        compact,
        x2: Math.max(first.x2, ...following.map((l) => l.x2)),
        y2: Math.max(first.y2, ...following.map((l) => l.y2)),
        confidence: Math.min(first.confidence, ...following.map((l) => l.confidence)),
      });
  }
  const regular: PriceReading[] = [];
  const lowest30Days: PriceReading[] = [];
  for (const label of labels) {
    const outside = /pozapromocj[a-z]?/.test(label.compact);
    const lowest = /na[jin]+izszacena/.test(label.compact);
    if (!outside && !lowest) continue;
    const h = height(label);
    const column = lines.filter(
      (line) =>
        aligned(line, label) &&
        center(line) <= center(label) + h &&
        center(line) >= center(label) - 5 * h,
    );
    const context = column.sort((a, b) => a.y1 - b.y1);
    const contextText = context.map((line) => line.compact).join('');
    const uncertainContext = uncertainLines
      .filter(
        (line) =>
          aligned(line, label) &&
          center(line) <= center(label) + h &&
          center(line) >= center(label) - 5 * h,
      )
      .sort((a, b) => a.y1 - b.y1)
      .map((line) => line.compact)
      .join('');
    const isLowest = lowest || (/na[jin]+izszacena/.test(contextText) && /30dni/.test(contextText));
    if (
      lowest &&
      !/30dni/.test(
        contextText +
          lines
            .filter(
              (line) => aligned(line, label) && line.y1 >= label.y1 && line.y1 - label.y2 <= 2 * h,
            )
            .map((line) => line.compact)
            .join(''),
      )
    )
      continue;
    const declaredUnit = /cenaza1(kg|l)/.exec(contextText)?.[1];
    if (!isLowest && /na[jin]+izszacena/.test(uncertainContext) && /30dni/.test(uncertainContext))
      continue;
    if (!declaredUnit && /cenaza1(?:kg|l)/.test(uncertainContext)) continue;
    for (const amountLine of validatedOcrLines(input, 0.88)) {
      if (amountLine === label) continue;
      const amount =
        /^(?:1(kg|l)=)?(\d{1,5}[.,]\d{2})(?:zl)?(?:\/(kg|l|opak\.?|szt\.?))?\*?[,;.]?$/.exec(
          amountLine.compact,
        );
      if (!amount) continue;
      if (amountLine.confidence < 0.94) {
        const duplicate = lines.find(
          (proof) =>
            proof.confidence >= 0.97 &&
            proof.compact === amountLine.compact &&
            Math.abs(proof.y1 - amountLine.y1) <= 2 * h &&
            Math.abs(proof.x1 - amountLine.x1) > 2 * h,
        );
        const labelledLowest =
          duplicate &&
          labels.some(
            (other) =>
              /na[jin]+izszacena/.test(other.compact) &&
              other.confidence >= 0.94 &&
              duplicate.x1 >= other.x2 &&
              duplicate.x1 - other.x2 <= 6 * height(other) &&
              Math.abs(center(duplicate) - center(other)) <= 3 * height(other) &&
              lines.some(
                (line) =>
                  aligned(line, other) &&
                  /30dni/.test(line.compact) &&
                  Math.abs(line.y1 - other.y1) <= 3 * height(other),
              ),
          );
        if (!outside || label.confidence < 0.94 || !labelledLowest) continue;
      }

      const unit = amount[1] ?? amount[3];
      if (unit?.startsWith('szt') && quantity?.unit === 'szt' && quantity.amount > 1) continue;
      const basis =
        unit === 'kg' || unit === 'l'
          ? unit
          : declaredUnit === 'kg' || declaredUnit === 'l'
            ? declaredUnit
            : 'item';
      if (unit && (unit === 'kg' || unit === 'l') && !amount[1] && declaredUnit !== unit) continue;
      const right =
        amountLine.x1 >= label.x2 - h &&
        amountLine.x1 - label.x2 <= 6 * h &&
        Math.abs(center(amountLine) - center(label)) <= 2 * h;
      const below =
        aligned(amountLine, label) &&
        Math.abs(amountLine.x1 - label.x1) <= h &&
        amountLine.y1 >= label.y2 &&
        amountLine.y1 - label.y2 <= 1.5 * h;
      if (!right && !below) continue;
      const value = Number(amount[2].replace(',', '.'));
      if (value <= 0) continue;
      if (label.confidence < 0.94) {
        const lowestProof =
          lowest &&
          amountLine.confidence >= 0.98 &&
          lines.some(
            (line) =>
              aligned(line, label) &&
              Math.abs(center(line) - center(label)) <= 3 * h &&
              /z30dni/.test(line.compact),
          );
        const regularProof =
          outside &&
          quantity &&
          amountLine.confidence >= 0.98 &&
          validatedOcrLines(input, 0.9).some((line) => {
            const rate = /^(\d+[.,]\d{2})(?:zl|zt|z1)?\/(kg|l|szt\.?)$/.exec(line.compact);
            return (
              rate &&
              rate[2].replace('.', '') === quantity.unit &&
              aligned(line, amountLine) &&
              line.y1 >= amountLine.y1 &&
              line.y1 - amountLine.y2 <= h &&
              Math.abs(Number(rate[1].replace(',', '.')) * quantity.amount - value) <=
                0.005 * (quantity.unit === 'szt' ? quantity.amount : 1)
            );
          });
        if (!lowestProof && !regularProof) continue;
      }
      const proofLines =
        label.confidence < 0.94
          ? validatedOcrLines(input, 0.9).filter((line) => {
              const rate = /^(\d+[.,]\d{2})(?:zl|zt|z1)?\/(kg|l|szt\.?)$/.exec(line.compact);
              return (
                quantity &&
                rate &&
                rate[2].replace('.', '') === quantity.unit &&
                aligned(line, amountLine) &&
                line.y1 >= amountLine.y1 &&
                line.y1 - amountLine.y2 <= h &&
                Math.abs(Number(rate[1].replace(',', '.')) * quantity.amount - value) <= 0.005
              );
            })
          : [];
      const duplicateProof =
        amountLine.confidence < 0.94
          ? lines.filter(
              (line) =>
                line.confidence >= 0.97 &&
                line.compact === amountLine.compact &&
                Math.abs(line.y1 - amountLine.y1) <= 2 * h,
            )
          : [];
      const used = [...new Set([label, ...context, amountLine, ...proofLines, ...duplicateProof])];
      (isLowest ? lowest30Days : regular).push({
        value: { amount: value, basis },
        evidence: {
          text: used.map((line) => line.text).join('\n'),
          sourceUrl,
          origin: 'ocr',
          confidence: Math.min(...used.map((line) => line.confidence)),
        },
      });
    }
  }
  return { regular, lowest30Days };
}
