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

export const SourceOfferSchema = OfferSchema.omit({ pricePromo: true, requiresApp: true }).extend({
  offerKind: z.enum(['regular', 'price-reduction', 'unknown']).default('unknown'),
  offerKindEvidence: z.array(z.unknown()).optional(),
  sourceName: z.string().optional(),
  assortment: z.unknown().optional(),
  duplicateKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  sources: z
    .array(
      z.object({
        id: z.string(),
        sourceUrl: z.string().url(),
        sourceName: z.string().optional(),
        leafletId: z.string(),
        pageNumber: z.number().int().positive(),
      }),
    )
    .optional(),
  priceQuantity: z
    .object({ unit: z.enum(['kg', 'l']), amount: z.number().finite().positive() })
    .nullable()
    .optional(),
  reportedPrice: z.number().finite().positive(),
  priceBasis: z.literal('unknown'),
  requiresApp: z.boolean().nullable(),
  reviewRequired: z.literal(true),
  leafletId: z.string().regex(/^\d+$/),
  pageNumber: z.number().int().positive(),
  promotion: z.unknown().optional(),
  productDetails: z.unknown().optional(),
  pricePrevious: z.number().finite().positive().nullable().optional(),
  stale: z.boolean().default(false),
  ocrStale: z.boolean().default(false),
  recheckDue: z.boolean().default(false),
  checkedAt: z.number().nullable().optional(),
});
export type SourceOffer = z.infer<typeof SourceOfferSchema>;

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
  excludeAppOnly: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional(),
  sort: z.enum(['discount', 'price', 'pricePerUnit', 'validTo']).default('discount'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type OfferFilters = z.infer<typeof OfferFiltersSchema>;

export function discountPercent(o: Pick<Offer, 'priceRegular' | 'pricePromo'>): number | null {
  if (!o.priceRegular || o.priceRegular <= 0) return null;
  return Math.round((1 - o.pricePromo / o.priceRegular) * 100);
}

export function detectedConditionLabels(offer: SourceOffer): string[] {
  const field = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable() });
  const schema = z
    .object({
      requiresApp: field(z.boolean()),
      loyalty: field(z.string()),
      couponActivation: field(z.boolean()),
      minimumSpend: field(z.number().positive()).optional(),
      selectedProducts: field(z.boolean()).optional(),
      addOn: field(z.boolean()).optional(),
      priceQuantity: field(z.number().int().positive()).optional(),
      multiBuy: field(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('buy-get'), paid: z.number(), free: z.number() }),
          z.object({ kind: z.literal('minimum-quantity'), quantity: z.number() }),
          z.object({
            kind: z.literal('quantity-discount'),
            quantity: z.number(),
            percent: z.number(),
          }),
          z.object({ kind: z.literal('nth-discount'), position: z.number(), percent: z.number() }),
        ]),
      ),
    })
    .safeParse(offer.promotion);
  if (!schema.success || offer.ocrStale) return [];
  const p = schema.data,
    labels: string[] = [];
  if (p.requiresApp.value === true) labels.push('Wymaga aplikacji');
  if (p.loyalty.value === 'card-or-app') labels.push('Z kartą lub aplikacją');
  if (p.loyalty.value === 'card-only') labels.push('Wymaga karty');
  if (p.couponActivation.value === true) labels.push('Aktywacja kuponu');
  if (p.addOn?.value === true) labels.push('Oferta dodatkowa');
  if (p.minimumSpend?.value !== null && p.minimumSpend?.value !== undefined)
    labels.push(
      `${p.selectedProducts?.value === true ? 'Po zakupie wybranych produktów' : 'Przy zakupach'} za min. ${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(p.minimumSpend.value)} zł`,
    );
  const rule = p.multiBuy.value;
  const priceQuantity = p.priceQuantity?.value;
  if (priceQuantity) labels.push(`Cena za sztukę przy zakupie ${priceQuantity} szt.`);
  else if (rule?.kind === 'nth-discount') labels.push(`Przy zakupie ${rule.position} szt.`);
  else if (rule?.kind === 'buy-get') labels.push(`Przy zakupie ${rule.paid + rule.free} szt.`);
  if (rule?.kind === 'buy-get') labels.push(`${rule.paid}+${rule.free} gratis`);
  if (rule?.kind === 'minimum-quantity' && !priceQuantity)
    labels.push(`Przy zakupie ${rule.quantity} szt.`);
  if (rule?.kind === 'quantity-discount')
    labels.push(`${rule.percent}% taniej przy zakupie ${rule.quantity} szt.`);
  if (rule?.kind === 'nth-discount')
    labels.push(`${rule.position}. produkt ${rule.percent}% taniej`);
  return labels;
}

export function warsawDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
