import { classifyOffer } from './offer-kind.js';
import { readAssortment } from './assortment.js';
import { load } from 'cheerio';
import { readBlixOffers, type BlixCandidate } from './blix-parser.js';
import { parsePromotionConditions, type ConditionEvidence } from './promotion-conditions.js';
import { enrichProductDetails } from './product-details.js';

export interface OcrRegion {
  id: string;
  sourceUrl: string;
  imageUrl: string;
  area: number[];
  rollPriceInGrosze?: number;
  bundleProduct?: { name: string; priceInGrosze: number };
}

export function prepareConditionSource(html: string) {
  let pages: Record<string, unknown> | undefined;
  return {
    rows: readBlixOffers(html),
    $: load(html),
    leaflet: () => (pages ??= leafletData(html)),
  };
}

export function readConditionSources(
  html: string,
  candidate: BlixCandidate,
  source = prepareConditionSource(html),
): ConditionEvidence[] {
  const id = candidate.id.slice(`blix:${candidate.store}:${candidate.leafletId}:`.length);
  const texts: ConditionEvidence[] = [];
  for (const value of source.rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.productLeafletPageUuid !== id || String(row.leafletId) !== candidate.leafletId)
      continue;
    for (const key of ['conditions', 'promotionConditions', 'description']) {
      if (typeof row[key] === 'string' && row[key].trim())
        texts.push({ text: row[key], origin: 'json', sourceUrl: candidate.sourceUrl });
    }
  }
  const $ = source.$;
  for (const element of $('[data-product-leaflet-page-uuid]').toArray()) {
    if ($(element).attr('data-product-leaflet-page-uuid') !== id) continue;
    for (const node of $(element).find('.offer__conditions, .offer__description').toArray()) {
      texts.push({ text: $(node).text(), origin: 'html', sourceUrl: candidate.sourceUrl });
    }
  }
  return texts;
}

function leafletData(html: string): Record<string, unknown> {
  const $ = load(html);
  for (const element of $('script').toArray()) {
    const script = $(element).html() ?? '';
    const match = /(?:^|[;\n])\s*window\.leaflet\s*=\s*/u.exec(script);
    if (!match) continue;
    const tail = script.slice(match.index + match[0].length);
    if (!tail.startsWith('{')) throw new Error('Expected leaflet JSON');
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = 0; i < tail.length; i++) {
      const c = tail[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return JSON.parse(tail.slice(0, i + 1));
    }
  }
  throw new Error('Missing leaflet page metadata');
}

export function ocrRegion(
  html: string,
  candidate: BlixCandidate,
  source = prepareConditionSource(html),
): OcrRegion {
  const id = candidate.id.slice(`blix:${candidate.store}:${candidate.leafletId}:`.length);
  const rows = source.rows.filter((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.productLeafletPageUuid === id && String(row.leafletId) === candidate.leafletId;
  }) as Record<string, unknown>[];
  if (!rows.length || new Set(rows.map((row) => JSON.stringify(row.area))).size !== 1)
    throw new Error('Ambiguous product region');
  const data = source.leaflet();
  if (!Array.isArray(data.pages)) throw new Error('Missing leaflet pages');
  const pages = data.pages.filter(
    (page: Record<string, unknown>) =>
      page.page === candidate.pageNumber - 1 && String(page.leaflet_id) === candidate.leafletId,
  );
  if (pages.length !== 1 || typeof pages[0].image_url !== 'string')
    throw new Error('Ambiguous leaflet page');
  const bucket = ['3000', '1500', '1000'].find((value) => html.includes(`bucket=${value}`));
  if (!bucket) throw new Error('No advertised image resolution');
  const imageUrl = pages[0].image_url.replace('$$$EXT$$$', 'webp').replace('$$$BUCKET$$$', bucket);
  const image = new URL(imageUrl);
  if (
    image.protocol !== 'https:' ||
    image.hostname !== 'imgproxy.blix.pl' ||
    image.username ||
    image.password
  )
    throw new Error('Unexpected page image URL');
  const area = rows[0].area as {
    topLeftCorner?: { x: number; y: number };
    bottomRightCorner?: { x: number; y: number };
  } | null;
  const coordinates = [
    area?.topLeftCorner?.x,
    area?.topLeftCorner?.y,
    area?.bottomRightCorner?.x,
    area?.bottomRightCorner?.y,
  ];
  if (coordinates.some((value) => typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error('Invalid product coordinates');
  const [x1, y1, x2, y2] = coordinates as number[];
  if (!(0 <= x1 && x1 < x2 && x2 <= 1 && 0 <= y1 && y1 < y2 && y2 <= 1))
    throw new Error('Invalid product coordinates');
  const rollPriceInGrosze =
    candidate.store === 'biedronka' &&
    /^bułka\b/iu.test(candidate.name) &&
    candidate.reportedPrice > 0 &&
    candidate.reportedPrice < 1
      ? Math.round(candidate.reportedPrice * 100)
      : undefined;
  return {
    id: candidate.id,
    sourceUrl: candidate.sourceUrl,
    imageUrl,
    area: [x1, y1, x2, y2],
    ...(rollPriceInGrosze === undefined ? {} : { rollPriceInGrosze }),
    bundleProduct: {
      name: candidate.name,
      priceInGrosze: Math.round(candidate.reportedPrice * 100),
    },
  };
}

export function enrichConditions(
  candidate: BlixCandidate,
  sourceTexts: ConditionEvidence[],
  rawLines: unknown[] = [],
) {
  const productTexts = sourceTexts.filter((evidence) => !evidence.scope);
  const product = enrichProductDetails(candidate, productTexts, rawLines);
  const assortment = readAssortment(candidate.name, productTexts, rawLines);
  const conflict =
    assortment &&
    (product.productDetails.quantity.status === 'conflict' ||
      (product.unit !== null &&
        (product.unit !== assortment.unit || product.unitQuantity !== assortment.amount)));
  return {
    ...product,
    ...classifyOffer(productTexts),
    ...(assortment && !conflict
      ? { name: assortment.name + ' - różne rodzaje', sourceName: candidate.name, assortment }
      : {}),
    promotion: parsePromotionConditions(sourceTexts),
  };
}
