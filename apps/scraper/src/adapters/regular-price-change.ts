import { validatedOcrLines, type PriceReading } from './price-layout.js';

export function readRegularPriceChanges(
  raw: unknown[],
  sourceUrl: string,
  reportedPrice?: number,
  quantity?: { unit: 'kg' | 'l'; amount: number } | null,
) {
  const lines = validatedOcrLines(raw);
  const previous: PriceReading[] = [];
  const current: PriceReading[] = [];
  const aligned = (a: (typeof lines)[number], b: (typeof lines)[number]) =>
    Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 * Math.min(a.x2 - a.x1, b.x2 - b.x1);
  const evidence = (used: typeof lines) => ({
    text: used.map((line) => line.text).join('\n'),
    sourceUrl,
    origin: 'ocr' as const,
    confidence: Math.min(...used.map((line) => line.confidence)),
  });
  const amounts = validatedOcrLines(raw, 0.92).flatMap((line) => {
    const priceText = line.compact.replace(/^(?:cena)?przedobnizk[aąq][:,/]?/, '');
    const m =
      /^(?:1(kg|l)=)?(\d+[.,]\d{2})(?:zl)?(?:\/(kg|l|szt\.?|opak\.?|but\.?))?(?:\*|[.,])?(?=$|,|100(?:g|ml)=)/.exec(
        priceText,
      );
    if (!m) return [];
    const value = Number(m[2].replace(',', '.'));
    if (
      line.confidence < 0.94 &&
      !lines.some(
        (proof) =>
          (proof.compact.endsWith('*') ||
            (proof.confidence >= 0.98 &&
              /^\d+[.,]\d{2}$/.test(proof.compact) &&
              lines.some(
                (label) =>
                  /staracenaregularna|poprzedniacena/.test(label.compact) &&
                  aligned(label, line) &&
                  line.y1 >= label.y1 &&
                  line.y1 - label.y2 <= 3 * (label.y2 - label.y1),
              ))) &&
          Number(proof.compact.replace('*', '').replace(',', '.')) === value &&
          Math.abs(proof.y1 - line.y1) <= 6 * (line.y2 - line.y1),
      )
    )
      return [];
    const unit = m[1] ?? m[3];
    const basis: 'item' | 'kg' | 'l' = unit === 'kg' || unit === 'l' ? unit : 'item';
    return [
      {
        line,
        amount: value,
        basis,
        used: [
          line,
          ...(line.confidence < 0.94
            ? lines.filter(
                (proof) =>
                  (proof.compact.endsWith('*') ||
                    (proof.confidence >= 0.98 &&
                      /^\d+[.,]\d{2}$/.test(proof.compact) &&
                      lines.some(
                        (label) =>
                          /staracenaregularna|poprzedniacena/.test(label.compact) &&
                          aligned(label, line) &&
                          line.y1 >= label.y1 &&
                          line.y1 - label.y2 <= 3 * (label.y2 - label.y1),
                      ))) &&
                  Number(proof.compact.replace('*', '').replace(',', '.')) === value &&
                  Math.abs(proof.y1 - line.y1) <= 6 * (line.y2 - line.y1),
              )
            : []),
        ],
      },
    ];
  });
  for (const whole of lines) {
    if (!/^\d+[,.]?$/.test(whole.compact)) continue;
    for (const cents of lines) {
      const h = whole.y2 - whole.y1;
      if (
        cents === whole ||
        !/^\d{2}$/.test(cents.compact) ||
        cents.x1 < whole.x1 ||
        cents.x1 - whole.x2 > h * 0.6 ||
        cents.x1 < whole.x2 - h * 0.3 ||
        Math.abs(cents.y1 - whole.y1) > h * 0.4 ||
        cents.y2 - cents.y1 >= h * 0.95
      )
        continue;
      amounts.push({
        line: { ...whole, x2: Math.max(whole.x2, cents.x2) },
        amount: Number(whole.compact.replace(/[,.]$/, '')) + Number(cents.compact) / 100,
        basis: 'item',
        used: [whole, cents],
      });
    }
  }
  for (const label of lines) {
    const h = label.y2 - label.y1;
    const continuation = lines.filter(
      (line) =>
        line !== label && aligned(line, label) && line.y1 >= label.y2 && line.y1 - label.y2 <= h,
    );
    const text =
      label.compact +
      continuation
        .sort((a, b) => a.y1 - b.y1)
        .map((line) => line.compact)
        .join('');
    const old = /staracenaregularna|poprzedniacena(?:regularna)?/.test(text);
    const fresh = /(?:nowa|obecna)cenaregularna/.test(text);
    if (!old && !fresh) continue;
    if (fresh && quantity && reportedPrice !== undefined) {
      for (const rate of lines) {
        const match = /^(\d+(?:[.,]\d+)?)(kg|g|l|ml)=(\d+[.,]\d{2})(?:$|\/)/.exec(rate.compact);
        if (!match || !aligned(rate, label)) continue;
        const unit = match[2] === 'g' || match[2] === 'kg' ? 'kg' : 'l';
        const per =
          Number(match[1].replace(',', '.')) / (match[2] === 'g' || match[2] === 'ml' ? 1000 : 1);
        if (
          unit === quantity.unit &&
          per > 0 &&
          Math.abs((Number(match[3].replace(',', '.')) * quantity.amount) / per - reportedPrice) <=
            0.005
        )
          current.push({
            value: { amount: reportedPrice, basis: 'item' },
            evidence: evidence([label, ...continuation, rate]),
          });
      }
    }
    for (const value of amounts) {
      if (value.amount <= 0 || !aligned(value.line, label)) continue;
      if (
        old &&
        (value.line.y1 < label.y2 ||
          value.line.y1 - label.y2 > 4 * h ||
          Math.abs(value.line.x1 - label.x1) > h)
      )
        continue;
      if (
        fresh &&
        (reportedPrice === undefined ||
          Math.abs(value.amount - reportedPrice) > 0.005 ||
          value.line.y2 > label.y1 + h * 0.3 ||
          label.y1 - value.line.y2 > 2 * h)
      )
        continue;
      (old ? previous : current).push({
        value: { amount: value.amount, basis: value.basis },
        evidence: evidence([...new Set([label, ...continuation, ...value.used])]),
      });
    }
  }
  return { previous, current };
}
