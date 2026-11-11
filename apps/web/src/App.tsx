import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discountPercent, getPromotionStatus, todayInWarsaw, type Offer } from '@promo/shared';
import { PromotionValidity } from './components/PromotionValidity';

export function App() {
  const [selectedDate, setSelectedDate] = useState(() => todayInWarsaw());
  const [statusFilter, setStatusFilter] = useState('active');

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

  const offers = (data?.items ?? []).filter(
    (offer) => statusFilter === 'all' || getPromotionStatus(offer, selectedDate) === statusFilter,
  );

  return (
    <main
      style={{
        fontFamily: 'system-ui',
        maxWidth: 960,
        margin: '0 auto',
        padding: 16,
      }}
    >
      <h1>Promki dla studenta</h1>

      <fieldset
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 20,
        }}
      >
        <legend>
          <strong>Terminy promocji</strong>
        </legend>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <label htmlFor="promotion-date">Sprawdź promocje na dzień:</label>

          <input
            id="promotion-date"
            type="date"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedDate(e.target.value);
              }
            }}
          />

          <button type="button" onClick={() => setSelectedDate(todayInWarsaw())}>
            Dzisiaj
          </button>

          <label htmlFor="promotion-status">Status:</label>

          <select
            id="promotion-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Wszystkie</option>
            <option value="active">Aktywne</option>
            <option value="upcoming">Nadchodzące</option>
            <option value="expired">Zakończone</option>
          </select>
        </div>
      </fieldset>

      <p>Znaleziono: {offers.length}</p>

      {offers.length === 0 ? (
        <p>Brak promocji spełniających wybrane kryteria.</p>
      ) : (
        <ul>
          {offers.map((o) => (
            <li key={o.id} style={{ marginBottom: 20 }}>
              [{o.store}] {o.name} — {o.pricePromo.toFixed(2)} zł
              {discountPercent(o) !== null && ` (-${discountPercent(o)}%)`}
              <PromotionValidity period={o} onDate={selectedDate} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
