import cron from 'node-cron';
import { OfferSchema } from '@promo/shared';
import { biedronkaAdapter } from './adapters/biedronka.js';
import { lidlAdapter } from './adapters/lidl.js';

const adapters = [biedronkaAdapter, lidlAdapter];

async function runAll() {
  for (const adapter of adapters) {
    const started = Date.now();
    try {
      const raw = await adapter.fetchOffers();
      const valid = raw.filter((o) => OfferSchema.safeParse(o).success);
      // TODO: upsert `valid` into PostgreSQL and record a scrape_runs row
      console.info(
        `[${adapter.store}] ${valid.length}/${raw.length} valid offers in ${Date.now() - started} ms`,
      );
    } catch (err) {
      console.error(`[${adapter.store}] scrape failed`, err);
    }
  }
}

if (process.argv.includes('--once')) {
  await runAll();
} else {
  const schedule = process.env.SCRAPE_CRON ?? '0 6 * * *';
  console.info(`Scraper scheduled: "${schedule}"`);
  cron.schedule(schedule, runAll);
}
