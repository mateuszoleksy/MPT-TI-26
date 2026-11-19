import type { ConditionEvidence, Finding } from './promotion-conditions.js';

export interface PieceQuantity {
  unit: 'szt';
  amount: number;
  kind: string;
}
export interface UnitPriceObservation {
  amount: number;
  unit: 'kg' | 'l' | 'szt' | 'opak';
  perQuantity: number;
  priceRole: 'unassigned';
  evidence: ConditionEvidence;
}
const normalized = (text: string) =>
  text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '');
const numeric = (text: string) => Number(text.replace(',', '.'));
const trusted = (row: ConditionEvidence) =>
  row.origin !== 'ocr' || (Number.isFinite(row.confidence) && row.confidence! >= 0.94);

export function readPackageContents(sources: ConditionEvidence[]) {
  const pieces: { value: PieceQuantity; evidence: ConditionEvidence }[] = [];
  const unitPrices: UnitPriceObservation[] = [];
  const observations: ConditionEvidence[] = [];
  const ranges: ConditionEvidence[] = [];
  for (const evidence of sources) {
    const text = normalized(evidence.text);
    if (
      /\d/.test(text) &&
      /\d+[.,]\d{2}|\d\s*(?:kg|g|ml|l|szt|toreb|kaps|tablet)|^\s*\d{1,6}\s*$/.test(text)
    )
      observations.push(evidence);
    if (!trusted(evidence)) continue;
    const moneyFirst =
      /(\d+[.,]\d{2})(?:\s*z[l1t])?\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?(kg|ml|cl|dl|g|l|szt\.?|opak\.?)(?![a-z])/g;
    const quantityFirst =
      /(\d+(?:[.,]\d+)?)\s*(kg|ml|cl|dl|g|l|szt\.?|opak\.?)\s*=\s*(\d+[.,]\d{2})(?!\d)/g;
    const addRate = (amount: string, count: string, original: string) => {
      const unit = original.startsWith('szt')
        ? 'szt'
        : original.startsWith('opak')
          ? 'opak'
          : original === 'g' || original === 'kg'
            ? 'kg'
            : 'l';
      const perQuantity =
        numeric(count) *
        (original === 'g' || original === 'ml'
          ? 0.001
          : original === 'cl'
            ? 0.01
            : original === 'dl'
              ? 0.1
              : 1);
      if (numeric(amount) > 0 && perQuantity > 0)
        unitPrices.push({
          amount: numeric(amount),
          unit,
          perQuantity,
          priceRole: 'unassigned',
          evidence,
        });
    };
    for (const m of text.matchAll(moneyFirst)) addRate(m[1], m[2] ?? '1', m[3]);
    for (const m of text.matchAll(quantityFirst)) addRate(m[3], m[1], m[2]);
    if (
      /przy\s*zakupie|kazd[ae]\s*z\s*\d|limit|gratis|cena\s*za|dziennie|na\s*(?:karte|paragon)/.test(
        text,
      )
    )
      continue;
    if (/\d+\s*(?:[-–]|lub|do)\s*\d+\s*(?:szt|toreb|kaps|tablet)/.test(text)) {
      ranges.push(evidence);
      continue;
    }
    for (const pack of text.matchAll(/(?<!\d)(\d{1,4})\s*-?\s*pak\b/g)) {
      if (Number(pack[1]) > 0)
        pieces.push({ value: { unit: 'szt', amount: Number(pack[1]), kind: 'szt' }, evidence });
    }
    const pattern =
      /(?<![\d.])(?<!\d,)(?:(\d{1,3})\s*[x×]\s*)?(\d{1,4})\s*(torebek|torebki|torebka|kapsulek|kapsulki|kapsulka|tabletek|tabletki|tabletka|sztuk(?:i)?|szt\.?|wkladow|wklady)(?![a-z])/g;
    for (const m of text.matchAll(pattern)) {
      const before = text.slice(0, m.index);
      const after = text.slice(m.index! + m[0].length);
      if (/\/\s*$/.test(before) || /^\s*=/.test(after) || /\d\s*[x×]\s*$/.test(before)) continue;
      const amount = Number(m[1] ?? 1) * Number(m[2]);
      const kind = m[3].startsWith('toreb')
        ? 'torebka'
        : m[3].startsWith('kaps')
          ? 'kapsulka'
          : m[3].startsWith('tablet')
            ? 'tabletka'
            : m[3].startsWith('wklad')
              ? 'wklad'
              : 'szt';
      if (amount > 0 && amount <= 10000)
        pieces.push({ value: { unit: 'szt', amount, kind }, evidence });
    }
  }
  const unique = new Map(pieces.map((row) => [row.value.amount, row.value]));
  const pieceQuantity: Finding<PieceQuantity> = {
    value: !ranges.length && unique.size === 1 ? [...unique.values()][0] : null,
    status: ranges.length || unique.size > 1 ? 'conflict' : unique.size ? 'detected' : 'unknown',
    evidence: [...pieces.map((row) => row.evidence), ...ranges],
  };
  return {
    pieceQuantity,
    unitPrices: [
      ...new Map(
        unitPrices.map((row) => [
          JSON.stringify([row.amount, row.unit, row.perQuantity, row.evidence.text]),
          row,
        ]),
      ).values(),
    ],
    unassignedReadings: [
      ...new Map(
        observations.map((row) => [JSON.stringify([row.text, row.origin, row.confidence]), row]),
      ).values(),
    ],
  };
}
