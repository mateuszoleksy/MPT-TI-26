import cron from 'node-cron';
import { OfferSchema, StoreSchema } from '@promo/shared';
import { biedronkaAdapter } from './adapters/biedronka.js';
import { fetchCurrentBlixCandidates } from './adapters/blix.js';
import { lidlAdapter } from './adapters/lidl.js';

const adapters = [biedronkaAdapter, lidlAdapter];

/** Returns false when any store failed, so `--once` can exit non-zero. */
async function runAll(): Promise<boolean> {
  let ok = true;
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
      ok = false;
      console.error(`[${adapter.store}] scrape failed`, err);
    }
  }
  for (const store of StoreSchema.options) {
    const started = Date.now();
    try {
      const batch = await fetchCurrentBlixCandidates(store);
      // TODO: store candidates once the database layer exists; they still need review
      console.log(
        `[blix:${store}] ${batch.candidates.length} candidates from ${batch.results.length}/${batch.leaflets.length} leaflets in ${Date.now() - started} ms`,
      );
      for (const failure of batch.failures) {
        ok = false;
        console.error(`[blix:${store}] leaflet ${failure.leafletId} failed: ${failure.message}`);
      }
    } catch (err) {
      ok = false;
      console.error(`[blix:${store}] scrape failed`, err);
    }
  }
  return ok;
}

if (process.argv.includes('--once')) {
  if (!(await runAll())) process.exitCode = 1;
} else {
  const schedule = process.env.SCRAPE_CRON ?? '0 6 * * *';
  const timezone = process.env.SCRAPE_TZ ?? 'Europe/Warsaw';
  if (!cron.validate(schedule)) throw new Error(`Invalid SCRAPE_CRON: "${schedule}"`);
  const task = cron.schedule(schedule, runAll, { name: 'scrape', timezone, noOverlap: true });
  console.info(
    `Scraper scheduled: "${schedule}" (${timezone}), next run ${task.getNextRun()?.toISOString()}`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, async () => {
      console.info(`${signal} received, stopping scheduler`);
      await cron.shutdown();
      process.exit(0);
    });
}
