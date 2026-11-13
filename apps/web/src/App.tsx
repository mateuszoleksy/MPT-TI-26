import { useQuery } from '@tanstack/react-query';
import { calculateUnitPrice, discountPercent, type Offer, type Unit } from '@promo/shared';

const SUPPORTED_UNITS: Unit[] = [
  'g',
  'dag',
  'kg',
  'ml',
  'l',
  'piece',
  'pieces',
  'pc',
  'pcs',
  'szt',
];

function isSupportedUnit(unit: string): unit is Unit {
  return SUPPORTED_UNITS.includes(unit as Unit);
}

function getUnitPrice(offer: Offer) {
  if (
    offer.unit === null ||
    offer.unitQuantity === null ||
    !Number.isFinite(offer.unitQuantity) ||
    offer.unitQuantity <= 0 ||
    !isSupportedUnit(offer.unit)
  ) {
    return null;
  }

  return calculateUnitPrice(offer.pricePromo, offer.unitQuantity, offer.unit);
}

export function App() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['offers'],
    queryFn: async (): Promise<{ items: Offer[] }> => {
      const res = await fetch('/api/offers');
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json();
    },
  });

  if (isLoading) return <p>Ładowanie…</p>;
  if (error) return <p>Błąd: {String(error)}</p>;

  const items = data?.items ?? [];
  const unitPrices = items.map(getUnitPrice);

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>Promki dla studenta</h1>
      <ul>
        {items.map((o, index) => {
          const unitPrice = unitPrices[index];
          const bestComparablePrice =
            unitPrice === null
              ? null
              : Math.min(
                  ...unitPrices
                    .filter(
                      (candidate) =>
                        candidate !== null &&
                        candidate.category === unitPrice.category &&
                        candidate.unit === unitPrice.unit,
                    )
                    .map((candidate) => candidate?.price ?? Infinity),
                );
          const isBestValue = unitPrice !== null && unitPrice.price === bestComparablePrice;

          return (
            <li
              key={o.id}
              style={isBestValue ? { background: '#e8f5e9', fontWeight: 600 } : undefined}
            >
              [{o.store}] {o.name} — {o.pricePromo.toFixed(2)} zł
              {discountPercent(o) !== null && ` (-${discountPercent(o)}%)`}
              {unitPrice !== null && (
                <>
                  {' · '}
                  {unitPrice.price.toFixed(2)} zł / 1 {unitPrice.unit}
                  {isBestValue && ' · Najlepsza wartość'}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
