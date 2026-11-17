import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detectedConditionLabels, warsawDate, type SourceOffer as Offer } from '@promo/shared';
import { PromotionValidity } from './components/PromotionValidity';

function formatPrice(value: number): string {
  return value.toFixed(2).replace('.', ',') + ' zł';
}

const urlParams = () =>
  new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

function initialDate(): string {
  const value = urlParams().get('activeOn');
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) {
      return value;
    }
  }
  return warsawDate();
}

export function App() {
  const [search, setSearch] = useState(() => urlParams().get('q') ?? '');

  const [store, setStore] = useState(() => {
    const value = urlParams().get('store');
    return value === 'biedronka' || value === 'lidl' ? value : 'all';
  });

  const [maxPrice, setMaxPrice] = useState(() => {
    const value = urlParams().get('maxPrice') ?? '';
    return value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? value : '';
  });

  const [noApp, setNoApp] = useState(() => urlParams().get('excludeAppOnly') === 'true');

  const [sort, setSort] = useState(() =>
    urlParams().get('sort') === 'validTo' ? 'validTo' : 'price',
  );

  const [selectedDate, setSelectedDate] = useState(initialDate);

  const [page, setPage] = useState(() => {
    const value = Number(urlParams().get('page'));
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  });

  const params = new URLSearchParams({
    page: String(page),
    pageSize: '24',
    sort,
    activeOn: selectedDate,
  });

  if (search) params.set('q', search);
  if (store !== 'all') params.set('store', store);
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (noApp) params.set('excludeAppOnly', 'true');

  // Synchronizacja filtrów z adresem URL.
  useEffect(() => {
    const params = new URLSearchParams();

    if (search) params.set('q', search);
    if (store !== 'all') params.set('store', store);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (noApp) params.set('excludeAppOnly', 'true');
    if (sort !== 'price') params.set('sort', sort);
    if (selectedDate !== warsawDate()) {
      params.set('activeOn', selectedDate);
    }
    if (page !== 1) params.set('page', String(page));

    const query = params.toString();

    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  }, [search, store, maxPrice, noApp, sort, selectedDate, page]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['offers', params.toString()],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,

    queryFn: async (): Promise<{ items: Offer[]; total: number }> => {
      const api = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${api}/api/offers?${params}`);

      if (!res.ok) throw new Error(`API error ${res.status}`);

      return res.json();
    },
  });

  if (isLoading) return <p style={{ padding: 16 }}>Ładowanie…</p>;

  if (error && !data) {
    return <p style={{ padding: 16 }}>Błąd: {String(error)}</p>;
  }

  const offers = data?.items ?? [];

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

      {/* Istniejące filtry */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <input
          placeholder="Szukaj, np. kawa"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />

        <select
          value={store}
          onChange={(e) => {
            setStore(e.target.value);
            setPage(1);
          }}
        >
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
            onChange={(e) => {
              setMaxPrice(e.target.value);
              setPage(1);
            }}
          />{' '}
          zł
        </label>

        <label>
          <input
            type="checkbox"
            checked={noApp}
            onChange={(e) => {
              setNoApp(e.target.checked);
              setPage(1);
            }}
          />{' '}
          Bez aplikacji
        </label>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="price">Sortuj: najniższa cena</option>
          <option value="validTo">Sortuj: koniec oferty</option>
        </select>
      </div>

      {/* MPT26-21: wybór daty promocji */}
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
                setPage(1);
              }
            }}
          />

          <button
            type="button"
            onClick={() => {
              setSelectedDate(warsawDate());
              setPage(1);
            }}
          >
            Dzisiaj
          </button>
        </div>
      </fieldset>

      {error && <p>Nie udało się odświeżyć ofert. Pokazano poprzednie dane.</p>}

      <p>Znaleziono: {data?.total ?? 0}</p>

      {data?.total === 0 && <p>Brak promocji obowiązujących w wybranym dniu.</p>}

      {noApp && data?.total === 0 && <p>Brak ofert z potwierdzonym brakiem wymogu aplikacji.</p>}

      <p>Dane pochodzą z gazetek. Sprawdź warunki przed zakupem.</p>

      {offers.some((offer) => offer.recheckDue) && (
        <p>Część danych oczekuje na ponowne sprawdzenie źródła.</p>
      )}

      {/* Paginacja */}
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        Poprzednia
      </button>

      <span> Strona {page} </span>

      <button disabled={page * 24 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
        Następna
      </button>

      {/* Siatka produktów */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        {offers.map((o) => {
          const labels = detectedConditionLabels(o);

          const priceSuffix = o.priceQuantity
            ? ` / ${new Intl.NumberFormat('pl-PL').format(
                o.priceQuantity.amount < 1 ? o.priceQuantity.amount * 1000 : o.priceQuantity.amount,
              )} ${
                o.priceQuantity.amount < 1
                  ? o.priceQuantity.unit === 'kg'
                    ? 'g'
                    : 'ml'
                  : o.priceQuantity.unit
              }`
            : '';

          return (
            <div
              key={o.id}
              style={{
                border: '1px solid #ccc',
                borderRadius: 8,
                padding: 10,
              }}
            >
              <b
                style={{
                  color: o.store === 'lidl' ? '#0050aa' : '#e30613',
                }}
              >
                {o.store === 'lidl' ? 'Lidl' : 'Biedronka'}
              </b>

              <p style={{ margin: '6px 0' }}>{o.name}</p>

              {o.unitQuantity !== null &&
                o.unitQuantity > 0 &&
                (o.unit === 'kg' || o.unit === 'l' || o.unit === 'szt') && (
                  <small>
                    Ilość:{' '}
                    {new Intl.NumberFormat('pl-PL', {
                      maximumFractionDigits: 6,
                    }).format(
                      o.unit !== 'szt' && o.unitQuantity < 1
                        ? o.unitQuantity * 1000
                        : o.unitQuantity,
                    )}{' '}
                    {o.unit !== 'szt' && o.unitQuantity < 1
                      ? o.unit === 'kg'
                        ? 'g'
                        : 'ml'
                      : o.unit}
                  </small>
                )}

              <p
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 'bold',
                }}
              >
                {formatPrice(o.reportedPrice)}
                {priceSuffix}
              </p>

              {o.priceRegular !== null && o.priceRegular > o.reportedPrice && (
                <p style={{ margin: 0, color: '#666' }}>
                  Cena regularna:{' '}
                  <s>
                    {formatPrice(o.priceRegular)}
                    {priceSuffix}
                  </s>
                </p>
              )}

              {o.pricePrevious != null && o.pricePrevious > o.reportedPrice && (
                <p style={{ margin: 0, color: '#666' }}>
                  Poprzednia cena: <s>{formatPrice(o.pricePrevious)}</s>
                </p>
              )}

              {labels.length === 0 && o.offerKind !== 'price-reduction' && (
                <p style={{ margin: '4px 0' }}>Warunki ceny nieustalone. Sprawdź gazetkę.</p>
              )}

              {labels.map((label) => (
                <p key={label} style={{ margin: 0 }}>
                  {label}
                </p>
              ))}

              {o.stale && <p>Dane nie zostały odświeżone</p>}

              <p>
                {(
                  o.sources ?? [
                    {
                      id: o.id,
                      sourceUrl: o.sourceUrl,
                    },
                  ]
                ).map((source, index) => (
                  <span key={source.id}>
                    {index > 0 && ' · '}
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                      {(o.sources?.length ?? 0) > 1 ? `Źródło ${index + 1}` : 'Sprawdź źródło'}
                    </a>
                  </span>
                ))}
              </p>

              {/* MPT26-21: daty i status promocji */}
              <PromotionValidity period={o} onDate={selectedDate} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
