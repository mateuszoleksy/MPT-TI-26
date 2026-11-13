import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildApp } from './app.js';

test('validates filters before reading the database', async () => {
  let calls = 0;
  const app = await buildApp(
    async (filters) => {
      calls++;
      return { items: [], total: 0, filters };
    },
    async () => {},
    false,
  );
  try {
    assert.equal((await app.inject('/api/offers?store=unknown')).statusCode, 400);
    assert.equal(calls, 0);
    const response = await app.inject('/api/offers?store=lidl&excludeAppOnly=false&page=2');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().filters.excludeAppOnly, false);
    assert.equal(response.json().filters.page, 2);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test('does not return demo data on database failure', async () => {
  const app = await buildApp(
    async () => {
      throw new Error('Database unavailable');
    },
    async () => {},
    false,
  );
  try {
    assert.equal((await app.inject('/api/offers')).statusCode, 500);
  } finally {
    await app.close();
  }
});

test('healthcheck checks the database and recovers after a failure', async () => {
  let unavailable = false;
  let checks = 0;
  const app = await buildApp(
    async (filters) => ({ items: [], total: 0, filters }),
    async () => {
      checks++;
      if (unavailable) throw new Error('secret connection details');
    },
    false,
  );
  try {
    const healthy = await app.inject('/api/health');
    assert.equal(healthy.statusCode, 200);
    assert.deepEqual(healthy.json(), { status: 'ok' });
    unavailable = true;
    const failed = await app.inject('/api/health');
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { status: 'error' });
    unavailable = false;
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal(checks, 3);
  } finally {
    await app.close();
  }
});
