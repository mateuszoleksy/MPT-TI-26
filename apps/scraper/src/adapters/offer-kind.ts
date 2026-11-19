import type { ConditionEvidence } from './promotion-conditions.js';
const compact = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}|\s/gu, '');
export function classifyOffer(sources: ConditionEvidence[]) {
  const strong = sources.filter((s) => s.origin !== 'ocr' || (s.confidence ?? 0) >= 0.94);
  const text = sources.map((s) => compact(s.text)).join('\n');
  const reduction = strong.filter((s) => /(?:nowa|obecna)cenaregularna/.test(compact(s.text)));
  const regular = strong.filter((s) => /^cenaregularna[.:]?$/.test(compact(s.text)));
  const reference = /stara|poprzednia|przedobniz|najniz|30dni|pozapromoc|nowacen|obecnacen/.test(
    text,
  );
  const terms =
    /taniej|gratis|przyzakup|kupon|rabat|promocj|aplikac|lidlplus|mojabiedronka|zkarta|zapka|[0-9]+\+[0-9]+/.test(
      text,
    );
  const offerKind = reduction.length
    ? ('price-reduction' as const)
    : regular.length && !reference && !terms
      ? ('regular' as const)
      : ('unknown' as const);
  return {
    offerKind,
    offerKindEvidence:
      offerKind === 'regular' ? regular : offerKind === 'price-reduction' ? reduction : [],
  };
}
