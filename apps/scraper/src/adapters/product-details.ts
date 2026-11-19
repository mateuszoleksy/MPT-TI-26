import { readExplicitPriceBasis } from './explicit-price-basis.js';
import type { BlixCandidate } from './blix-parser.js';
import type { ConditionEvidence, Finding } from './promotion-conditions.js';
import { readCorroboratedQuantity, readPriceLayout, validatedOcrLines } from './price-layout.js';
import { readPackageContents } from './package-contents.js';
import { readRegularPriceChanges } from './regular-price-change.js';

type Quantity = { unit: 'kg' | 'l'; amount: number };
type Price = { amount: number; basis: 'item' | 'kg' | 'l' };

const normalize = (text: string) =>
  text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '');
const number = (text: string) => Number(text.replace(',', '.'));
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const accepted = (source: ConditionEvidence) =>
  source.origin !== 'ocr' || (Number.isFinite(source.confidence) && source.confidence! >= 0.94);

function finding<T>(rows: { value: T; evidence: ConditionEvidence }[]): Finding<T> {
  const unique = new Map(rows.map((row) => [JSON.stringify(row.value), row.value]));
  return {
    value: unique.size === 1 ? [...unique.values()][0] : null,
    status: unique.size > 1 ? 'conflict' : unique.size ? 'detected' : 'unknown',
    evidence: rows.map((row) => row.evidence),
  };
}

export function parseProductDetails(
  name: string,
  sourceUrl: string,
  sources: ConditionEvidence[],
  rawLines: unknown[] = [],
  reportedPrice?: number,
) {
  const texts = [
    { text: name, sourceUrl, origin: 'json' as const },
    ...sources.filter(accepted),
    ...validatedOcrLines(rawLines).map((line) => ({
      text: line.text,
      confidence: line.confidence,
      origin: 'ocr' as const,
      sourceUrl,
    })),
  ];
  let quantities: { value: Quantity; evidence: ConditionEvidence }[] = [];
  const raw = validatedOcrLines(rawLines);
  const rawTexts = new Set(raw.map((line) => line.text));
  const ranges: ConditionEvidence[] = [];
  const prices: Record<
    'regular' | 'lowest30Days' | 'withoutMultiBuy' | 'previous' | 'currentRegular',
    { value: Price; evidence: ConditionEvidence }[]
  > = {
    regular: [],
    lowest30Days: [],
    withoutMultiBuy: [],
    previous: [],
    currentRegular: [],
  };
  const hasLowestLabel = texts.some((row) =>
    /najnizsza\s*cena\s*z?\s*30\s*dni/.test(normalize(row.text)),
  );
  for (const evidence of texts) {
    const text = normalize(evidence.text);
    const rawLine = raw.find((line) => line.text === evidence.text);
    const quantityContext =
      text +
      (rawLine
        ? raw
            .filter(
              (line) =>
                line.y1 < rawLine.y1 &&
                line.y2 <= rawLine.y1 + 0.4 * (rawLine.y2 - rawLine.y1) &&
                rawLine.y1 - line.y2 <= 3 * (rawLine.y2 - rawLine.y1) &&
                Math.min(line.x2, rawLine.x2) - Math.max(line.x1, rawLine.x1) >
                  0.5 * Math.min(line.x2 - line.x1, rawLine.x2 - rawLine.x1),
            )
            .map((line) => normalize(line.text))
            .join(' ')
        : '');
    if (
      /\d+(?:[.,]\d+)?\s*(?:kg|ml|cl|dl|g|l)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*(?:kg|ml|cl|dl|g|l)(?![a-z])/.test(
        text,
      )
    )
      ranges.push(evidence);
    if (
      (!rawLines.length || evidence.origin !== 'ocr' || rawTexts.has(evidence.text)) &&
      !/limit|maksymal|dziennie|na\s*(?:karte|paragon)|masa\s*po\s*odsaczeniu|obciazenie|poj\s*[:.]|pojemnosc|zbiornik|(?:g|ml)\s*\/\s*min/.test(
        quantityContext,
      )
    ) {
      const pattern =
        /(?<![\d.])(?<!\d,)(?:(\d{1,2})\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|ml|cl|dl|g|l)(?![a-z0-9])/g;
      for (const match of text.matchAll(pattern)) {
        const prefix = text.slice(0, match.index);
        const suffix = text.slice(match.index! + match[0].length);
        if (/(?:cena\s*za|\/)\s*$/.test(prefix)) continue;
        if (
          /^\s*(?:=|:\s*\d|za\b)/.test(suffix) ||
          /[\d.,]\s*[-–]\s*$/.test(prefix) ||
          /^\s*[-–]\s*\d/.test(suffix)
        )
          continue;
        if (/\d\s*(?:x|×)\s*$/.test(prefix)) continue;
        const count = match[1] ? number(match[1]) : 1;
        const amount = number(match[2]);
        const scale = { g: 0.001, kg: 1, ml: 0.001, cl: 0.01, dl: 0.1, l: 1 }[match[3]]!;
        const total = rounded(count * amount * scale);
        if (count > 0 && total > 0 && total <= 100)
          quantities.push({
            value: { unit: ['kg', 'g'].includes(match[3]) ? 'kg' : 'l', amount: total },
            evidence,
          });
      }
    }
    const compact = text.replace(/\s+/g, '');
    const previous = /staracenaregularna|poprzedniacena(?:regularna)?/.test(compact);
    const current = /(?:nowa|obecna)cenaregularna/.test(compact);
    const lowest = /najnizszacenaz?30dni/.test(compact);
    const regular =
      /cenaregularna|cena(?:za1(?:szt|opak)\.?)?(?:przedobnizka\/?)?pozapromocj[aąq]/.test(compact);
    const single = /cenabez(?:zakupu|promocjiwielosztukowej)|cenaprzyzakupie1(?:szt|opak)/.test(
      compact,
    );
    const kind = previous
      ? 'previous'
      : current
        ? 'currentRegular'
        : lowest
          ? 'lowest30Days'
          : regular && !hasLowestLabel
            ? 'regular'
            : single
              ? 'withoutMultiBuy'
              : null;
    if (!kind) continue;
    const label =
      kind === 'previous'
        ? /(?:staracenaregularna[,/]?(?:cenaprzedobnizk[aąq])?|poprzedniacena(?:regularna)?)[:/]?/
        : kind === 'currentRegular'
          ? /(?:nowa|obecna)cenaregularna[:/]?/
          : kind === 'lowest30Days'
            ? /najnizszacenaz?30dni(?:przedobnizk[aąq])?(?:\/cenapozapromocj[aąq])?[:/]?/
            : kind === 'regular'
              ? /(?:cenaregularna|cena(?:za1(?:szt|opak)\.?)?(?:przedobnizka\/?)?pozapromocj[aąq])[:/]?/
              : /(?:cenabez(?:zakupu\d*(?:szt|opak)?|promocjiwielosztukowej)|cenaprzyzakupie1(?:szt|opak))[:/]?/;
    const labelMatch = label.exec(compact);
    if (!labelMatch) continue;
    const tail = compact.slice(labelMatch.index + labelMatch[0].length);
    const value =
      /^(?:(1)(kg|l)=)?(\d{1,5}[.,]\d{2})(?!\d)(?:(?:zl)?\/(kg|l|opak\.?|szt\.?))?(?:zl)?/.exec(
        tail,
      );
    if (!value) continue;
    if (/^(?:\/|za\d|%|[-–]\d)/.test(tail.slice(value[0].length))) continue;
    const amount = number(value[3]);
    const basis = value[2] ?? value[4];
    if (amount > 0)
      prices[kind].push({
        value: { amount, basis: basis === 'kg' || basis === 'l' ? basis : 'item' },
        evidence,
      });
  }
  quantities.push(...readCorroboratedQuantity(rawLines, sourceUrl, reportedPrice));
  const tokens =
    normalize(name)
      .match(/[a-z]{4,}/g)
      ?.filter(
        (word) =>
          ![
            'produkt',
            'produkty',
            'rozne',
            'rodzaje',
            'smaku',
            'smak',
            'luzem',
            'polskie',
            'polski',
          ].includes(word),
      ) ?? [];
  const declaredCount = /\b(\d{1,2})\s*-?pak\b/.exec(normalize(name));
  if (declaredCount) {
    const pack = raw.find((line) =>
      new RegExp('^' + declaredCount[1] + '[x×]\\d+(?:[.,]\\d+)?(?:g|kg|ml|l):?$', 'i').test(
        line.compact,
      ),
    );
    const match = pack && /^(\d+)[x×](\d+(?:[.,]\d+)?)(g|kg|ml|l)/i.exec(pack.compact);
    if (pack && match) {
      const each =
        Number(match[2].replace(',', '.')) / (match[3] === 'g' || match[3] === 'ml' ? 1000 : 1);
      const amount = rounded(each * Number(match[1]));
      const unit = match[3] === 'g' || match[3] === 'kg' ? ('kg' as const) : ('l' as const);
      if (
        quantities.length &&
        quantities.every(
          (row) =>
            row.value.unit === unit && (row.value.amount === each || row.value.amount === amount),
        )
      )
        quantities = [
          {
            value: { unit, amount },
            evidence: { text: pack.text, origin: 'ocr', confidence: pack.confidence, sourceUrl },
          },
        ];
    }
  }
  const ranked = quantities.map((row) => {
    let context = normalize(row.evidence.text).replace(/\s/g, '');
    const line = raw.find((line) => line.text === row.evidence.text);
    if (line)
      context += raw
        .filter(
          (other) =>
            other !== line &&
            other.y2 <= line.y1 &&
            line.y1 - other.y2 <= 3 * (line.y2 - line.y1) &&
            Math.min(other.x2, line.x2) - Math.max(other.x1, line.x1) >
              0.5 * Math.min(other.x2 - other.x1, line.x2 - line.x1),
        )
        .map((other) => normalize(other.text).replace(/\s/g, ''))
        .join('');
    return {
      row,
      score:
        row.evidence.origin === 'json' && row.evidence.text === name
          ? 100
          : tokens.filter((word) => context.includes(word)).length,
    };
  });
  const best = Math.max(0, ...ranked.map((row) => row.score));
  const ambiguousTitle =
    /zestaw|komplet|\d\s*-?pak|pojemnik|garnek|garnki|brytfanna|misek|miski|kubkow/.test(
      normalize(name),
    );
  if (
    best >= 2 &&
    !ambiguousTitle &&
    !quantities.some((row) => row.evidence.origin === 'json' && row.evidence.text === name)
  )
    quantities = ranked.filter((row) => row.score === best).map((row) => row.row);
  const packageContents = readPackageContents([
    ...texts,
    ...validatedOcrLines(rawLines, 0.7).map((line) => ({
      text: line.text,
      confidence: line.confidence,
      origin: 'ocr' as const,
      sourceUrl,
    })),
  ]);
  const quantity = ranges.length ? null : finding(quantities).value;
  const layout = readPriceLayout(
    rawLines,
    sourceUrl,
    quantity ??
      (!ranges.length && finding(quantities).status === 'unknown'
        ? packageContents.pieceQuantity.value
        : null),
  );
  prices.regular.push(...layout.regular);
  prices.lowest30Days.push(...layout.lowest30Days);
  const changes = readRegularPriceChanges(rawLines, sourceUrl, reportedPrice, quantity);
  prices.previous.push(...changes.previous);
  prices.currentRegular.push(...changes.current);
  const explicitBasis = readExplicitPriceBasis(sources, rawLines);
  for (const reading of explicitBasis.regular) {
    const portion = explicitBasis.priceQuantity.value;
    if (portion && reading.value.basis === portion.unit) {
      const sameAmount = Math.round(reading.value.amount * portion.amount * 100) / 100;
      if (
        prices.regular.some(
          (row) =>
            row.value.basis === 'item' &&
            row.value.amount === sameAmount &&
            /cenaza\d+(?:[.,]\d+)?(?:kg|g|ml|l)/i.test(row.evidence.text.replace(/\s/g, '')),
        )
      )
        reading.value = { amount: sameAmount, basis: 'item' };
    }
    prices.regular.push(reading);
  }
  const comparisonQuantity = quantity;
  const comparable = (rows: { value: Price; evidence: ConditionEvidence }[]) =>
    rows.map((row) =>
      comparisonQuantity && row.value.basis === comparisonQuantity.unit
        ? {
            ...row,
            value: {
              amount: Math.round(row.value.amount * comparisonQuantity.amount * 100) / 100,
              basis: 'item' as const,
            },
          }
        : row,
    );
  return {
    ...packageContents,
    priceQuantity: explicitBasis.priceQuantity,
    quantity: ranges.length
      ? {
          value: null,
          status: 'conflict' as const,
          evidence: [...quantities.map((row) => row.evidence), ...ranges],
        }
      : finding(quantities),
    regularPrice: finding(comparable([...prices.regular, ...prices.currentRegular])),
    previousPrice: finding(comparable(prices.previous)),
    currentRegularPrice: finding(comparable(prices.currentRegular)),
    lowest30DaysPrice: finding(comparable(prices.lowest30Days)),
    withoutMultiBuyPrice: finding(comparable(prices.withoutMultiBuy)),
  };
}

export function enrichProductDetails(
  candidate: BlixCandidate,
  sources: ConditionEvidence[],
  rawLines: unknown[] = [],
) {
  const productDetails = parseProductDetails(
    candidate.name,
    candidate.sourceUrl,
    sources,
    rawLines,
    candidate.reportedPrice,
  );
  const quantity =
    productDetails.quantity.value ??
    (productDetails.quantity.status === 'unknown' ? productDetails.pieceQuantity.value : null);
  const priceQuantity = productDetails.priceQuantity.value;
  const referenceQuantity = priceQuantity ?? quantity;
  const regular = productDetails.regularPrice.value;
  const previous = productDetails.previousPrice.value;
  const priceRegular = regular
    ? regular.basis === 'item'
      ? regular.amount
      : referenceQuantity?.unit === regular.basis
        ? Math.round(regular.amount * referenceQuantity.amount * 100) / 100
        : null
    : null;
  return {
    ...candidate,
    unit: quantity?.unit ?? null,
    unitQuantity: quantity?.amount ?? null,
    priceRegular,
    priceQuantity: productDetails.priceQuantity.value,
    pricePrevious: previous
      ? previous.basis === 'item'
        ? previous.amount
        : quantity?.unit === previous.basis
          ? Math.round(previous.amount * quantity.amount * 100) / 100
          : null
      : null,
    productDetails,
  };
}
