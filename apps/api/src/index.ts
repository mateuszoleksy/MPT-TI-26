import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OfferFiltersSchema, type Offer } from '@promo/shared';
import { applyPromotionDateFilter } from './promotionFilter.js';

const app = Fastify({ logger: true });
await app.register(cors);

app.get('/api/health', async () => ({ status: 'ok' }));

// TODO: replace the in-memory sample with a PostgreSQL query (see docs/architecture.md)
const sample: Offer[] = [
  {
    id: 'sample-1',
    store: 'biedronka',
    name: 'Makaron spaghetti 500 g',
    category: 'makaron',
    priceRegular: 4.99,
    pricePromo: 2.99,
    unit: 'kg',
    unitQuantity: 0.5,
    conditions: null,
    requiresApp: false,
    imageUrl: null,
    sourceUrl: 'https://www.biedronka.pl/',
    validFrom: '2026-10-20',
    validTo: '2026-10-26',
  },
];

app.get('/api/offers', async (req, reply) => {
  const parsed = OfferFiltersSchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
  const items = applyPromotionDateFilter(sample, parsed.data.activeOn);
  return { items, total: items.length, filters: parsed.data };
});

const port = Number(process.env.API_PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
