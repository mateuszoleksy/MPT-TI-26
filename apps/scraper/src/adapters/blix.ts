import { StoreSchema, type Store } from '@promo/shared';
import { setTimeout } from 'node:timers/promises';
import {
  blixLeafletUrl,
  discoverBlixLeaflets,
  parseBlixCandidates,
  todayInWarsaw,
} from './blix-parser.js';

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'PromoStudentCourse/0.1', 'Accept-Language': 'pl-PL,pl;q=0.9' },
  });
  if (!response.ok) throw new Error(`Blix returned HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html'))
    throw new Error('Expected HTML');
  if (!response.body) throw new Error('Empty response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Blix response exceeds 10 MB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchBlixCandidates(store: Store, leafletId: string) {
  const url = blixLeafletUrl(store, leafletId);
  const result = parseBlixCandidates(await fetchHtml(url), url);
  if (!result.candidates.length)
    throw new Error('No priced candidates; check the leaflet and rejected records');
  return result;
}

export async function listBlixLeaflets(store: Store, onDate = todayInWarsaw()) {
  StoreSchema.parse(store);
  return discoverBlixLeaflets(await fetchHtml(`https://blix.pl/sklep/${store}/`), store, onDate);
}

export async function fetchCurrentBlixCandidates(store: Store, onDate = todayInWarsaw()) {
  const leaflets = (await listBlixLeaflets(store, onDate)).filter((leaflet) => leaflet.active);
  if (!leaflets.length) throw new Error('No dated active leaflets found; check the store listing');
  if (leaflets.length > 20) throw new Error('Too many active leaflets; check the store listing');
  const results = [];
  const failures: { leafletId: string; message: string }[] = [];
  for (const leaflet of leaflets) {
    await setTimeout(2000);
    try {
      results.push(await fetchBlixCandidates(store, leaflet.id));
    } catch (error) {
      failures.push({
        leafletId: leaflet.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!results.length)
    throw new Error(
      `All active leaflets failed: ${failures.map((row) => `${row.leafletId}: ${row.message}`).join('; ')}`,
    );
  return {
    store,
    onDate,
    leaflets,
    results,
    failures,
    candidates: results.flatMap((result) => result.candidates),
  };
}
