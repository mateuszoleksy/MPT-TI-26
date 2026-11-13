import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from './app.js';

test('validates filters before reading the database', async () => {
  let calls = 0;
  const app = await buildApp(async (filters) => {
    calls++;
    return { items: [], total: 0, filters };
  }, false);
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
  const app = await buildApp(async () => {
    throw new Error('Database unavailable');
  }, false);
  try {
    assert.equal((await app.inject('/api/offers')).statusCode, 500);
  } finally {
    await app.close();
  }
});
