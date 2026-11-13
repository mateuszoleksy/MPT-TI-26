// API (Fastify, port 3000). Uruchomienie: npm run dev:api
// GET /api/health - czy serwer działa
// GET /api/offers - lista ofert { items, total, filters }
// Na razie dane wpisane na sztywno w `sample`, potem będą z bazy.
// Pola oferty: typ Offer w packages/shared/src/index.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OfferFiltersSchema, type Offer } from '@promo/shared';

const app = Fastify({ logger: true });
await app.register(cors);

// Prosty test, czy serwer odpowiada.
app.get('/api/health', async () => ({ status: 'ok' }));

// Link do strony sklepu – w prawdziwych danych będzie to link do konkretnej gazetki.
const LIDL = 'https://www.lidl.pl/';
const BIEDRONKA = 'https://www.biedronka.pl/';

// nazwy i ceny z blixa z dnia: 7.11.2026, reszta pól dopisana ręcznie
// l6 i b6 bez ceny regularnej i jednostki - jak niepełne dane z Blixa
// prettier-ignore: jedna oferta = jedna linia
// prettier-ignore
const sample: Offer[] = [
  { id: 'l1', store: 'lidl', name: 'Banany luzem', category: 'owoce i warzywa', priceRegular: 5.49, pricePromo: 2.99, unit: 'kg', unitQuantity: 1, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'l2', store: 'lidl', name: 'Masło ekstra Pilos 200 g', category: 'nabiał', priceRegular: 7.49, pricePromo: 2.49, unit: 'kg', unitQuantity: 0.2, conditions: 'z aplikacją Lidl Plus', requiresApp: true, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'l3', store: 'lidl', name: 'Kawa mielona Bellarom 500 g', category: 'kawa', priceRegular: 23.99, pricePromo: 15.99, unit: 'kg', unitQuantity: 0.5, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'l4', store: 'lidl', name: 'Ser gouda w plastrach Pilos 150 g', category: 'nabiał', priceRegular: 5.99, pricePromo: 4.49, unit: 'kg', unitQuantity: 0.15, conditions: '2+1 gratis', requiresApp: false, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'l5', store: 'lidl', name: 'Makaron spaghetti 500 g', category: 'makaron', priceRegular: 3.99, pricePromo: 2.79, unit: 'kg', unitQuantity: 0.5, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-12', validTo: '2026-11-18' },
  { id: 'l6', store: 'lidl', name: 'Rogal świętomarciński', category: null, priceRegular: null, pricePromo: 2.99, unit: null, unitQuantity: null, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: LIDL, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'b1', store: 'biedronka', name: 'Mleko UHT 3,2% 1 l', category: 'nabiał', priceRegular: 3.49, pricePromo: 1.99, unit: 'l', unitQuantity: 1, conditions: 'przy zakupie 6 szt.', requiresApp: false, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'b2', store: 'biedronka', name: 'Masło ekstra Łaciate 200 g', category: 'nabiał', priceRegular: 8.49, pricePromo: 3.99, unit: 'kg', unitQuantity: 0.2, conditions: 'z Moja Biedronka', requiresApp: true, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'b3', store: 'biedronka', name: "Kawa ziarnista Cafe D'Or 1 kg", category: 'kawa', priceRegular: 54.99, pricePromo: 34.99, unit: 'kg', unitQuantity: 1, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'b4', store: 'biedronka', name: 'Kawa rozpuszczalna Jacobs 200 g', category: 'kawa', priceRegular: 36.99, pricePromo: 24.99, unit: 'kg', unitQuantity: 0.2, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-05', validTo: '2026-11-11' },
  { id: 'b5', store: 'biedronka', name: 'Pieczarki 500 g', category: 'owoce i warzywa', priceRegular: 6.99, pricePromo: 4.99, unit: 'kg', unitQuantity: 0.5, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-12', validTo: '2026-11-18' },
  { id: 'b6', store: 'biedronka', name: 'Winogrona na wagę', category: null, priceRegular: null, pricePromo: 5.99, unit: null, unitQuantity: null, conditions: null, requiresApp: false, imageUrl: null, sourceUrl: BIEDRONKA, validFrom: '2026-11-05', validTo: '2026-11-11' },
];

// Zwraca wszystkie przykładowe oferty. Parametry zapytania (np. ?store=lidl) są tylko
// sprawdzane schematem OfferFiltersSchema – przy błędnych parametrach odpowiedź 400.
app.get('/api/offers', async (req, reply) => {
  const parsed = OfferFiltersSchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  return { items: sample, total: sample.length, filters: parsed.data };
});

// Port można zmienić zmienną środowiskową API_PORT (patrz .env.example).
const port = Number(process.env.API_PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
