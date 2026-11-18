import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { SourceOfferSchema, warsawDate } from '@promo/shared';
import { App } from './App.js';

// The application includes activeOn in every API query.
// Preserve the exact parameter order used by App.tsx.
function withSelectedDate(key: string, date = warsawDate()): string {
  const [page, pageSize, sort, ...filters] = key.split('&');
  return [page, pageSize, sort, `activeOn=${date}`, ...filters].join('&');
}

function createTestClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
}

function renderApp(client: QueryClient): string {
  return renderToString(createElement(QueryClientProvider, { client }, createElement(App)));
}

test('renders source prices and detected conditions with a warning', () => {
  const item = SourceOfferSchema.parse({
    id: 'a',
    store: 'lidl',
    name: 'Test product',
    category: null,
    priceRegular: 6.99,
    reportedPrice: 5.49,
    priceBasis: 'unknown',
    unit: 'kg',
    unitQuantity: 0.2,
    conditions: null,
    requiresApp: null,
    imageUrl: null,
    sourceUrl: 'https://blix.pl/sklep/lidl/gazetka/123/',
    validFrom: '2026-11-09',
    validTo: '2026-11-14',
    reviewRequired: true,
    recheckDue: true,
    leafletId: '123',
    pageNumber: 1,
    promotion: {
      requiresApp: { value: null },
      loyalty: { value: null },
      couponActivation: { value: null },
      multiBuy: {
        value: {
          kind: 'quantity-discount',
          quantity: 3,
          percent: 26,
        },
      },
    },
  });

  const client = createTestClient();
  const queryKey = ['offers', withSelectedDate('page=1&pageSize=24&sort=price')];

  client.setQueryData(queryKey, {
    items: [item],
    total: 25,
  });

  const html = renderApp(client);

  assert.ok(html.includes('Test product'));
  assert.ok(html.includes('5,49 zł'));
  assert.ok(html.includes('26% taniej przy zakupie 3 szt.'));
  assert.ok(html.includes('Sprawdź warunki przed zakupem'));
  assert.ok(html.includes('oczekuje na ponowne sprawdzenie źródła'));
  assert.ok(html.includes('Cena regularna:'));
  assert.ok(html.includes('Ilość:'));
  assert.ok(html.includes('200'));
  assert.ok(html.includes('<s>6,99 zł</s>'));
  assert.ok(html.includes(item.sourceUrl));

  // Verify that cached data remains visible after an API error.
  client
    .getQueryCache()
    .find({ queryKey })!
    .setState({
      status: 'error',
      error: new Error('offline'),
    });

  const cached = renderApp(client);

  assert.ok(cached.includes('Test product'));
  assert.ok(cached.includes('Pokazano poprzednie dane'));

  // Unit quantity displayed in pieces.
  client.setQueryData(queryKey, {
    items: [{ ...item, unit: 'szt', unitQuantity: 20 }],
    total: 1,
  });

  const pieces = renderApp(client).replace(/<!--.*?-->/g, '');

  assert.ok(pieces.includes('Ilość: 20 szt'));

  // Previous price must be distinct from regular price.
  client.setQueryData(queryKey, {
    items: [
      {
        ...item,
        reportedPrice: 0.59,
        priceRegular: 0.59,
        pricePrevious: 0.7,
      },
    ],
    total: 1,
  });

  const changed = renderApp(client);

  assert.ok(changed.includes('Poprzednia cena:'));
  assert.ok(changed.includes('<s>0,70 zł</s>'));
  assert.ok(!changed.includes('Cena regularna:'));

  // Price per quantity.
  client.setQueryData(queryKey, {
    items: [
      {
        ...item,
        unit: null,
        unitQuantity: null,
        reportedPrice: 1.79,
        priceRegular: 2.19,
        priceQuantity: { unit: 'kg', amount: 0.1 },
      },
    ],
    total: 1,
  });

  const deli = renderApp(client).replace(/<!--.*?-->/g, '');

  assert.ok(deli.includes('1,79 zł / 100 g'));
  assert.ok(deli.includes('<s>2,19 zł / 100 g</s>'));
  assert.ok(!deli.includes('Ilość:'));

  // Unknown conditions.
  client.setQueryData(queryKey, {
    items: [
      {
        ...item,
        name: 'Oferta z niepełnym odczytem',
        reportedPrice: 0.2,
        priceRegular: null,
        unit: null,
        unitQuantity: null,
        promotion: undefined,
        offerKind: 'unknown',
      },
    ],
    total: 1,
  });

  const unknown = renderApp(client);

  assert.ok(unknown.includes('Warunki ceny nieustalone'));
  assert.ok(unknown.includes('0,20 zł'));

  client.setQueryData(queryKey, {
    items: [
      {
        ...item,
        promotion: undefined,
        offerKind: 'price-reduction',
      },
    ],
    total: 1,
  });

  const reduction = renderApp(client);

  assert.ok(!reduction.includes('Warunki ceny nieustalone'));

  client.clear();
});

for (const [search, key, total] of [
  [
    '?q=kawa&store=lidl&maxPrice=20&excludeAppOnly=true&sort=validTo&page=2',
    'page=2&pageSize=24&sort=validTo&q=kawa&store=lidl&maxPrice=20&excludeAppOnly=true',
    49,
  ],
  ['?q=%20%20kawa%20%20', 'page=1&pageSize=24&sort=price&q=kawa', 8],
  ['?q=%20%20%20', 'page=1&pageSize=24&sort=price', 9],
  ['?store=unknown&maxPrice=-5&sort=pricePerUnit&page=1.5', 'page=1&pageSize=24&sort=price', 7],
] as const) {
  test(`restores safe API filters from URL: ${search}`, () => {
    vi.stubGlobal('window', {
      location: { search },
    });

    const client = createTestClient();

    try {
      const queryKey = ['offers', withSelectedDate(key)];

      client.setQueryData(queryKey, {
        items: [],
        total,
      });

      const html = renderApp(client).replace(/<!--.*?-->/g, '');

      assert.ok(html.includes(`Znaleziono: ${total}`));
      assert.ok(html.includes(`Strona ${total === 49 ? 2 : 1}`));
      assert.ok(!html.includes('value="-5"'));
    } finally {
      client.clear();
      vi.unstubAllGlobals();
    }
  });
}

test('uses selected promotion date in API query', () => {
  const selectedDate = '2026-11-11';

  vi.stubGlobal('window', {
    location: {
      search: `?activeOn=${selectedDate}`,
    },
  });

  const client = createTestClient();

  try {
    const queryKey = ['offers', withSelectedDate('page=1&pageSize=24&sort=price', selectedDate)];

    client.setQueryData(queryKey, {
      items: [],
      total: 3,
    });

    const html = renderApp(client).replace(/<!--.*?-->/g, '');

    assert.ok(html.includes('Znaleziono: 3'));
    assert.ok(html.includes('value="2026-11-11"'));
  } finally {
    client.clear();
    vi.unstubAllGlobals();
  }
});

test('keeps search input focused while typing and debounces API and URL updates', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/',
  });
  const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const container = dom.window.document.getElementById('root')!;
  let unmount: (() => void) | undefined;

  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);

  try {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    unmount = () => root.unmount();
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(App)));
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Szukaj, np. kawa"]')!;
    await act(async () => {
      input.focus();
      for (const value of ['k', 'ka', 'kaw', 'kawa']) {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      }
    });

    assert.equal(dom.window.document.activeElement, input);
    assert.equal(container.querySelector('input[placeholder="Szukaj, np. kawa"]'), input);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(dom.window.location.search, '');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    assert.equal(dom.window.document.activeElement, input);
    assert.equal(container.querySelector('input[placeholder="Szukaj, np. kawa"]'), input);
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(dom.window.location.search, '?q=kawa');
    assert.equal(dom.window.location.pathname, '/');
  } finally {
    const cleanup = unmount;
    if (cleanup) await act(async () => cleanup());
    client.clear();
    vi.unstubAllGlobals();
    dom.window.close();
  }
});
