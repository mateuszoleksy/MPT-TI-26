import { createHash } from 'node:crypto';
import pg from 'pg';
import { type SQL, and, asc, count, desc, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SourceOfferSchema, warsawDate, type OfferFilters, type SourceOffer } from '../index.js';
import * as schema from './schema.js';

export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 5 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
export type Database = NodePgDatabase<typeof schema>;

export async function checkDatabase(db: Database) {
  await db.execute(sql`select 1`);
}

function withoutEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEvidence);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'evidence' && key !== 'sourceUrl')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, withoutEvidence(item)]),
    );
  return value;
}

/**
 * The same offer printed on several pages or leaflets gets one key, so the list shows it once.
 * Offers without a known package size, outdated data or conflicting conditions are never grouped.
 */
export function duplicateKey(offer: SourceOffer) {
  const assortment = offer.assortment as { unit?: string; amount?: number } | undefined;
  const unit = offer.unit ?? assortment?.unit;
  const unitQuantity = offer.unitQuantity ?? assortment?.amount;
  const promotion = offer.promotion as { conflicts?: unknown[] } | undefined;
  if (!unit || !(Number(unitQuantity) > 0) || offer.stale || offer.ocrStale) return undefined;
  if (promotion?.conflicts?.length) return undefined;
  return createHash('sha256')
    .update(
      JSON.stringify([
        offer.store,
        offer.offerKind,
        offer.name.trim().toLowerCase(),
        offer.reportedPrice,
        offer.priceRegular,
        offer.pricePrevious ?? null,
        offer.priceQuantity ?? null,
        unit,
        unitQuantity,
        offer.validFrom,
        offer.validTo,
        offer.requiresApp,
        offer.conditions,
        withoutEvidence(promotion ?? null),
      ]),
    )
    .digest('hex');
}

export async function saveSourceOffers(
  db: Database,
  input: unknown[],
  details?: { failures: unknown[]; pending: number; saved?: number },
) {
  const unique = new Map<string, SourceOffer>();
  for (const value of input) {
    const parsed = SourceOfferSchema.parse(value);
    const row = { ...parsed, duplicateKey: duplicateKey(parsed) };
    const previous = unique.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row))
      throw new Error('Conflicting source occurrence');
    unique.set(row.id, row);
  }
  const rows = [...unique.values()];
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 100) {
      await tx
        .insert(schema.offerCandidates)
        .values(
          rows.slice(i, i + 100).map((row) => ({
            id: row.id,
            store: row.store,
            leafletId: row.leafletId,
            name: row.name,
            category: row.category,
            reportedPrice: row.reportedPrice,
            validFrom: row.validFrom,
            validTo: row.validTo,
            payload: row,
          })),
        )
        .onConflictDoUpdate({
          target: schema.offerCandidates.id,
          // A basic import can replace enriched data when the source offer changes.
          setWhere: sql`not (
            excluded.payload->'productDetails' is null
            and ${schema.offerCandidates.payload}->'productDetails' is not null
            and ${schema.offerCandidates.store} = excluded.store
            and ${schema.offerCandidates.leafletId} = excluded.leaflet_id
            and coalesce(${schema.offerCandidates.payload}->>'sourceName', ${schema.offerCandidates.name}) = excluded.name
            and ${schema.offerCandidates.category} is not distinct from excluded.category
            and ${schema.offerCandidates.reportedPrice} = excluded.reported_price
            and ${schema.offerCandidates.validFrom} = excluded.valid_from
            and ${schema.offerCandidates.validTo} = excluded.valid_to
            and ${schema.offerCandidates.payload}->'sourceUrl' is not distinct from excluded.payload->'sourceUrl'
            and ${schema.offerCandidates.payload}->'imageUrl' is not distinct from excluded.payload->'imageUrl'
          )`,
          set: {
            store: sql`excluded.store`,
            leafletId: sql`excluded.leaflet_id`,
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            reportedPrice: sql`excluded.reported_price`,
            validFrom: sql`excluded.valid_from`,
            validTo: sql`excluded.valid_to`,
            payload: sql`excluded.payload`,
            updatedAt: new Date(),
          },
        });
    }
    if (details)
      await tx.insert(schema.scrapeRuns).values({
        status: details.failures.length || details.pending ? 'partial' : 'complete',
        saved: details.saved ?? rows.length,
        details,
      });
  });
  return rows.length;
}

export async function listSourceOffers(db: Database, filters: OfferFilters, now = new Date()) {
  const table = schema.offerCandidates;
  const clauses: (SQL | undefined)[] = [
    sql`coalesce(${table.payload}->>'offerKind', 'unknown') <> 'regular'`,
  ];
  if (filters.q)
    clauses.push(
      or(
        ilike(table.name, `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`),
        sql`${table.payload}->>'sourceName' ilike ${'%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%'}`,
      ),
    );
  if (filters.store?.length) clauses.push(inArray(table.store, filters.store));
  if (filters.category?.length) clauses.push(inArray(table.category, filters.category));
  if (filters.maxPrice !== undefined) clauses.push(lte(table.reportedPrice, filters.maxPrice));
  if (filters.activeOn)
    clauses.push(lte(table.validFrom, filters.activeOn), gte(table.validTo, filters.activeOn));
  else clauses.push(lte(table.validFrom, warsawDate(now)), gte(table.validTo, warsawDate(now)));
  if (filters.excludeAppOnly)
    clauses.push(
      sql`${table.payload}->>'requiresApp' = 'false' AND ${table.payload}->>'stale' = 'false'`,
    );
  if (filters.minDiscount !== undefined) clauses.push(sql`false`);
  const where = and(...clauses);
  const groupKey = sql`coalesce(${table.payload}->>'duplicateKey', ${table.id})`;
  const grouped = db
    .select({
      payload:
        sql<SourceOffer>`jsonb_set((jsonb_agg(${table.payload} order by (${table.payload}->>'unitQuantity' is not null) desc, ${table.id})->0), '{sources}', jsonb_agg(jsonb_build_object('id', ${table.id}, 'sourceUrl', ${table.payload}->>'sourceUrl', 'sourceName', coalesce(${table.payload}->>'sourceName', ${table.name}), 'leafletId', ${table.leafletId}, 'pageNumber', ${table.payload}->'pageNumber') order by ${table.id}))`.as(
          'payload',
        ),
      reportedPrice: sql<number>`min(${table.reportedPrice})`.as('reported_price'),
      validTo: sql<string>`min(${table.validTo})`.as('valid_to'),
      updatedAt: sql<Date>`max(${table.updatedAt})`.as('updated_at'),
      id: sql<string>`min(${table.id})`.as('id'),
    })
    .from(table)
    .where(where)
    .groupBy(groupKey)
    .as('grouped');
  const groupedOrder =
    filters.sort === 'price'
      ? asc(grouped.reportedPrice)
      : filters.sort === 'validTo'
        ? asc(grouped.validTo)
        : desc(grouped.updatedAt);
  return db.transaction(
    async (tx) => {
      const [total] = await tx.select({ value: count() }).from(grouped);
      const rows = await tx
        .select({ payload: grouped.payload })
        .from(grouped)
        .orderBy(groupedOrder, asc(grouped.id))
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize);
      return {
        items: rows.map((row) => SourceOfferSchema.parse(row.payload)),
        total: total.value,
        filters,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
