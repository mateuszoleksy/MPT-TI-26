import cron from 'node-cron';
import { StoreSchema } from '@promo/shared';
import { connectDatabase, saveSourceOffers, type Database } from '@promo/shared/db';
import { fetchCurrentBlixCandidates } from './adapters/blix.js';
import { runScrapeCycle, scheduleJob } from './scheduler.js';

/** Returns false when any store failed, so `--once` can exit non-zero. */
async function runAll(database: Database): Promise<boolean> {
  return runScrapeCycle(StoreSchema.options, fetchCurrentBlixCandidates, (offers, details) =>
    saveSourceOffers(database, offers, details),
  );
}

if (process.argv.includes('--once')) {
  const database = connectDatabase();
  try {
    console.info('Uruchamiam jednorazowy przebieg pobierania promocji.');
    if (!(await runAll(database.db))) process.exitCode = 1;
  } finally {
    await database.close();
    console.info('Połączenie z bazą danych zostało zamknięte.');
  }
} else {
  const schedule = process.env.SCRAPE_CRON ?? '0 6 * * *';
  const timezone = process.env.SCRAPE_TZ ?? 'Europe/Warsaw';
  if (!cron.validate(schedule)) throw new Error(`Invalid SCRAPE_CRON: "${schedule}"`);
  const database = connectDatabase();
  const job = scheduleJob(schedule, () => runAll(database.db), {
    name: 'scrape',
    timezone,
    noOverlap: true,
  });
  console.info(
    `Scraper scheduled: "${schedule}" (${timezone}), next run ${job.task.getNextRun()?.toISOString()}`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, async () => {
      console.info(`${signal} received, stopping scheduler`);
      await job.stop();
      await database.close();
      process.exit(0);
    });
}
