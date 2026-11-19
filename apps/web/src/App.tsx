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
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

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

  if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
  if (store !== 'all') params.set('store', store);
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (noApp) params.set('excludeAppOnly', 'true');

  // Synchronizacja filtrów z adresem URL.
  useEffect(() => {
    const params = new URLSearchParams();

    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
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
  }, [debouncedSearch, store, maxPrice, noApp, sort, selectedDate, page]);

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

  const offers = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = page * 24 >= total;

  return (
    <>
      <nav className="navbar bg-white border-bottom mb-4">
        <div className="container">
          <span className="navbar-brand fw-bold mb-0">Promki dla studenta</span>
          <span className="text-body-secondary small d-none d-md-inline">
            Promocje z Biedronki i Lidla w jednym miejscu
          </span>
        </div>
      </nav>

      <main className="container pb-5">
        <div className="card mb-4">
          <div className="card-body">
            <div className="row g-3 align-items-end">
              <div className="col-12 col-lg-3">
                <label htmlFor="search" className="form-label small text-body-secondary">
                  Produkt
                </label>
                <input
                  id="search"
                  className="form-control"
                  placeholder="Szukaj, np. kawa"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="col-6 col-md-3 col-lg-2">
                <label htmlFor="store" className="form-label small text-body-secondary">
                  Sklep
                </label>
                <select
                  id="store"
                  className="form-select"
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
              </div>

              <div className="col-6 col-md-3 col-lg-2">
                <label htmlFor="max-price" className="form-label small text-body-secondary">
                  Maks. cena
                </label>
                <div className="input-group">
                  <input
                    id="max-price"
                    type="number"
                    min="0"
                    className="form-control"
                    value={maxPrice}
                    onChange={(e) => {
                      setMaxPrice(e.target.value);
                      setPage(1);
                    }}
                  />
                  <span className="input-group-text">zł</span>
                </div>
              </div>

              <div className="col-6 col-md-3 col-lg-3">
                <label htmlFor="sort" className="form-label small text-body-secondary">
                  Sortowanie
                </label>
                <select
                  id="sort"
                  className="form-select"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="price">Najniższa cena</option>
                  <option value="validTo">Koniec oferty</option>
                </select>
              </div>

              {/* MPT26-21: wybór daty promocji */}
              <div className="col-6 col-md-3 col-lg-2">
                <label htmlFor="promotion-date" className="form-label small text-body-secondary">
                  Promocje na dzień
                </label>
                <input
                  id="promotion-date"
                  type="date"
                  className="form-control"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value);
                      setPage(1);
                    }
                  }}
                />
              </div>
            </div>

            <div className="d-flex flex-wrap align-items-center gap-3 mt-3">
              <div className="form-check form-switch mb-0">
                <input
                  id="no-app"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={noApp}
                  onChange={(e) => {
                    setNoApp(e.target.checked);
                    setPage(1);
                  }}
                />
                <label htmlFor="no-app" className="form-check-label">
                  Bez aplikacji
                </label>
              </div>

              {selectedDate !== warsawDate() && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    setSelectedDate(warsawDate());
                    setPage(1);
                  }}
                >
                  Dzisiaj
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className={`alert ${data ? 'alert-warning' : 'alert-danger'}`}>
            {data
              ? 'Nie udało się odświeżyć ofert. Pokazano poprzednie dane.'
              : `Błąd: ${String(error)}`}
          </div>
        )}

        {offers.some((offer) => offer.recheckDue) && (
          <div className="alert alert-info py-2 small">
            Część danych oczekuje na ponowne sprawdzenie źródła.
          </div>
        )}

        <div className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-3">
          <h2 className="h5 mb-0">
            Znaleziono: {total}
            {isLoading && (
              <span
                role="status"
                className="spinner-border spinner-border-sm text-secondary ms-2"
                aria-label="Ładowanie…"
              />
            )}
          </h2>
          <small className="text-body-secondary">
            Dane pochodzą z gazetek. Sprawdź warunki przed zakupem.
          </small>
        </div>

        {data?.total === 0 && (
          <div className="alert alert-light border">
            Brak promocji obowiązujących w wybranym dniu.
            {noApp && ' Brak ofert z potwierdzonym brakiem wymogu aplikacji.'}
          </div>
        )}

        <div className="row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-3">
          {offers.map((o) => {
            const labels = detectedConditionLabels(o);

            const priceSuffix = o.priceQuantity
              ? ` / ${new Intl.NumberFormat('pl-PL').format(
                  o.priceQuantity.amount < 1
                    ? o.priceQuantity.amount * 1000
                    : o.priceQuantity.amount,
                )} ${
                  o.priceQuantity.amount < 1
                    ? o.priceQuantity.unit === 'kg'
                      ? 'g'
                      : 'ml'
                    : o.priceQuantity.unit
                }`
              : '';

            return (
              <div key={o.id} className="col">
                <div className="card h-100">
                  <div className="card-body d-flex flex-column">
                    <span
                      className="badge align-self-start mb-2"
                      style={{ background: o.store === 'lidl' ? '#0050aa' : '#e30613' }}
                    >
                      {o.store === 'lidl' ? 'Lidl' : 'Biedronka'}
                    </span>

                    <h3 className="h6 card-title mb-1">{o.name}</h3>

                    {o.unitQuantity !== null &&
                      o.unitQuantity > 0 &&
                      (o.unit === 'kg' || o.unit === 'l' || o.unit === 'szt') && (
                        <small className="text-body-secondary">
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

                    <p className="fs-4 fw-bold mt-2 mb-0">
                      {formatPrice(o.reportedPrice)}
                      {priceSuffix}
                    </p>

                    {o.priceRegular !== null && o.priceRegular > o.reportedPrice && (
                      <small className="text-body-secondary">
                        Cena regularna:{' '}
                        <s>
                          {formatPrice(o.priceRegular)}
                          {priceSuffix}
                        </s>
                      </small>
                    )}

                    {o.pricePrevious != null && o.pricePrevious > o.reportedPrice && (
                      <small className="text-body-secondary">
                        Poprzednia cena: <s>{formatPrice(o.pricePrevious)}</s>
                      </small>
                    )}

                    <div className="d-flex flex-wrap gap-1 mt-2">
                      {labels.map((label) => (
                        <span
                          key={label}
                          className="badge text-bg-warning fw-normal text-wrap text-start"
                        >
                          {label}
                        </span>
                      ))}
                    </div>

                    {labels.length === 0 && o.offerKind !== 'price-reduction' && (
                      <small className="text-body-secondary fst-italic">
                        Warunki ceny nieustalone. Sprawdź gazetkę.
                      </small>
                    )}

                    {o.stale && <small className="text-danger">Dane nie zostały odświeżone</small>}

                    {/* MPT26-21: daty i status promocji */}
                    <div className="mt-auto">
                      <PromotionValidity period={o} onDate={selectedDate} />
                    </div>
                  </div>

                  <div className="card-footer bg-transparent small">
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <nav className="mt-4" aria-label="Strony wyników">
          <ul className="pagination justify-content-center mb-0">
            <li className={`page-item ${page === 1 ? 'disabled' : ''}`}>
              <button className="page-link" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Poprzednia
              </button>
            </li>
            <li className="page-item active" aria-current="page">
              <span className="page-link">Strona {page}</span>
            </li>
            <li className={`page-item ${lastPage ? 'disabled' : ''}`}>
              <button className="page-link" disabled={lastPage} onClick={() => setPage(page + 1)}>
                Następna
              </button>
            </li>
          </ul>
        </nav>
      </main>
    </>
  );
}
