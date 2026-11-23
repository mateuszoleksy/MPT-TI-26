import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, type TestContext } from 'vitest';
import { readSavedConditions, runConditionsBatch, selectPending } from './conditions-batch.js';
import type { Store } from '@promo/shared';

async function setup(t: TestContext) {
  const parent = join(process.cwd(), '.cache', 'tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'mpt26-batch-test-'));
  assert.ok(directory.startsWith(parent));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'state.json');
  let price = 249;
  let clock = Date.UTC(2026, 10, 11, 12);
  const calls: string[][] = [];
  const list = async (store: Store) => [
    {
      id: '123',
      url: `https://blix.pl/sklep/${store}/gazetka/123/`,
      title: 'test',
      validFrom: '2026-11-09',
      validTo: '2026-11-14',
      active: true,
    },
  ];
  const fetch = async (_url: string) => {
    const rows = [0, 1].map((index) => ({
      name: `Product ${index}`,
      price,
      leafletId: 123,
      pageNumber: 0,
      productLeafletPageUuid: `p${index}`,
      dateStart: { date: '2026-11-09 00:00:00.000000', timezone: 'Europe/Warsaw' },
      dateEnd: { date: '2026-11-14 23:59:59.000000', timezone: 'Europe/Warsaw' },
      area: {
        topLeftCorner: { x: 0, y: index * 0.5 },
        bottomRightCorner: { x: 1, y: (index + 1) * 0.5 },
      },
    }));
    return `<script>window.offers = ${JSON.stringify(rows)};
window.leaflet = ${JSON.stringify({ pages: [{ page: 0, leaflet_id: 123, image_url: 'https://imgproxy.blix.pl/test/$$$BUCKET$$$.$$$EXT$$$?bucket=3000' }] })};</script>`;
  };
  const ocr = async (items: { id: string; sourceUrl: string }[]) => {
    calls.push(items.map((item) => item.id));
    return items.map((item) => ({
      ...item,
      lines: [{ text: '30% taniej przy zakupie 2', confidence: 0.99 }],
    }));
  };
  return {
    stateFile,
    calls,
    setPrice: (value: number) => {
      price = value;
    },
    advance: () => {
      clock += 7 * 60 * 60 * 1000;
    },
    dependencies: { list, fetch, ocr, pause: async () => {}, now: () => clock },
  };
}

test('reprocesses saved prices and quantities without OCR or state changes', async (t) => {
  const context = await setup(t);
  await runConditionsBatch(
    { stores: ['lidl'], budget: 2, stateFile: context.stateFile },
    {
      ...context.dependencies,
      ocr: async (items) =>
        items.map((item) => ({
          ...item,
          lines: [{ text: '200g Cena poza promocja: 4,99/opak', confidence: 0.99 }],
          ocrLines: [
            {
              text: '200g Cena poza promocja: 4,99/opak',
              confidence: 0.99,
              box: [
                [0, 0],
                [20, 0],
                [20, 10],
                [0, 10],
              ],
            },
          ],
        })),
    },
  );
  const before = await readFile(context.stateFile, 'utf8');
  assert.equal(
    Object.values(JSON.parse(before).entries as Record<string, { ocr: { ocrLines: unknown[] } }>)[0]
      .ocr.ocrLines.length,
    1,
  );
  const result = await readSavedConditions(context.stateFile, context.dependencies.now());
  assert.equal(result.summary.withQuantity, 2);
  assert.equal(result.summary.withRegularPrice, 2);
  assert.equal(result.summary.sourceRequests, 0);
  assert.equal(result.summary.ocrInferences, 0);
  assert.equal(result.candidates[0].unitQuantity, 0.2);
  assert.equal(result.candidates[0].priceRegular, 4.99);
  assert.equal(await readFile(context.stateFile, 'utf8'), before);
  context.advance();
  const expired = await readSavedConditions(context.stateFile, context.dependencies.now());
  assert.equal(expired.summary.withRegularPrice, 2);
  assert.equal(expired.summary.ocrStale, 0);
  assert.equal(expired.summary.recheckDue, 2);
  assert.equal(expired.summary.stale, 0);
  assert.equal(await readFile(context.stateFile, 'utf8'), before);
  await writeFile(context.stateFile + '.lock', 'busy');
  await assert.rejects(readSavedConditions(context.stateFile));
});

test('covers both stores and resumes without repeating OCR', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl', 'biedronka'] as Store[], budget: 2, stateFile: env.stateFile };
  const first = await runConditionsBatch(options, env.dependencies);
  assert.equal(first.summary.candidates, 4);
  assert.equal(first.summary.pending, 2);
  assert.ok(env.calls[0][0].includes(':lidl:'));
  assert.ok(env.calls[0][1].includes(':biedronka:'));
  const second = await runConditionsBatch(options, env.dependencies);
  assert.equal(second.summary.pending, 0);
  assert.equal(second.summary.ocrCached, 2);
  const third = await runConditionsBatch(options, env.dependencies);
  assert.equal(third.summary.ocrProcessed, 0);
  assert.equal(third.summary.ocrCached, 4);
  assert.equal(env.calls.length, 2);
});

test('invalidates changed offers and expired cache entries', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  await runConditionsBatch(options, env.dependencies);
  env.setPrice(299);
  assert.equal((await runConditionsBatch(options, env.dependencies)).summary.ocrProcessed, 2);
  env.advance();
  assert.equal((await runConditionsBatch(options, env.dependencies)).summary.ocrProcessed, 2);
});

test('does not reuse OCR after the source record changes while keeping aged unchanged evidence', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  await runConditionsBatch(options, env.dependencies);
  env.advance();
  const aged = await readSavedConditions(env.stateFile, env.dependencies.now());
  assert.ok(aged.candidates.every((row) => row.promotion.multiBuy.value !== null));
  assert.equal(aged.summary.recheckDue, 2);
  env.setPrice(299);
  const changed = await runConditionsBatch({ ...options, budget: 0 }, env.dependencies);
  assert.ok(changed.candidates.every((row) => row.promotion.multiBuy.value === null));
});

test('preserves previous data when one store is unavailable', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl', 'biedronka'] as Store[], budget: 4, stateFile: env.stateFile };
  await runConditionsBatch(options, env.dependencies);
  const result = await runConditionsBatch(options, {
    ...env.dependencies,
    list: async (store) => {
      if (store === 'biedronka') throw new Error('offline');
      return env.dependencies.list(store);
    },
  });
  assert.equal(result.summary.candidates, 4);
  assert.equal(result.summary.stale, 2);
  assert.equal(result.summary.complete, false);
  assert.equal(result.candidates.filter((row) => row.stale).length, 2);
  const offline = await readSavedConditions(env.stateFile, env.dependencies.now());
  assert.equal(offline.summary.stale, 2);
});

test('does not replace state on total source failure', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  await runConditionsBatch(options, env.dependencies);
  const previous = await readFile(env.stateFile, 'utf8');
  await assert.rejects(
    runConditionsBatch(options, {
      ...env.dependencies,
      fetch: async () => {
        throw new Error('offline');
      },
    }),
    /previous state preserved/,
  );
  assert.equal(await readFile(env.stateFile, 'utf8'), previous);
});

test('saves discovery progress when OCR fails', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  const first = await runConditionsBatch(options, {
    ...env.dependencies,
    ocr: async () => {
      throw new Error('OCR unavailable');
    },
  });
  assert.equal(first.summary.pending, 2);
  assert.equal(first.summary.failures, 1);
  assert.equal((await runConditionsBatch(options, env.dependencies)).summary.pending, 0);
});

test('preserves complete OCR and retries when full-page OCR fails', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  const first = await runConditionsBatch(options, {
    ...env.dependencies,
    ocr: async (regions) =>
      (await env.dependencies.ocr(regions)).map((row) => ({ ...row, pageChecked: true })),
  });
  const initial = first.candidates[0]!;
  assert.notEqual(initial.promotion.multiBuy.value, null);

  const partial = {
    ...env.dependencies,
    ocr: async (regions: Parameters<typeof env.dependencies.ocr>[0]) =>
      regions.map((row) => ({ ...row, lines: [], pageChecked: false })),
  };
  env.advance();
  const refresh = await runConditionsBatch(options, partial);
  assert.equal(refresh.summary.complete, false);
  assert.equal(refresh.summary.failures, 2);
  assert.ok(refresh.failures.every((failure) => failure.message === 'Full-page OCR failed'));
  assert.equal(refresh.summary.pending, 2);
  assert.equal(refresh.summary.ocrProcessed, 0);
  assert.deepEqual(refresh.candidates[0]?.promotion, initial.promotion);
  assert.equal(refresh.candidates[0]?.checkedAt, initial.checkedAt);
  const saved = await readSavedConditions(env.stateFile, env.dependencies.now());
  assert.deepEqual(saved.candidates[0]?.promotion, initial.promotion);
  assert.equal(saved.candidates[0]?.checkedAt, initial.checkedAt);

  env.setPrice(299);
  const fresh = await runConditionsBatch(options, partial);
  assert.equal(fresh.summary.failures, 2);
  assert.equal(fresh.summary.pending, 2);
  assert.ok(fresh.candidates.every((row) => row.checkedAt === null));

  const recovered = await runConditionsBatch(options, env.dependencies);
  assert.equal(recovered.summary.complete, true);
  assert.equal(recovered.summary.pending, 0);
  assert.ok(recovered.candidates.every((row) => row.checkedAt === env.dependencies.now()));
});

test('rejects corrupted state without overwriting it', async (t) => {
  const env = await setup(t);
  await writeFile(env.stateFile, 'broken');
  await assert.rejects(
    runConditionsBatch({ stores: ['lidl'], budget: 2, stateFile: env.stateFile }, env.dependencies),
  );
  assert.equal(await readFile(env.stateFile, 'utf8'), 'broken');
});

test('prevents overlapping state writers', async (t) => {
  const env = await setup(t);
  await writeFile(env.stateFile + '.lock', '');
  await assert.rejects(
    runConditionsBatch({ stores: ['lidl'], budget: 2, stateFile: env.stateFile }, env.dependencies),
    { code: 'EEXIST' },
  );
});

test('prioritizes unread regions over expired results', () => {
  const old = {
    candidate: { id: 'old', validTo: '2026-11-14', validFrom: '2026-11-09' },
    region: {},
    ocr: { lines: [] },
    checkedAt: 1,
  };
  const unread = {
    candidate: { id: 'new', validTo: '2026-11-14', validFrom: '2026-11-09' },
    region: {},
  };
  assert.equal(
    selectPending([[old], [unread]] as never, 1, Date.UTC(2026, 10, 11))[0].candidate.id,
    'new',
  );
});

test('does not let a failed region block the remaining work', async (t) => {
  const env = await setup(t);
  const options = { stores: ['lidl'] as Store[], budget: 1, stateFile: env.stateFile };
  await runConditionsBatch(options, {
    ...env.dependencies,
    ocr: async () => {
      throw new Error('bad image');
    },
  });
  const result = await runConditionsBatch(options, env.dependencies);
  assert.ok(env.calls[0][0].endsWith(':p1'));
  assert.equal(result.summary.ocrProcessed, 1);
});

test('drains the queue in one invocation', async (t) => {
  const env = await setup(t);
  const result = await runConditionsBatch(
    {
      stores: ['lidl', 'biedronka'],
      budget: 1,
      drain: true,
      maxBatches: 10,
      stateFile: env.stateFile,
    },
    env.dependencies,
  );
  assert.equal(result.summary.ocrProcessed, 4);
  assert.equal(result.summary.pending, 0);
});

test('stops draining at the configured work limit', async (t) => {
  const env = await setup(t);
  const result = await runConditionsBatch(
    {
      stores: ['lidl', 'biedronka'],
      budget: 1,
      drain: true,
      maxBatches: 2,
      stateFile: env.stateFile,
    },
    env.dependencies,
  );
  assert.equal(result.summary.ocrProcessed, 2);
  assert.equal(result.summary.pending, 2);
});

test('stops draining at the time limit', async (t) => {
  const env = await setup(t);
  let calls = 0;
  const result = await runConditionsBatch(
    { stores: ['lidl'], budget: 1, drain: true, maxRuntimeMs: 1000, stateFile: env.stateFile },
    {
      ...env.dependencies,
      now: () => (calls++ ? Date.UTC(2026, 10, 11, 12) + 2000 : Date.UTC(2026, 10, 11, 12)),
    },
  );
  assert.equal(result.summary.stoppedByTime, true);
  assert.equal(result.summary.ocrProcessed, 0);
});

test('publishes discovered products before OCR and updates completed chunks', async (t) => {
  const env = await setup(t);
  const published: { count: number; detected: number }[] = [];
  const result = await runConditionsBatch(
    {
      stores: ['lidl'],
      budget: 2,
      stateFile: env.stateFile,
      onCandidates: async (rows) => {
        published.push({
          count: rows.length,
          detected: rows.filter((row) => row.promotion.multiBuy.value !== null).length,
        });
      },
    },
    env.dependencies,
  );
  assert.deepEqual(published, [
    { count: 2, detected: 0 },
    { count: 2, detected: 2 },
  ]);
  assert.equal(result.summary.pending, 0);
});

test('keeps OCR progress when publishing a chunk fails', async (t) => {
  const env = await setup(t);
  let calls = 0;
  const options = {
    stores: ['lidl'] as Store[],
    budget: 2,
    stateFile: env.stateFile,
    onCandidates: async () => {
      if (++calls === 2) throw new Error('database offline');
    },
  };
  await assert.rejects(runConditionsBatch(options, env.dependencies), /database offline/);
  const resumed = await runConditionsBatch(
    { ...options, onCandidates: undefined },
    env.dependencies,
  );
  assert.equal(resumed.summary.ocrProcessed, 0);
  assert.equal(resumed.summary.ocrCached, 2);
});

test('does not spend OCR on expired product occurrences', () => {
  const expired = {
    candidate: { id: 'expired', validFrom: '2026-11-09', validTo: '2026-11-10' },
    region: {},
  };
  const current = {
    candidate: { id: 'current', validFrom: '2026-11-09', validTo: '2026-11-14' },
    region: {},
  };
  assert.deepEqual(
    selectPending([[expired, current]] as never, 10, Date.UTC(2026, 10, 11)).map(
      (row) => row.candidate.id,
    ),
    ['current'],
  );
});

test('discovers a new leaflet, resumes its queue and invalidates changed image URLs', async (t) => {
  const env = await setup(t);
  let includeNew = false;
  let changedImage = false;
  const dependencies = {
    ...env.dependencies,
    list: async (store: Store) => {
      const rows = await env.dependencies.list(store);
      return includeNew
        ? [...rows, { ...rows[0], id: '456', url: rows[0].url.replace('/123/', '/456/') }]
        : rows;
    },
    fetch: async (url: string) => {
      let html = await env.dependencies.fetch(url);
      if (url.includes('/456/')) html = html.replaceAll('123', '456');
      return changedImage ? html.replace('/test/', '/changed/') : html;
    },
  };
  const options = { stores: ['lidl'] as Store[], budget: 2, stateFile: env.stateFile };
  const first = await runConditionsBatch(options, dependencies);
  assert.equal(first.summary.pending, 0);
  includeNew = true;
  const second = await runConditionsBatch({ ...options, budget: 1 }, dependencies);
  assert.equal(second.summary.candidates, 4);
  assert.equal(second.summary.ocrProcessed, 1);
  assert.equal(second.summary.ocrCached, 2);
  assert.equal(second.summary.pending, 1);
  assert.ok(env.calls[1].every((id) => id.includes(':456:')));
  const third = await runConditionsBatch(options, dependencies);
  assert.equal(third.summary.ocrProcessed, 1);
  assert.equal(third.summary.pending, 0);
  changedImage = true;
  const fourth = await runConditionsBatch({ ...options, budget: 4 }, dependencies);
  assert.equal(fourth.summary.ocrProcessed, 4);
  assert.equal(fourth.summary.pending, 0);
});

test('finishes saving the active OCR batch when the scheduled worker stops', async (t) => {
  const context = await setup(t);
  const controller = new AbortController();
  const options = {
    stores: ['lidl'] as const,
    budget: 2,
    stateFile: context.stateFile,
  };
  const first = await runConditionsBatch(
    { ...options, stores: [...options.stores], signal: controller.signal },
    {
      ...context.dependencies,
      ocr: async (items) => {
        controller.abort();
        return context.dependencies.ocr(items);
      },
    },
  );
  assert.equal(first.summary.ocrProcessed, 2);
  assert.equal(first.summary.complete, false);

  const resumed = await runConditionsBatch(
    { ...options, stores: [...options.stores] },
    context.dependencies,
  );
  assert.equal(resumed.summary.ocrProcessed, 0);
  assert.equal(resumed.summary.ocrCached, 2);
});
