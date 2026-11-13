import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { OfferFiltersSchema, SourceOfferSchema, detectedConditionLabels } from '../index.js';
import { listSourceOffers, saveSourceOffers, type Database } from './index.js';
import * as schema from './schema.js';

const client = new PGlite();
const actual = drizzle(client, { schema });
const db = actual as unknown as Database;
const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));
function row(id: string, store = 'lidl', price = 2.49, name = 'Masło') {
  return SourceOfferSchema.parse({
    id,
    store,
    name,
    category: null,
    priceRegular: null,
    reportedPrice: price,
    priceBasis: 'unknown',
    unit: null,
    unitQuantity: null,
    conditions: null,
    requiresApp: null,
    imageUrl: null,
    sourceUrl: 'https://blix.pl/sklep/lidl/gazetka/123/',
    validFrom: '2026-11-09',
    validTo: '2026-11-14',
    reviewRequired: true,
    leafletId: '123',
    pageNumber: 1,
  });
}
const filters = (input: Record<string, unknown> = {}) =>
  OfferFiltersSchema.parse({ activeOn: '2026-11-11', ...input });
beforeAll(async () => {
  await migrate(actual, { migrationsFolder });
  await migrate(actual, { migrationsFolder });
});
afterAll(() => client.close());
beforeEach(async () => {
  await actual.delete(schema.offerCandidates);
  await actual.delete(schema.scrapeRuns);
});

test('updates occurrences without creating duplicates', async () => {
  await saveSourceOffers(db, [row('a'), row('b', 'biedronka')], { failures: [], pending: 0 });
  await saveSourceOffers(db, [row('a', 'lidl', 3.99)], { failures: [], pending: 0 });
  const result = await listSourceOffers(db, filters({ sort: 'price' }));
  expect(result.total).toBe(2);
  expect(result.items.find((item) => item.id === 'a')?.reportedPrice).toBe(3.99);
  expect(result.items[0].requiresApp).toBeNull();
  expect(result.items[0].priceBasis).toBe('unknown');
  expect(await actual.select().from(schema.scrapeRuns)).toHaveLength(2);
});

test('preserves quantities and separate reference prices in the API payload', async () => {
  const item = {
    ...row('size'),
    unit: 'kg',
    unitQuantity: 0.2,
    priceRegular: 4.99,
    productDetails: {
      quantity: { value: { unit: 'kg', amount: 0.2 }, status: 'detected', evidence: [] },
      lowest30DaysPrice: {
        value: { amount: 3.99, basis: 'item' },
        status: 'detected',
        evidence: [],
      },
    },
  };
  await saveSourceOffers(db, [item]);
  const result = await listSourceOffers(db, filters());
  expect(result.items[0].unit).toBe('kg');
  expect(result.items[0].unitQuantity).toBe(0.2);
  expect(result.items[0].priceRegular).toBe(4.99);
  expect(result.items[0].productDetails).toEqual(item.productDetails);
  expect(result.items[0].priceBasis).toBe('unknown');
});

test('retains package counts, unit-price readings and unresolved evidence in SQL', async () => {
  const details = {
    pieceQuantity: {
      value: { unit: 'szt', amount: 20, kind: 'torebka' },
      status: 'detected',
      evidence: [],
    },
    unitPrices: [
      {
        amount: 0.09,
        unit: 'szt',
        perQuantity: 1,
        priceRole: 'unassigned',
        evidence: {
          text: '0,09 zł/szt.',
          origin: 'ocr',
          confidence: 0.99,
          sourceUrl: 'https://blix.pl/',
        },
      },
    ],
    unassignedReadings: [
      { text: '2,79', origin: 'ocr', confidence: 0.8, sourceUrl: 'https://blix.pl/' },
    ],
  };
  await saveSourceOffers(db, [
    { ...row('tea'), unit: 'szt', unitQuantity: 20, priceRegular: 2.79, productDetails: details },
  ]);
  const result = await listSourceOffers(db, filters());
  expect(result.items[0].unitQuantity).toBe(20);
  expect(result.items[0].unit).toBe('szt');
  expect(result.items[0].productDetails).toEqual(details);
});

test('keeps a previous price distinct from the current regular price', async () => {
  await saveSourceOffers(db, [
    { ...row('bread', 'lidl', 0.59), priceRegular: 0.59, pricePrevious: 0.7 },
  ]);
  const result = await listSourceOffers(db, filters());
  expect(result.items[0].reportedPrice).toBe(0.59);
  expect(result.items[0].priceRegular).toBe(0.59);
  expect(result.items[0].pricePrevious).toBe(0.7);
});

test('filters and paginates source records in SQL', async () => {
  await saveSourceOffers(
    db,
    [
      row('a', 'lidl', 10, 'Coffee'),
      row('b', 'biedronka', 5, 'Coffee'),
      row('c', 'lidl', 2, 'Milk'),
    ],
    { failures: [], pending: 0 },
  );
  const result = await listSourceOffers(
    db,
    filters({ q: 'coffee', maxPrice: 6, store: 'biedronka', activeOn: '2026-11-11' }),
  );
  expect(result.items.map((item) => item.id)).toEqual(['b']);
  const page = await listSourceOffers(db, filters({ sort: 'price', page: 2, pageSize: 1 }));
  expect(page.total).toBe(3);
  expect(page.items[0].id).toBe('b');
  expect((await listSourceOffers(db, filters({ activeOn: '2026-11-15' }))).total).toBe(0);
});

test('does not treat unknown or stale requirements as app-free', async () => {
  await saveSourceOffers(
    db,
    [
      row('unknown'),
      { ...row('known'), requiresApp: false },
      { ...row('stale'), requiresApp: false, stale: true },
    ],
    { failures: [], pending: 0 },
  );
  expect(
    (await listSourceOffers(db, filters({ excludeAppOnly: 'true' }))).items.map((item) => item.id),
  ).toEqual(['known']);
  expect((await listSourceOffers(db, filters({ excludeAppOnly: 'false' }))).total).toBe(3);
});

test('preserves existing data when validation fails', async () => {
  await saveSourceOffers(db, [row('a')], { failures: [], pending: 0 });
  await expect(
    saveSourceOffers(db, [{ ...row('a'), reportedPrice: -1 }], { failures: [], pending: 0 }),
  ).rejects.toThrow();
  expect((await listSourceOffers(db, filters())).items[0].reportedPrice).toBe(2.49);
});

test('does not rank unverified prices as confirmed discounts', async () => {
  await saveSourceOffers(db, [row('a')], { failures: [], pending: 0 });
  expect((await listSourceOffers(db, filters({ minDiscount: 1 }))).total).toBe(0);
});

test('treats wildcard characters in search literally', async () => {
  await saveSourceOffers(
    db,
    [row('a', 'lidl', 5, '100% Arabica'), row('b', 'lidl', 6, '1000 Arabica')],
    { failures: [], pending: 0 },
  );
  expect((await listSourceOffers(db, filters({ q: '100%' }))).items.map((item) => item.id)).toEqual(
    ['a'],
  );
});

test('formats detected conditions without marking them verified', () => {
  const value = {
    ...row('a'),
    promotion: {
      requiresApp: { value: null },
      loyalty: { value: 'card-or-app' },
      couponActivation: { value: null },
      multiBuy: { value: { kind: 'quantity-discount', quantity: 2, percent: 30 } },
    },
  };
  expect(detectedConditionLabels(value)).toEqual([
    'Z kartą lub aplikacją',
    '30% taniej przy zakupie 2 szt.',
  ]);
  expect(detectedConditionLabels({ ...value, ocrStale: true })).toEqual([]);
  expect(value.requiresApp).toBeNull();
});

test('rolls back the whole save on a database constraint failure', async () => {
  await saveSourceOffers(db, [row('existing')], { failures: [], pending: 0 });
  await expect(
    saveSourceOffers(db, [row('new'), { ...row('bad'), validTo: '2026-11-01' }], {
      failures: [],
      pending: 0,
    }),
  ).rejects.toThrow();
  expect((await listSourceOffers(db, filters())).items.map((item) => item.id)).toEqual([
    'existing',
  ]);
  expect(await actual.select().from(schema.scrapeRuns)).toHaveLength(1);
});

test('hides expired offers by default using the Warsaw date', async () => {
  await saveSourceOffers(
    db,
    [
      { ...row('expired'), validTo: '2026-11-10' },
      row('active'),
      { ...row('future'), validFrom: '2026-11-12' },
    ],
    { failures: [], pending: 0 },
  );
  const result = await listSourceOffers(
    db,
    OfferFiltersSchema.parse({ sort: 'price' }),
    new Date('2026-11-10T23:30:00Z'),
  );
  expect(result.items.map((item) => item.id).sort()).toEqual(['active', 'future']);
  const historical = await listSourceOffers(db, filters({ activeOn: '2026-11-10' }));
  expect(historical.items.map((item) => item.id).sort()).toEqual(['active', 'expired']);
});

test('groups matching images before pagination and keeps all source occurrences', async () => {
  const key = 'a'.repeat(64);
  const a = { ...row('a'), duplicateKey: key };
  const b = {
    ...row('b'),
    duplicateKey: key,
    leafletId: '456',
    sourceUrl: 'https://blix.pl/sklep/lidl/gazetka/456/',
  };
  await saveSourceOffers(db, [a, b, row('c', 'lidl', 3.99)]);
  const first = await listSourceOffers(db, filters({ sort: 'price', pageSize: 1 }));
  expect(first.total).toBe(2);
  expect(first.items).toHaveLength(1);
  expect(first.items[0].sources?.map((item) => item.id)).toEqual(['a', 'b']);
  const second = await listSourceOffers(db, filters({ sort: 'price', pageSize: 1, page: 2 }));
  expect(second.items[0].id).toBe('c');
  expect(await actual.select().from(schema.offerCandidates)).toHaveLength(3);
  expect((await listSourceOffers(db, filters({ q: 'Masło', maxPrice: 3 }))).total).toBe(1);
});

test('keeps ambiguous repeated occurrences inside one leaflet separate', async () => {
  const key = 'b'.repeat(64);
  await saveSourceOffers(
    db,
    ['a', 'b'].map((id) => ({ ...row(id), duplicateKey: key })),
  );
  expect((await listSourceOffers(db, filters())).total).toBe(2);
});

test('retains original assortment names and finds a named variant', async () => {
  const key = 'c'.repeat(64);
  await saveSourceOffers(db, [
    {
      ...row('a'),
      name: 'Cukierki Tic Tac - różne rodzaje',
      sourceName: 'Cukierki Tic Tac Orange',
      duplicateKey: key,
    },
    {
      ...row('b'),
      name: 'Cukierki Tic Tac - różne rodzaje',
      sourceName: 'Cukierki Tic Tac',
      unit: 'kg',
      unitQuantity: 0.018,
      leafletId: '456',
      duplicateKey: key,
    },
  ]);
  const grouped = await listSourceOffers(db, filters({ q: 'Tic Tac' }));
  expect(grouped.total).toBe(1);
  expect(grouped.items[0].unitQuantity).toBe(0.018);
  expect(grouped.items[0].sources?.map((s) => s.sourceName)).toEqual([
    'Cukierki Tic Tac Orange',
    'Cukierki Tic Tac',
  ]);
  expect((await listSourceOffers(db, filters({ q: 'Orange' }))).total).toBe(1);
});

test('hides explicit regular prices before counting and pagination without deleting rows', async () => {
  await saveSourceOffers(db, [
    { ...row('regular', 'lidl', 1), offerKind: 'regular' },
    { ...row('reduction', 'lidl', 2), offerKind: 'price-reduction' },
    row('unknown', 'lidl', 3),
  ]);
  const first = await listSourceOffers(db, filters({ sort: 'price', pageSize: 1 }));
  expect(first.total).toBe(2);
  expect(first.items[0].id).toBe('reduction');
  const second = await listSourceOffers(db, filters({ sort: 'price', pageSize: 1, page: 2 }));
  expect(second.items[0].id).toBe('unknown');
  expect(await actual.select().from(schema.offerCandidates)).toHaveLength(3);
});
