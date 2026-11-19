import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceOfferSchema, type Store } from '@promo/shared';
import { parseBlixCandidates, todayInWarsaw, type BlixCandidate } from './adapters/blix-parser.js';
import { fetchBlixHtml, listBlixLeaflets } from './adapters/blix.js';
import {
  enrichConditions,
  ocrRegion,
  prepareConditionSource,
  readConditionSources,
  type OcrRegion,
} from './adapters/blix-conditions.js';
import { hasDetectedConditions, type ConditionEvidence } from './adapters/promotion-conditions.js';
import { readImages, type OcrResult } from './condition-ocr.js';

interface Entry {
  candidate: BlixCandidate;
  texts: ConditionEvidence[];
  region: OcrRegion | null;
  fingerprint: string;
  ocr?: OcrResult;
  checkedAt?: number;
  attemptedAt?: number;
  seenAt: number;
  sourceUnavailable?: boolean;
}
interface State {
  version: 1;
  entries: Record<string, Entry>;
}
interface Options {
  stores: Store[];
  budget: number;
  stateFile: string;
  onProgress?: (message: string) => void;
  drain?: boolean;
  maxBatches?: number;
  maxRuntimeMs?: number;
  signal?: AbortSignal;
  onCandidates?: (rows: BatchCandidate[]) => Promise<void>;
}
interface Dependencies {
  list: typeof listBlixLeaflets;
  fetch: typeof fetchBlixHtml;
  ocr: typeof readImages;
  pause: () => Promise<void>;
  now: () => number;
}
const defaults: Dependencies = {
  list: listBlixLeaflets,
  fetch: fetchBlixHtml,
  ocr: readImages,
  pause: () => delay(2000),
  now: Date.now,
};
const freshness = 6 * 60 * 60 * 1000;

export function fingerprint(candidate: BlixCandidate, region: OcrRegion | null) {
  const sourceRegion = region && { ...region };
  // The bundle target is derived from candidate, so it does not change the source fingerprint.
  if (sourceRegion) delete sourceRegion.bundleProduct;
  return createHash('sha256')
    .update(JSON.stringify({ candidate, region: sourceRegion }))
    .digest('hex');
}

export function selectPending(groups: Entry[][], budget: number, now: number) {
  const result: Entry[] = [];
  const today = todayInWarsaw(new Date(now));
  for (const expired of [false, true]) {
    const pending = groups.map((rows) =>
      rows
        .filter(
          (row) =>
            row.region &&
            row.candidate.validTo >= today &&
            (expired
              ? row.ocr && !row.ocr.error && (!row.checkedAt || now - row.checkedAt >= freshness)
              : !row.ocr || !!row.ocr.error),
        )
        .sort(
          (a, b) =>
            (a.attemptedAt ?? 0) - (b.attemptedAt ?? 0) ||
            Number(a.candidate.validFrom > today) - Number(b.candidate.validFrom > today),
        ),
    );
    for (let i = 0; result.length < budget && pending.some((rows) => i < rows.length); i++) {
      for (const rows of pending) if (rows[i] && result.length < budget) result.push(rows[i]);
    }
  }
  return result;
}

function toCandidate(entry: Entry, now: number, isStale: boolean) {
  const usableOcr =
    !!entry.ocr && !entry.ocr.error && Number.isFinite(entry.checkedAt) && entry.checkedAt! > 0;
  const ocrStale = !!entry.ocr && !usableOcr;
  const recheckDue =
    isStale ||
    !!entry.sourceUnavailable ||
    now - entry.seenAt >= freshness ||
    (!!entry.ocr && (!entry.checkedAt || now - entry.checkedAt >= freshness));
  const texts = [...entry.texts];
  if (entry.ocr && usableOcr)
    texts.push(
      ...entry.ocr.lines.map((line) => ({
        ...line,
        origin: 'ocr' as const,
        sourceUrl: entry.candidate.sourceUrl,
      })),
    );
  return {
    ...enrichConditions(entry.candidate, texts, usableOcr ? entry.ocr?.ocrLines : undefined),
    stale: isStale || !!entry.sourceUnavailable,
    recheckDue,
    ocrStale,
    checkedAt: entry.checkedAt ?? null,
  };
}
export type BatchCandidate = ReturnType<typeof toCandidate>;

export async function readSavedConditions(stateFile: string, now = Date.now()) {
  const lockPath = stateFile + '.lock';
  const lock = await open(lockPath, 'wx');
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as State;
    if (
      state.version !== 1 ||
      !state.entries ||
      typeof state.entries !== 'object' ||
      Array.isArray(state.entries)
    )
      throw new Error('Invalid conditions state');
    const candidates = Object.values(state.entries).map((entry) => {
      SourceOfferSchema.parse(entry.candidate);
      if (!Array.isArray(entry.texts) || !Number.isFinite(entry.seenAt))
        throw new Error('Invalid saved candidate');
      if (entry.fingerprint !== fingerprint(entry.candidate, entry.region))
        throw new Error('Saved candidate fingerprint does not match its source');
      return toCandidate(entry, now, !!entry.sourceUnavailable);
    });
    return {
      candidates,
      summary: {
        candidates: candidates.length,
        withQuantity: candidates.filter((row) => row.unitQuantity !== null).length,
        withPieceQuantity: candidates.filter(
          (row) => row.productDetails.pieceQuantity.value !== null,
        ).length,
        withUnitPriceReadings: candidates.filter((row) => row.productDetails.unitPrices.length > 0)
          .length,
        withUnassignedReadings: candidates.filter(
          (row) => row.productDetails.unassignedReadings.length > 0,
        ).length,
        withRegularPrice: candidates.filter((row) => row.priceRegular !== null).length,
        withPreviousPrice: candidates.filter((row) => row.pricePrevious !== null).length,
        withCurrentRegularPrice: candidates.filter(
          (row) => row.productDetails.currentRegularPrice.value !== null,
        ).length,
        withRegularReferencePrice: candidates.filter(
          (row) => row.productDetails.regularPrice.value !== null,
        ).length,
        withLowest30DaysPrice: candidates.filter(
          (row) => row.productDetails.lowest30DaysPrice.value !== null,
        ).length,
        quantityConflicts: candidates.filter(
          (row) => row.productDetails.quantity.status === 'conflict',
        ).length,
        stale: candidates.filter((row) => row.stale).length,
        ocrStale: candidates.filter((row) => row.ocrStale).length,
        recheckDue: candidates.filter((row) => row.recheckDue).length,
        sourceRequests: 0,
        ocrInferences: 0,
      },
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function save(stateFile: string, state: State) {
  const temporary = stateFile + '.tmp';
  await writeFile(temporary, JSON.stringify(state), 'utf8');
  await rename(temporary, stateFile);
}

export async function runConditionsBatch(options: Options, overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const now = deps.now();
  await mkdir(dirname(options.stateFile), { recursive: true });
  const lockPath = options.stateFile + '.lock';
  const lock = await open(lockPath, 'wx');
  const releaseOnExit = () => {
    try {
      unlinkSync(lockPath);
    } catch {}
  };
  process.once('exit', releaseOnExit);
  try {
    let state: State = { version: 1, entries: {} };
    try {
      state = JSON.parse(await readFile(options.stateFile, 'utf8'));
      if (
        state.version !== 1 ||
        !state.entries ||
        typeof state.entries !== 'object' ||
        Array.isArray(state.entries)
      )
        throw new Error('Invalid conditions state');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const failures: { sourceUrl: string; message: string }[] = [];
    const groups: Entry[][] = [];
    const stale = new Set<string>();
    const inspectedLeaflets: string[] = [];
    const preserve = (store: Store, leafletId?: string) => {
      const rows = Object.values(state.entries).filter(
        (row) =>
          row.candidate.store === store && (!leafletId || row.candidate.leafletId === leafletId),
      );
      rows.forEach((row) => {
        stale.add(row.candidate.id);
        row.sourceUnavailable = true;
      });
      if (rows.length) groups.push(rows);
    };
    let advertised = 0;
    let fetched = 0;
    for (const store of options.stores) {
      if (options.signal?.aborted) break;
      let leaflets: Awaited<ReturnType<typeof listBlixLeaflets>>;
      try {
        leaflets = (await deps.list(store)).filter((row) => row.active);
        if (!leaflets.length || leaflets.length > 50)
          throw new Error('Unexpected active leaflet count');
      } catch (error) {
        failures.push({ sourceUrl: `https://blix.pl/sklep/${store}/`, message: String(error) });
        preserve(store);
        continue;
      }
      advertised += leaflets.length;
      for (const leaflet of leaflets) {
        if (options.signal?.aborted) break;
        try {
          if (fetched++) await deps.pause();
          if (options.signal?.aborted) break;
          options.onProgress?.(`Fetching ${leaflet.url}`);
          const html = await deps.fetch(leaflet.url);
          const parsed = parseBlixCandidates(html, leaflet.url);
          inspectedLeaflets.push(leaflet.url);
          if (!parsed.candidates.length)
            throw new Error(`No priced candidates (${parsed.rejected.length} rejected records)`);
          const source = prepareConditionSource(html);
          const rows = parsed.candidates.map((candidate) => {
            let region: OcrRegion | null = null;
            try {
              region = ocrRegion(html, candidate, source);
            } catch (error) {
              failures.push({ sourceUrl: candidate.sourceUrl, message: String(error) });
            }
            const key = fingerprint(candidate, region);
            const previous = state.entries[candidate.id];
            const entry: Entry = {
              candidate,
              region,
              fingerprint: key,
              seenAt: now,
              texts: readConditionSources(html, candidate, source),
              ...(previous?.fingerprint === key
                ? {
                    ocr: previous.ocr,
                    checkedAt: previous.checkedAt,
                    attemptedAt: previous.attemptedAt,
                  }
                : {}),
            };
            state.entries[candidate.id] = entry;
            return entry;
          });
          groups.push(rows);
        } catch (error) {
          failures.push({ sourceUrl: leaflet.url, message: String(error) });
          preserve(store, leaflet.id);
        }
      }
    }
    if (!inspectedLeaflets.length && !options.signal?.aborted)
      throw new Error(`No leaflets fetched; previous state preserved: ${JSON.stringify(failures)}`);
    await save(options.stateFile, state);
    const discovered = [...new Map(groups.flat().map((row) => [row.candidate.id, row])).values()];
    await options.onCandidates?.(
      discovered.map((entry) => toCandidate(entry, deps.now(), stale.has(entry.candidate.id))),
    );
    const jobs = selectPending(
      groups.map((rows) => rows.filter((row) => !stale.has(row.candidate.id))),
      options.budget * (options.drain ? (options.maxBatches ?? 200) : 1),
      now,
    );
    let processed = 0;
    let textReused = 0;
    let stoppedByTime = false;
    for (let i = 0; i < jobs.length; i += 8) {
      if (options.signal?.aborted) break;
      if (deps.now() - now >= (options.maxRuntimeMs ?? 4 * 60 * 60 * 1000)) {
        stoppedByTime = true;
        break;
      }
      const batch = jobs.slice(i, i + 8);
      options.onProgress?.(`OCR ${i + 1}-${i + batch.length}/${jobs.length}`);
      batch.forEach((entry) => {
        entry.attemptedAt = deps.now();
      });
      try {
        const results = await deps.ocr(
          batch.map((row) => row.region!),
          resolve(dirname(options.stateFile), 'ocr'),
        );
        for (const entry of batch) {
          const result = results.find(
            (row) => row.id === entry.candidate.id && row.sourceUrl === entry.candidate.sourceUrl,
          );
          if (!result || result.error) {
            failures.push({
              sourceUrl: entry.candidate.sourceUrl,
              message: result?.error ?? 'Missing OCR result',
            });
            continue;
          }
          entry.ocr = result;
          entry.checkedAt = deps.now();
          processed++;
          if (result.ocrCached) textReused++;
        }
      } catch (error) {
        failures.push({ sourceUrl: 'ocr', message: String(error) });
      }
      await save(options.stateFile, state);
      await options.onCandidates?.(
        batch.map((entry) => toCandidate(entry, deps.now(), stale.has(entry.candidate.id))),
      );
    }
    const entries = [...new Map(groups.flat().map((row) => [row.candidate.id, row])).values()];
    const candidates = entries.map((entry) =>
      toCandidate(entry, deps.now(), stale.has(entry.candidate.id)),
    );
    const pending = selectPending(
      groups.map((rows) => rows.filter((row) => !stale.has(row.candidate.id))),
      Number.MAX_SAFE_INTEGER,
      now,
    ).length;
    const snapshotDate = todayInWarsaw(new Date(deps.now()));
    const summary = {
      advertisedLeaflets: advertised,
      inspectedLeaflets,
      candidates: candidates.length,
      ocrProcessed: processed,
      ocrInferences: processed - textReused,
      ocrTextReused: textReused,
      ocrCached:
        entries.filter(
          (row) =>
            !stale.has(row.candidate.id) &&
            row.ocr &&
            row.checkedAt &&
            now - row.checkedAt < freshness,
        ).length - processed,
      pending,
      expiredSkipped: entries.filter((entry) => entry.candidate.validTo < snapshotDate).length,
      missingRegions: entries.filter((row) => !row.region).length,
      withDetectedConditions: candidates.filter((row) => hasDetectedConditions(row.promotion))
        .length,
      entirelyUnknown: candidates.filter((row) => !hasDetectedConditions(row.promotion)).length,
      withUnknownFields: candidates.filter((row) => row.promotion.unknownFields.length > 0).length,
      confirmed: 0,
      requiresReview: candidates.length,
      stale: stale.size,
      failures: failures.length,
      stoppedByTime,
      complete: !options.signal?.aborted && !pending && !failures.length && !stale.size,
    };
    return { summary, candidates, failures };
  } finally {
    await lock.close();
    process.removeListener('exit', releaseOnExit);
    await unlink(lockPath);
  }
}
