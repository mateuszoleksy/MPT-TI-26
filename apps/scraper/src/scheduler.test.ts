import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleJob } from './scheduler.js';

test('stop waits for the active run however long it takes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
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
  t.mock.timers.tick(60_000);
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
