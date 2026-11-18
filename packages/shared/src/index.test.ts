import { describe, expect, it } from 'vitest';
import { discountPercent, OfferFiltersSchema } from './index.js';

describe('discountPercent', () => {
  it('computes a rounded percentage', () => {
    expect(discountPercent({ priceRegular: 4.99, pricePromo: 2.99 })).toBe(40);
  });

  it('returns null when the regular price is unknown', () => {
    expect(discountPercent({ priceRegular: null, pricePromo: 2.99 })).toBeNull();
  });
});

describe('OfferFiltersSchema', () => {
  it('accepts a single store as well as many', () => {
    expect(OfferFiltersSchema.parse({ store: 'lidl' }).store).toEqual(['lidl']);
    expect(OfferFiltersSchema.parse({ store: ['lidl', 'biedronka'] }).store).toHaveLength(2);
  });

  it('coerces numbers from query strings and applies defaults', () => {
    const f = OfferFiltersSchema.parse({ maxPrice: '5' });
    expect(f).toMatchObject({ maxPrice: 5, sort: 'discount', page: 1, pageSize: 24 });
  });

  it('trims product search and treats whitespace only queries as absent', () => {
    expect(OfferFiltersSchema.parse({ q: '  kawa  ' }).q).toBe('kawa');
    expect(OfferFiltersSchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('rejects unknown stores and sort keys', () => {
    expect(OfferFiltersSchema.safeParse({ store: 'zabka' }).success).toBe(false);
    expect(OfferFiltersSchema.safeParse({ sort: 'bogus' }).success).toBe(false);
  });
});
