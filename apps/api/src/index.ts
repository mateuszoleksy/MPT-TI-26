import { connectDatabase, listSourceOffers } from '@promo/shared/db';
import { buildApp } from './app.js';

const database = connectDatabase();
const app = await buildApp((filters) => listSourceOffers(database.db, filters));
app.addHook('onClose', () => database.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  host: '0.0.0.0',
});
