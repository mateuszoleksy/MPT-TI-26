import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  discountPercent,
  getPromotionStatus,
  todayInWarsaw,
  type Offer,
  type PromotionStatus,
} from '@promo/shared';
import { PromotionValidity } from './components/PromotionValidity';

function pricePerUnit(o: Offer): number | null {
  if (!o.unit || !o.unitQuantity || o.unitQuantity <= 0) return null;
  return o.pricePromo / o.unitQuantity;
}

function formatPrice(value: number): string {
  return value.toFixed(2).replace('.', ',') + ' zł';
}

type StatusFilter = PromotionStatus | 'all';
type SortMode = 'price' | 'unit' | 'validTo';

export function App() {
  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [noApp, setNoApp] = useState(false);
  const [sort, setSort] = useState<SortMode>('price');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [onDate, setOnDate] = useState(todayInWarsaw);
  const [today, setToday] = useState(todayInWarsaw);

  // Keep the "today" shortcut correct when the browser stays open overnight.
  useEffect(() => {
    const interval = setInterval(() => setToday(todayInWarsaw()), 60_000);
    return () => clearInterval(interval);
  }, []);

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

  // For the current demo, filtering happens in the browser on API sample data.
  // The same date rules can later be used by the PostgreSQL-backed API.
  let offers = (data?.items ?? []).filter((o) => {
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (store !== 'all' && o.store !== store) return false;
    if (maxPrice && o.pricePromo > Number(maxPrice)) return false;
    if (noApp && o.requiresApp) return false;
    if (status !== 'all' && getPromotionStatus(o, onDate) !== status) return false;
    return true;
  });

  offers = [...offers].sort((a, b) => {
    if (sort === 'unit') return (pricePerUnit(a) ?? Infinity) - (pricePerUnit(b) ?? Infinity);
    if (sort === 'validTo')
      return a.validTo.localeCompare(b.validTo) || a.name.localeCompare(b.name);
    return a.pricePromo - b.pricePromo;
  });

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>Promki dla studenta</h1>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        <input
          aria-label="Szukaj produktu"
          placeholder="Szukaj, np. kawa"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Sklep" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="all">Oba sklepy</option>
          <option value="biedronka">Biedronka</option>
          <option value="lidl">Lidl</option>
        </select>
        <label>
          Maks. cena:{' '}
          <input
            type="number"
            min="0"
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
        <select
          aria-label="Sortowanie"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
        >
          <option value="price">Sortuj: najniższa cena</option>
          <option value="unit">Sortuj: cena za kg / l</option>
          <option value="validTo">Sortuj: najbliższy koniec</option>
        </select>
      </div>

      <fieldset
        style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: '0 0 16px' }}
      >
        <legend style={{ fontWeight: 700 }}>Terminy promocji</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            Sprawdź na dzień:{' '}
            <input
              type="date"
              aria-label="Data sprawdzania promocji"
              value={onDate}
              onChange={(e) => {
                if (e.target.value) setOnDate(e.target.value);
              }}
            />
          </label>
          <button type="button" onClick={() => setOnDate(today)} disabled={onDate === today}>
            Dzisiaj
          </button>
          <label>
            Status:{' '}
            <select
              aria-label="Status promocji"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="active">Aktywne</option>
              <option value="upcoming">Nadchodzące</option>
              <option value="expired">Zakończone</option>
              <option value="all">Wszystkie</option>
            </select>
          </label>
        </div>
      </fieldset>

      <p>Znaleziono: {offers.length}</p>
      {offers.length === 0 && <p>Brak promocji spełniających wybrane kryteria.</p>}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 12,
        }}
      >
        {offers.map((o) => {
          const discount = discountPercent(o);
          const perUnit = pricePerUnit(o);
          return (
            <article key={o.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 10 }}>
              <b style={{ color: o.store === 'lidl' ? '#0050aa' : '#e30613' }}>
                {o.store === 'lidl' ? 'Lidl' : 'Biedronka'}
              </b>
              <p style={{ margin: '6px 0' }}>{o.name}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 'bold' }}>
                {formatPrice(o.pricePromo)}
              </p>
              {o.priceRegular !== null && (
                <p style={{ margin: 0, color: '#888' }}>
                  <s>{formatPrice(o.priceRegular)}</s> {discount !== null && `(-${discount}%)`}
                </p>
              )}
              <p style={{ margin: '4px 0', color: perUnit !== null ? 'green' : '#aaa' }}>
                {perUnit !== null ? `${formatPrice(perUnit)}/${o.unit}` : 'cena/kg: brak danych'}
              </p>
              {o.requiresApp && <p style={{ margin: 0 }}>📱 z aplikacją</p>}
              {o.conditions && !o.requiresApp && <p style={{ margin: 0 }}>{o.conditions}</p>}
              <PromotionValidity period={o} onDate={onDate} />
            </article>
          );
        })}
      </div>
    </main>
  );
}
