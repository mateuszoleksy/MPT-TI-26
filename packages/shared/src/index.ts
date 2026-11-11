import { z } from 'zod';

export const StoreSchema = z.enum(['biedronka', 'lidl']);
export type Store = z.infer<typeof StoreSchema>;

/** A single promotion as normalized by the scraper and served by the API. */
export const OfferSchema = z.object({
  id: z.string(),
  store: StoreSchema,
  name: z.string(),
  category: z.string().nullable(),
  priceRegular: z.number().nullable(),
  pricePromo: z.number(),
  /** e.g. "kg", "l", "szt" — used to compute price per unit */
  unit: z.string().nullable(),
  unitQuantity: z.number().nullable(),
  /** Free-text conditions, e.g. "przy zakupie 2 szt.", "z aplikacją Lidl Plus" */
  conditions: z.string().nullable(),
  requiresApp: z.boolean(),
  imageUrl: z.string().url().nullable(),
  sourceUrl: z.string().url(),
  validFrom: z.string().date(),
  validTo: z.string().date(),
});
export type Offer = z.infer<typeof OfferSchema>;

/** Accepts `?store=lidl` as well as `?store=lidl&store=biedronka`. */
const oneOrMany = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item));

/** Query parameters accepted by GET /api/offers. */
export const OfferFiltersSchema = z.object({
  q: z.string().optional(),
  store: oneOrMany(StoreSchema).optional(),
  category: oneOrMany(z.string()).optional(),
  maxPrice: z.coerce.number().optional(),
  minDiscount: z.coerce.number().min(0).max(100).optional(),
  activeOn: z.string().date().optional(),
  excludeAppOnly: z.coerce.boolean().optional(),
  sort: z.enum(['discount', 'price', 'pricePerUnit', 'validTo']).default('discount'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type OfferFilters = z.infer<typeof OfferFiltersSchema>;

export function discountPercent(o: Pick<Offer, 'priceRegular' | 'pricePromo'>): number | null {
  if (!o.priceRegular || o.priceRegular <= 0) return null;
  return Math.round((1 - o.pricePromo / o.priceRegular) * 100);
}
export * from './promotionDates.js';
