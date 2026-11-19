import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { StoreSchema } from '@promo/shared';
import { connectDatabase, saveSourceOffers } from '@promo/shared/db';
import { fetchCurrentBlixCandidates } from './adapters/blix.js';
import { runAndPersist } from './run-conditions.js';
import { runScrapeCycle, scheduleJob } from './scheduler.js';

const useOcr = process.argv.includes('--ocr');
const controller = new AbortController();
const database = useOcr ? undefined : connectDatabase();

async function runAll(): Promise<boolean> {
  if (database) {
    return runScrapeCycle(StoreSchema.options, fetchCurrentBlixCandidates, (offers, details) =>
      saveSourceOffers(database.db, offers, details),
    );
  }

  const result = await runAndPersist({
    stores: [...StoreSchema.options],
    budget: 36,
    drain: true,
    stateFile:
      process.env.OCR_STATE_FILE ??
      fileURLToPath(new URL('../.cache/blix-conditions.json', import.meta.url)),
    signal: controller.signal,
    onProgress: (message) => console.info(message),
  });
  console.info(JSON.stringify(result.summary));
  for (const failure of result.failures) console.error('[ocr] source failed', failure);
  return result.failures.length === 0;
}

if (process.argv.includes('--once')) {
  if (useOcr) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => controller.abort());
    }
  }
  try {
    console.info('Uruchamiam jednorazowy przebieg pobierania promocji.');
    if (!(await runAll())) process.exitCode = 1;
  } finally {
    await database?.close();
  }
} else {
  const schedule = process.env.SCRAPE_CRON ?? '0 6 * * *';
  const timezone = process.env.SCRAPE_TZ ?? 'Europe/Warsaw';
  if (!cron.validate(schedule)) throw new Error(`Invalid SCRAPE_CRON: "${schedule}"`);
  const job = scheduleJob(schedule, runAll, {
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
      controller.abort();
      await job.stop();
      await database?.close();
      process.exit(0);
    });
}
