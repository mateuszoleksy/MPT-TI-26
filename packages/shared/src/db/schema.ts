import {
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import type { SourceOffer } from '../index.js';

export const offerCandidates = pgTable(
  'offer_candidates',
  {
    id: text('id').primaryKey(),
    store: text('store').notNull(),
    leafletId: text('leaflet_id').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    reportedPrice: doublePrecision('reported_price').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(),
    payload: jsonb('payload').$type<SourceOffer>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('offer_candidates_store_dates').on(table.store, table.validFrom, table.validTo),
  ],
);

export const scrapeRuns = pgTable('scrape_runs', {
  id: serial('id').primaryKey(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  status: text('status').notNull(),
  saved: integer('saved').notNull(),
  details: jsonb('details').notNull(),
});
