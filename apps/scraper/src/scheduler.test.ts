import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test, vi } from 'vitest';
import { parseBlixCandidates } from './adapters/blix-parser.js';
import { runScrapeCycle, scheduleJob } from './scheduler.js';

const fixture = JSON.parse(
  readFileSync(new URL('./adapters/__fixtures__/blix-sample.json', import.meta.url), 'utf8'),
) as { offers: unknown[]; sourceUrl: string };
const fixtureCandidates = parseBlixCandidates(
  `<script>window.offers = ${JSON.stringify(fixture.offers)};</script>`,
  fixture.sourceUrl,
).candidates;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('validates and persists fixture candidates while continuing after a store failure', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const attempted: string[] = [];
  const saved: {
    offers: unknown[];
    details: { failures: unknown[]; pending: number; saved: number };
  }[] = [];

  const ok = await runScrapeCycle(
    ['biedronka', 'lidl'],
    async (store) => {
      attempted.push(store);
      if (store === 'lidl') throw new Error('Source unavailable');
      return {
        candidates: [fixtureCandidates[0], { ...fixtureCandidates[1], reportedPrice: -1 }],
        failures: [{ leafletId: '534004', message: 'Leaflet unavailable' }],
      };
    },
    async (offers, details) => {
      saved.push({ offers, details });
      return offers.length;
    },
  );

  assert.equal(ok, false);
  assert.deepEqual(attempted, ['biedronka', 'lidl']);
  assert.equal(saved.length, 2);
  assert.deepEqual(
    saved[0].offers.map((offer) => (offer as { id: string }).id),
    [fixtureCandidates[0].id],
  );
  assert.equal(saved[0].details.saved, 1);
  assert.equal(saved[0].details.failures.length, 2);
  assert.deepEqual(saved[1].offers, []);
  assert.equal(saved[1].details.failures.length, 1);
});

test('stop waits for the active run however long it takes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  let finish!: () => void;
  let finished = false;
  const job = scheduleJob('0 6 * * *', async () => {
    await new Promise<void>((resolve) => (finish = resolve));
    finished = true;
  });
  void job.task.execute();
  await new Promise((resolve) => setImmediate(resolve));

  let stopped = false;
  const stopping = job.stop().then(() => (stopped = true));
  // Past node-cron's 5 s shutdown timeout, which is what used to let the process exit early.
  vi.advanceTimersByTime(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);

  finish();
  await stopping;
  assert.equal(finished, true);
  assert.equal(job.task.getStatus(), 'destroyed');
});

test('stop resolves right away when idle and after a failed run', async () => {
  const job = scheduleJob('0 6 * * *', async () => {
    throw new Error('scrape failed');
  });
  await assert.rejects(job.task.execute(), /scrape failed/);
  await job.stop();
  assert.equal(job.task.getStatus(), 'destroyed');
});
