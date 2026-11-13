import Fastify from 'fastify';
import cors from '@fastify/cors';
import { OfferFiltersSchema, type OfferFilters, type SourceOffer } from '@promo/shared';

type ReadOffers = (
  filters: OfferFilters,
) => Promise<{ items: SourceOffer[]; total: number; filters: OfferFilters }>;
export async function buildApp(
  readOffers: ReadOffers,
  checkDatabase: () => Promise<void>,
  logger = true,
) {
  const app = Fastify({ logger });
  await app.register(cors);
  app.get('/api/health', async (req, reply) => {
    try {
      await checkDatabase();
      return { status: 'ok' };
    } catch (error) {
      req.log.error({ err: error }, 'Database healthcheck failed');
      return reply.code(503).send({ status: 'error' });
    }
  });
  app.get('/api/offers', async (req, reply) => {
    const parsed = OfferFiltersSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    return readOffers(parsed.data);
  });
  return app;
}
