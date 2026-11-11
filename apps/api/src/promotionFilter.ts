import { isPromotionActiveOn, type Offer } from '@promo/shared';

/** Used by the in-memory demo API. A future SQL backend should apply equivalent WHERE logic. */
export function applyPromotionDateFilter(items: Offer[], activeOn?: string): Offer[] {
  if (!activeOn) return items;
  return items.filter((offer) => isPromotionActiveOn(offer, activeOn));
}
