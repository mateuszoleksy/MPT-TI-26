import { OfferSchema, StoreSchema, type Offer, type Store } from '@promo/shared';
import { load } from 'cheerio';

export type BlixCandidate = Omit<Offer, 'requiresApp' | 'pricePromo'> & {
  reportedPrice: number;
  priceBasis: 'unknown';
  requiresApp: null;
  reviewRequired: true;
  leafletId: string;
  pageNumber: number;
};

export interface BlixResult {
  sourceUrl: string;
  total: number;
  candidates: BlixCandidate[];
  rejected: { index: number; reason: string }[];
  duplicates: number;
  possibleDuplicates: number;
}

export function blixLeafletUrl(store: Store, leafletId: string): string {
  if (!StoreSchema.safeParse(store).success || !/^\d+$/.test(leafletId)) {
    throw new Error('Invalid store or leaflet ID');
  }
  return `https://blix.pl/sklep/${store}/gazetka/${leafletId}/`;
}

function source(url: string): { store: Store; leafletId: string } {
  const parsed = new URL(url);
  const match = /^\/sklep\/([a-z-]+)\/gazetka\/(\d+)\/$/.exec(parsed.pathname);
  if (parsed.origin !== 'https://blix.pl' || parsed.username || parsed.password || !match) {
    throw new Error('Unexpected Blix leaflet URL');
  }
  return { store: StoreSchema.parse(match[1]), leafletId: match[2] };
}

function readArray(text: string): unknown[] {
  if (!text.startsWith('[')) throw new Error('Offers must be a JSON array');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '[') depth++;
    else if (character === ']' && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error('Incomplete offers JSON');
}

function readOffers(html: string): unknown[] {
  const $ = load(html);
  for (const script of $('script').toArray()) {
    const text = $(script).html() ?? '';
    const assignment = /(?:^|[;\n])\s*window\.offers\s*=\s*/.exec(text);
    if (assignment) return readArray(text.slice(assignment.index + assignment[0].length));
  }
  throw new Error('Missing window.offers');
}

export { readOffers as readBlixOffers };

function date(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Missing date');
  const row = value as Record<string, unknown>;
  if (
    row.timezone !== 'Europe/Warsaw' ||
    typeof row.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} /.test(row.date)
  ) {
    throw new Error('Invalid Warsaw date');
  }
  const day = row.date.slice(0, 10);
  const parsed = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
    throw new Error('Invalid calendar date');
  return day;
}

export function parseBlixCandidates(html: string, sourceUrl: string): BlixResult {
  const { store, leafletId } = source(sourceUrl);
  const rows = readOffers(html);
  const result: BlixResult = {
    sourceUrl,
    total: rows.length,
    candidates: [],
    rejected: [],
    duplicates: 0,
    possibleDuplicates: 0,
  };
  const occurrences = new Map<string, string>();
  const signatures = new Set<string>();
  for (const [index, value] of rows.entries()) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid record');
      const row = value as Record<string, unknown>;
      if (row.price === null) throw new Error('Missing price');
      if (typeof row.price !== 'number' || !Number.isSafeInteger(row.price) || row.price <= 0)
        throw new Error('Invalid grosze price');
      if (typeof row.name !== 'string' || !row.name.trim()) throw new Error('Missing name');
      if (String(row.leafletId) !== leafletId) throw new Error('Wrong leaflet');
      if (typeof row.productLeafletPageUuid !== 'string' || !row.productLeafletPageUuid.trim())
        throw new Error('Missing occurrence ID');
      if (
        typeof row.pageNumber !== 'number' ||
        !Number.isSafeInteger(row.pageNumber) ||
        row.pageNumber < 0
      )
        throw new Error('Invalid page');
      const validFrom = date(row.dateStart);
      const validTo = date(row.dateEnd);
      if (validFrom > validTo) throw new Error('Reversed dates');
      const image = typeof row.image === 'string' ? new URL(row.image) : null;
      if (
        image &&
        (image.protocol !== 'https:' ||
          image.hostname !== 'imgproxy.blix.pl' ||
          image.username ||
          image.password)
      )
        throw new Error('Unexpected image URL');
      const parsed = OfferSchema.omit({ requiresApp: true }).parse({
        id: `blix:${store}:${leafletId}:${row.productLeafletPageUuid}`,
        store,
        name: row.name.trim(),
        category: null,
        pricePromo: row.price / 100,
        priceRegular: null,
        unit: null,
        unitQuantity: null,
        conditions: null,
        imageUrl: image?.href ?? null,
        sourceUrl: `${blixLeafletUrl(store, leafletId)}?pageNumber=${row.pageNumber + 1}`,
        validFrom,
        validTo,
      });
      const { pricePromo, ...fields } = parsed;
      const candidate: BlixCandidate = {
        ...fields,
        reportedPrice: pricePromo,
        priceBasis: 'unknown',
        requiresApp: null,
        reviewRequired: true,
        leafletId,
        pageNumber: row.pageNumber + 1,
      };
      const previous = occurrences.get(candidate.id);
      const serialized = JSON.stringify(candidate);
      if (previous && previous !== serialized) throw new Error('Conflicting occurrence');
      if (previous) {
        result.duplicates++;
        continue;
      }
      occurrences.set(candidate.id, serialized);
      const signature = JSON.stringify([store, candidate.name, row.price, validFrom, validTo]);
      if (signatures.has(signature)) result.possibleDuplicates++;
      signatures.add(signature);
      result.candidates.push(candidate);
    } catch (error) {
      if (error instanceof Error && error.message === 'Conflicting occurrence') throw error;
      result.rejected.push({
        index,
        reason: error instanceof Error ? error.message : 'Invalid record',
      });
    }
  }
  return result;
}

export interface BlixLeaflet {
  id: string;
  url: string;
  title: string;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
}

export function todayInWarsaw(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(now);
}

function leafletDate(value: string | undefined): string | null {
  const match = /^(\w+) (\d{1,2}), (\d{4}) \d{2}:\d{2}$/.exec(value ?? '');
  if (!match) return null;
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months.indexOf(match[1]) + 1;
  if (!month) return null;
  try {
    return date({
      date: `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')} 00:00:00`,
      timezone: 'Europe/Warsaw',
    });
  } catch {
    return null;
  }
}

export function discoverBlixLeaflets(
  html: string,
  store: Store,
  onDate = todayInWarsaw(),
): BlixLeaflet[] {
  StoreSchema.parse(store);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) throw new Error('Invalid listing date');
  date({ date: `${onDate} 00:00:00`, timezone: 'Europe/Warsaw' });
  const $ = load(html);
  const found = new Map<string, BlixLeaflet>();
  for (const element of $('.leaflet[data-leaflet-id]').toArray()) {
    const card = $(element);
    try {
      const url = new URL(card.find('a[href]').first().attr('href') ?? '', 'https://blix.pl');
      const match = /^\/sklep\/([a-z-]+)\/gazetka\/(\d+)\/$/.exec(url.pathname);
      if (
        url.origin !== 'https://blix.pl' ||
        url.username ||
        url.password ||
        match?.[1] !== store ||
        match[2] !== card.attr('data-leaflet-id')
      )
        continue;
      const validFrom = leafletDate(card.attr('data-date-start'));
      const validTo = leafletDate(card.attr('data-date-end'));
      const leaflet = {
        id: match[2],
        url: blixLeafletUrl(store, match[2]),
        title: card.attr('data-leaflet-name') ?? '',
        validFrom,
        validTo,
        active: !!(validFrom && validTo && validFrom <= onDate && onDate <= validTo),
      };
      const previous = found.get(leaflet.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(leaflet))
        throw new Error('Conflicting leaflet metadata');
      found.set(leaflet.id, leaflet);
    } catch (error) {
      if (error instanceof Error && error.message === 'Conflicting leaflet metadata') throw error;
    }
  }
  return [...found.values()].sort(
    (a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? '') || a.id.localeCompare(b.id),
  );
}
