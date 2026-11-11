// Demo API: hard-coded offers, ready for replacement with PostgreSQL queries.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OfferFiltersSchema, type Offer } from '@promo/shared';
import { applyPromotionDateFilter } from './promotionFilter.js';

const app = Fastify({ logger: true });
await app.register(cors);
app.get('/api/health', async () => ({ status: 'ok' }));

const LIDL = 'https://www.lidl.pl/';
const BIEDRONKA = 'https://www.biedronka.pl/';

// Same demonstration records as feature/mpt26-17-simple-demo.
// Names and promo prices were transcribed from Blix, while other details are mocked.
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

app.get('/api/offers', async (req, reply) => {
  const parsed = OfferFiltersSchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  // Only the date-related query features are in scope for MPT26-21.
  // Remaining UI filters continue to work client-side in the current demo.
  const items = applyPromotionDateFilter(sample, parsed.data.activeOn);
  if (parsed.data.sort === 'validTo') {
    items.sort((a, b) => a.validTo.localeCompare(b.validTo) || a.name.localeCompare(b.name));
  }
  return { items, total: items.length, filters: parsed.data };
});

const port = Number(process.env.API_PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
