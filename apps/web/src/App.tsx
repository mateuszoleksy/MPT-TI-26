import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discountPercent, type Offer } from '@promo/shared';

function pricePerUnit(o: Offer): number | null {
  if (!o.unit || !o.unitQuantity) return null;
  return o.pricePromo / o.unitQuantity;
}

function formatPrice(value: number): string {
  return value.toFixed(2).replace('.', ',') + ' zł';
}

function formatDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

export function App() {
  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [noApp, setNoApp] = useState(false);
  const [sort, setSort] = useState('price');

  const { data, isLoading, error } = useQuery({
    queryKey: ['offers'],
    queryFn: async (): Promise<{ items: Offer[] }> => {
      const res = await fetch('/api/offers');
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json();
    },
  });

  if (isLoading) return <p style={{ padding: 16 }}>Ładowanie…</p>;
  if (error) return <p style={{ padding: 16 }}>Błąd: {String(error)}</p>;

  const today = new Date().toISOString().slice(0, 10);

  let offers = (data?.items ?? []).filter((o) => {
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (store !== 'all' && o.store !== store) return false;
    if (maxPrice && o.pricePromo > Number(maxPrice)) return false;
    if (noApp && o.requiresApp) return false;
    return true;
  });

  offers = [...offers].sort((a, b) => {
    if (sort === 'unit') return (pricePerUnit(a) ?? Infinity) - (pricePerUnit(b) ?? Infinity);
    return a.pricePromo - b.pricePromo;
  });

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>Promki dla studenta</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Szukaj, np. kawa"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="all">Oba sklepy</option>
          <option value="biedronka">Biedronka</option>
          <option value="lidl">Lidl</option>
        </select>
        <label>
          Maks. cena:{' '}
          <input
            type="number"
            style={{ width: 70 }}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />{' '}
          zł
        </label>
        <label>
          <input type="checkbox" checked={noApp} onChange={(e) => setNoApp(e.target.checked)} /> Bez
          aplikacji
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="price">Sortuj: najniższa cena</option>
          <option value="unit">Sortuj: cena za kg / l</option>
        </select>
      </div>

      <p>Znaleziono: {offers.length}</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        {offers.map((o) => {
          const discount = discountPercent(o);
          const perUnit = pricePerUnit(o);
          return (
            <div key={o.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 10 }}>
              <b style={{ color: o.store === 'lidl' ? '#0050aa' : '#e30613' }}>
                {o.store === 'lidl' ? 'Lidl' : 'Biedronka'}
              </b>
              <p style={{ margin: '6px 0' }}>{o.name}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 'bold' }}>
                {formatPrice(o.pricePromo)}
              </p>
              {o.priceRegular && (
                <p style={{ margin: 0, color: '#888' }}>
                  <s>{formatPrice(o.priceRegular)}</s> {discount !== null && `(-${discount}%)`}
                </p>
              )}
              <p style={{ margin: '4px 0', color: perUnit ? 'green' : '#aaa' }}>
                {perUnit ? `${formatPrice(perUnit)}/${o.unit}` : 'cena/kg: brak danych'}
              </p>
              {o.requiresApp && <p style={{ margin: 0 }}>📱 z aplikacją</p>}
              {o.conditions && !o.requiresApp && <p style={{ margin: 0 }}>{o.conditions}</p>}
              <small>
                {o.validFrom > today
                  ? `od ${formatDate(o.validFrom)}`
                  : `do ${formatDate(o.validTo)}`}
              </small>
            </div>
          );
        })}
      </div>
    </main>
  );
}
