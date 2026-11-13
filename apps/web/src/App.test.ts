import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourceOfferSchema } from '@promo/shared';
import { App } from './App.js';

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
      multiBuy: { value: { kind: 'quantity-discount', quantity: 3, percent: 26 } },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], { items: [item], total: 25 });
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(App)));
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
  client
    .getQueryCache()
    .find({ queryKey: ['offers', 'page=1&pageSize=24&sort=price'] })!
    .setState({ status: 'error', error: new Error('offline') });
  const cached = renderToString(createElement(QueryClientProvider, { client }, createElement(App)));
  assert.ok(cached.includes('Test product'));
  assert.ok(cached.includes('Pokazano poprzednie dane'));
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], {
    items: [{ ...item, unit: 'szt', unitQuantity: 20 }],
    total: 1,
  });
  const pieces = renderToString(
    createElement(QueryClientProvider, { client }, createElement(App)),
  ).replace(/<!--.*?-->/g, '');
  assert.ok(pieces.includes('Ilość: 20 szt'));
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], {
    items: [{ ...item, reportedPrice: 0.59, priceRegular: 0.59, pricePrevious: 0.7 }],
    total: 1,
  });
  const changed = renderToString(
    createElement(QueryClientProvider, { client }, createElement(App)),
  );
  assert.ok(changed.includes('Poprzednia cena:'));
  assert.ok(changed.includes('<s>0,70 zł</s>'));
  assert.ok(!changed.includes('Cena regularna:'));
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], {
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
  const deli = renderToString(
    createElement(QueryClientProvider, { client }, createElement(App)),
  ).replace(/<!--.*?-->/g, '');
  assert.ok(deli.includes('1,79 zł / 100 g'));
  assert.ok(deli.includes('<s>2,19 zł / 100 g</s>'));
  assert.ok(!deli.includes('Ilość:'));
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], {
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
  const unknown = renderToString(
    createElement(QueryClientProvider, { client }, createElement(App)),
  );
  assert.ok(unknown.includes('Warunki ceny nieustalone'));
  assert.ok(unknown.includes('0,20 zł'));
  client.setQueryData(['offers', 'page=1&pageSize=24&sort=price'], {
    items: [{ ...item, promotion: undefined, offerKind: 'price-reduction' }],
    total: 1,
  });
  const reduction = renderToString(
    createElement(QueryClientProvider, { client }, createElement(App)),
  );
  assert.ok(!reduction.includes('Warunki ceny nieustalone'));
  client.clear();
});
