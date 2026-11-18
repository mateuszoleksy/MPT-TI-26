import cron, { type ScheduledTask, type TaskOptions } from 'node-cron';
import { SourceOfferSchema, type SourceOffer, type Store } from '@promo/shared';

export interface StoreScrapeBatch {
  candidates: unknown[];
  failures: unknown[];
}

export type SaveScrapeResults = (
  offers: SourceOffer[],
  details: { failures: unknown[]; pending: number; saved: number },
) => Promise<unknown>;

/** Runs each store independently and persists only schema-valid source offers. */
export async function runScrapeCycle(
  stores: readonly Store[],
  fetchStore: (store: Store) => Promise<StoreScrapeBatch>,
  save: SaveScrapeResults,
): Promise<boolean> {
  let ok = true;

  for (const store of stores) {
    const started = Date.now();
    console.info(`[blix:${store}] Rozpoczynam pobieranie aktualnych promocji...`);
    try {
      const batch = await fetchStore(store);
      const failures = [...batch.failures];
      const offers: SourceOffer[] = [];

      for (const [index, candidate] of batch.candidates.entries()) {
        const parsed = SourceOfferSchema.safeParse(candidate);
        if (parsed.success) offers.push(parsed.data);
        else failures.push({ store, index, issues: parsed.error.issues });
      }

      console.info(
        `[blix:${store}] Pobrano i sparsowano ${offers.length} poprawnych ofert (${batch.candidates.length} kandydatów). Zapisuję do bazy...`,
      );
      await save(offers, { failures, pending: 0, saved: offers.length });
      console.info(
        `[blix:${store}] Zapisano ${offers.length} ofert do bazy w ${Date.now() - started} ms.`,
      );
      for (const failure of failures) console.error(`[blix:${store}] source failed`, failure);
      if (failures.length) ok = false;
    } catch (error) {
      ok = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[blix:${store}] scrape failed`, error);
      try {
        await save([], { failures: [{ store, message }], pending: 0, saved: 0 });
      } catch (saveError) {
        console.error(`[blix:${store}] failed to record scrape error`, saveError);
      }
    }
  }

  return ok;
}

export interface ScheduledJob {
  task: ScheduledTask;
  stop(): Promise<void>;
}

export function scheduleJob(
  expression: string,
  job: () => Promise<unknown>,
  options?: TaskOptions,
): ScheduledJob {
  let active: Promise<unknown> | undefined;
  const task = cron.schedule(
    expression,
    async () => {
      active = job();
      try {
        return await active;
      } finally {
        active = undefined;
      }
    },
    options,
  );
  return {
    task,
    async stop() {
      await task.stop();
      // Failures are already reported by the run itself.
      await active?.catch(() => {});
      await task.destroy();
    },
  };
}
