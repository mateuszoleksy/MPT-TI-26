import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OfferFiltersSchema, type OfferFilters, type SourceOffer } from '@promo/shared';

type ReadOffers = (
  filters: OfferFilters,
) => Promise<{ items: SourceOffer[]; total: number; filters: OfferFilters }>;
export async function buildApp(readOffers: ReadOffers, logger = true) {
  const app = Fastify({ logger });
  await app.register(cors);
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/offers', async (req, reply) => {
    const parsed = OfferFiltersSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    return readOffers(parsed.data);
  });
  return app;
}
