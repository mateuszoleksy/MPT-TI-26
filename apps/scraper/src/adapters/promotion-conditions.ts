export interface ConditionEvidence {
  text: string;
  sourceUrl: string;
  origin: 'json' | 'html' | 'ocr' | 'pdf';
  confidence?: number;
  scope?: 'bundle-add-on' | 'bundle-loyalty';
}

export interface Finding<T> {
  value: T | null;
  status: 'unknown' | 'detected' | 'conflict';
  evidence: ConditionEvidence[];
}

export type MultiBuy =
  | { kind: 'buy-get'; paid: number; free: number }
  | { kind: 'minimum-quantity'; quantity: number }
  | { kind: 'quantity-discount'; quantity: number; percent: number }
  | { kind: 'nth-discount'; position: number; percent: number };

export const bundleAddOnMinConfidence = 0.92;
export const ocrTextMinConfidence = 0.94;
export const ocrConditionMinConfidence = 0.89;
const fallbackFields = new Set([
  'multiBuy',
  'minimumQuantity',
  'minimumSpend',
  'selectedProducts',
  'limitText',
  'priceBasis',
]);
export const cardOrAppCondition =
  /zkarta(?:mojabiedronka)?lubz?(?:apka|aplikacja)|z(?:apka|aplikacja)(?:mojabiedronka)?lubz?karta/u;
export const appOnlyCondition =
  /(?:tylko|wylacznie)zaplikacja|(?:^|oferta|promocja|rabat|cena)(?:tylko|wylacznie)waplikacji/u;

export function parsePromotionConditions(
  sourceTexts: ConditionEvidence[],
  extraOcrTexts: ConditionEvidence[] = [],
) {
  const signals = new Map<string, Map<string, { value: unknown; evidence: ConditionEvidence[] }>>();
  const fallback: typeof signals = new Map();
  const add = (field: string, value: unknown, evidence: ConditionEvidence) => {
    const weaker =
      evidence.origin === 'ocr' && !evidence.scope && evidence.confidence! < ocrTextMinConfidence;
    if (
      weaker &&
      (!fallbackFields.has(field) || (field === 'priceBasis' && value !== 'conditional-unit'))
    )
      return;
    const target = weaker ? fallback : signals;
    const values = target.get(field) ?? new Map();
    const key = JSON.stringify(value);
    const previous = values.get(key);
    values.set(key, { value, evidence: [...(previous?.evidence ?? []), evidence] });
    target.set(field, values);
  };
  for (const evidence of [...sourceTexts, ...extraOcrTexts]) {
    const minimumConfidence =
      evidence.scope === 'bundle-add-on'
        ? bundleAddOnMinConfidence
        : evidence.scope
          ? ocrTextMinConfidence
          : ocrConditionMinConfidence;
    if (
      evidence.origin === 'ocr' &&
      (!Number.isFinite(evidence.confidence) || evidence.confidence! < minimumConfidence)
    )
      continue;
    const text = evidence.text
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
    const compact = text.replace(/(?<=\d)\s+(?=\d)/g, '|').replace(/\s+/g, '');
    if (
      evidence.origin === 'ocr' &&
      !evidence.scope &&
      evidence.confidence! < ocrTextMinConfidence &&
      !/^(?:przyzakupie\d|cenaza1(?:szt|opak|but)|limit(?:dzienny)?[:.]?\d)|wydajmin[.:]?\d/u.test(
        compact,
      )
    )
      continue;
    const either = cardOrAppCondition.test(compact);
    if (evidence.scope === 'bundle-add-on') {
      add('addOn', true, evidence);
      continue;
    }
    if (evidence.scope === 'bundle-loyalty') {
      if (either) {
        add('requiresApp', false, evidence);
        add('loyalty', 'card-or-app', evidence);
      } else if (appOnlyCondition.test(compact) || /ofertazaplikacja/u.test(compact)) {
        add('requiresApp', true, evidence);
        add('loyalty', 'app-only', evidence);
      } else if (/tylkozkarta/u.test(compact)) {
        add('loyalty', 'card-only', evidence);
      }
      continue;
    }
    const priceQuantity = /kazd[ae]z(\d{1,2})(?:sztuk|opakowan)/.exec(compact);
    if (priceQuantity && Number(priceQuantity[1]) > 0)
      add('priceQuantity', Number(priceQuantity[1]), evidence);
    const spend =
      /(?:zamin[.:]?|wydajmin[.:]?|zakupy(?:za)?min[.:]?)(\d+(?:[.,]\d{2})?)(?:zl|zt|z1)/.exec(
        compact,
      );
    if (spend && Number(spend[1].replace(',', '.')) > 0)
      add('minimumSpend', Number(spend[1].replace(',', '.')), evidence);
    if (/wybraneprodukty/.test(compact)) add('selectedProducts', true, evidence);
    const requiresAddOn = /(?:^|[^a-z])kup\s*(?:jeden|1)\s*dowolny\s*dodatek(?:$|[^a-z])/u.test(
      text,
    );
    if (
      requiresAddOn ||
      (/(?:dobierz|dokup)/.test(compact) && !/(?:niedobierz|niedokup)/.test(compact))
    )
      add('addOn', true, evidence);
    const without = /(?:bezaplikacji|niewymagaaplikacji)/u.test(compact);
    const alternativePrice = /cenabezaplikacji|cenazaplikacja|bezaplikacji[:\d]/u.test(compact);
    if (either) {
      add('requiresApp', false, evidence);
      add('loyalty', 'card-or-app', evidence);
    }
    if (without && !alternativePrice) add('requiresApp', false, evidence);
    if (
      !either &&
      !without &&
      (appOnlyCondition.test(compact) || /zeskanujaplikacje/u.test(compact)) &&
      !/niezeskanuj/u.test(compact)
    ) {
      add('requiresApp', true, evidence);
      add('loyalty', 'app-only', evidence);
    }
    if (!either && /tylkozkarta/u.test(compact)) add('loyalty', 'card-only', evidence);
    const negativeCoupon = /bez(?:aktywacji)?kuponu|niewymagaaktywacjikuponu/u.test(compact);
    if (negativeCoupon) add('couponActivation', false, evidence);
    if (
      !negativeCoupon &&
      /aktywujkupon|wymagaaktywacjikuponu/u.test(compact) &&
      !/nieaktywuj/u.test(compact)
    )
      add('couponActivation', true, evidence);
    const free = /(?:^|[^\d])(\d{1,2})\s*\+\s*(\d{1,2})\s*(?:gratis|za\s*darmo)/u.exec(text);
    if (free && +free[1] > 0 && +free[2] > 0) {
      add('multiBuy', { kind: 'buy-get', paid: +free[1], free: +free[2] }, evidence);
      add('minimumQuantity', +free[1] + +free[2], evidence);
    }
    const minimum = /przyzakupie(\d{1,2})(?!\d)|kup(\d{1,2})(?:szt|opak)/u.exec(compact);
    if (minimum && +(minimum[1] ?? minimum[2]) > 0) {
      const quantity = +(minimum[1] ?? minimum[2]);
      add('minimumQuantity', quantity, evidence);
      const before = /(?:^|[^\d])([-−]?)(\d{1,3})%(taniej|rabatu|znizki)?[^\d]*przyzakupie\d/u.exec(
        compact,
      );
      const after =
        /przyzakupie\d{1,2}(?:szt(?:uk)?|opak(?:owan)?)?[^\d]*(\d{1,3})%(?:taniej|rabatu|znizki)/u.exec(
          compact,
        );
      const percent = before && (before[1] || before[3]) ? +before[2] : after ? +after[1] : null;
      if (!free && percent !== null && percent > 0 && percent <= 100)
        add('multiBuy', { kind: 'quantity-discount', quantity, percent }, evidence);
      else if (!free) add('multiBuy', { kind: 'minimum-quantity', quantity }, evidence);
    }
    const discount =
      /drug[ai],?(?:tansz[ay])?(?:produkt)?(?:o)?[-−]?(\d{1,3})%/u.exec(compact) ??
      /(?:^|[^\d])2\.produkt(?:[-−](\d{1,3})%|(\d{1,3})%(?:taniej|rabatu|znizki))/u.exec(compact);
    const secondItemPercent = discount ? Number(discount[1] ?? discount[2]) : 0;
    if (secondItemPercent > 0 && secondItemPercent <= 100) {
      add('multiBuy', { kind: 'nth-discount', position: 2, percent: secondItemPercent }, evidence);
      add('minimumQuantity', 2, evidence);
    }
    const limit =
      /limit(?:dzienny)?[:.]?\d{1,3}(?:kg|szt|opak)\.?(?:(?:gratis)?na(?:karte(?:mojabiedronka|mb)?|kupon|paragon))?/u.exec(
        compact,
      );
    if (limit) add('limitText', limit[0], evidence);
    if (/cenapozapromocja|cenaprzedobnizka/u.test(compact)) add('priceBasis', 'regular', evidence);
    if (/cenaza1(?:szt|opak|but)[^\n]*przyzakupie\d/u.test(compact))
      add('priceBasis', 'conditional-unit', evidence);
  }
  for (const [field, values] of fallback) if (!signals.has(field)) signals.set(field, values);
  function finding<T>(field: string): Finding<T> {
    let values = [...(signals.get(field)?.values() ?? [])];
    if (field === 'multiBuy') {
      const specific = values.filter((row) => (row.value as MultiBuy).kind !== 'minimum-quantity');
      if (specific.length) {
        const quantities = new Set(
          specific.map((row) => {
            const rule = row.value as MultiBuy;
            return rule.kind === 'buy-get'
              ? rule.paid + rule.free
              : rule.kind === 'nth-discount'
                ? rule.position
                : rule.quantity;
          }),
        );
        values = values.filter((row) => {
          const rule = row.value as MultiBuy;
          return rule.kind !== 'minimum-quantity' || !quantities.has(rule.quantity);
        });
      }
    }
    return {
      value: values.length === 1 ? (values[0].value as T) : null,
      status: values.length > 1 ? 'conflict' : values.length ? 'detected' : 'unknown',
      evidence: values.flatMap((value) => value.evidence),
    };
  }
  const fields = {
    requiresApp: finding<boolean>('requiresApp'),
    loyalty: finding<'app-only' | 'card-only' | 'card-or-app'>('loyalty'),
    couponActivation: finding<boolean>('couponActivation'),
    multiBuy: finding<MultiBuy>('multiBuy'),
    minimumQuantity: finding<number>('minimumQuantity'),
    priceQuantity: finding<number>('priceQuantity'),
    limitText: finding<string>('limitText'),
    minimumSpend: finding<number>('minimumSpend'),
    selectedProducts: finding<boolean>('selectedProducts'),
    addOn: finding<boolean>('addOn'),
    priceLabels: {
      value: signals.has('priceBasis')
        ? [...signals.get('priceBasis')!.values()].map((row) => row.value as string).sort()
        : null,
      status: signals.has('priceBasis') ? ('detected' as const) : ('unknown' as const),
      evidence: [...(signals.get('priceBasis')?.values() ?? [])].flatMap((row) => row.evidence),
    },
  };
  return {
    ...fields,
    sourceTexts,
    unknownFields: Object.entries(fields)
      .filter(([, field]) => field.value === null)
      .map(([name]) => name),
    conflicts: Object.entries(fields)
      .filter(([, field]) => field.status === 'conflict')
      .map(([name]) => name),
    reviewRequired: true as const,
  };
}

export type PromotionConditions = ReturnType<typeof parsePromotionConditions>;

export function hasDetectedConditions(promotion: PromotionConditions) {
  return Object.values(promotion).some(
    (field) =>
      field && typeof field === 'object' && 'status' in field && field.status === 'detected',
  );
}
