import { validatedOcrLines } from './price-layout.js';
import type { ConditionEvidence } from './promotion-conditions.js';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function readAssortment(name: string, sources: ConditionEvidence[], raw: unknown[]) {
  const lines = validatedOcrLines(raw, 0.92);
  if (
    !sources.some(
      (s) =>
        (s.origin !== 'ocr' || (s.confidence ?? 0) >= 0.94) &&
        /roznerodzaje/.test(normalize(s.text).replace(/ /g, '')),
    )
  )
    return null;
  const matches = lines.flatMap((line) => {
    const m = /^(.+?)[,;]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)$/i.exec(line.text);
    if (!m || normalize(m[1]).split(' ').length < 2) return [];
    const base = normalize(m[1]),
      title = normalize(name);
    if (title !== base && !title.startsWith(base + ' ')) return [];
    const suffix = title.slice(base.length).trim();
    if (suffix && !lines.some((l) => l.confidence >= 0.94 && normalize(l.text) === suffix))
      return [];
    const amount =
      Number(m[2].replace(',', '.')) /
      (m[3].toLowerCase() === 'g' || m[3].toLowerCase() === 'ml' ? 1000 : 1);
    if (!(amount > 0 && amount <= 100)) return [];
    return [
      {
        name: m[1].trim(),
        unit: ['g', 'kg'].includes(m[3].toLowerCase()) ? ('kg' as const) : ('l' as const),
        amount,
        evidence: {
          text: line.text,
          confidence: line.confidence,
          origin: 'ocr' as const,
          sourceUrl: sources[0]?.sourceUrl ?? '',
        },
      },
    ];
  });
  const unique = new Set(matches.map((m) => JSON.stringify([normalize(m.name), m.unit, m.amount])));
  return unique.size === 1 ? matches[0] : null;
}
