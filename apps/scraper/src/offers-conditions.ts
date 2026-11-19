import { fileURLToPath } from 'node:url';
import { readImages, type OcrResult } from './condition-ocr.js';
import { readSavedConditions, runConditionsBatch } from './conditions-batch.js';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { StoreSchema } from '@promo/shared';
import { blixLeafletUrl, parseBlixCandidates } from './adapters/blix-parser.js';
import { fetchBlixHtml, listBlixLeaflets } from './adapters/blix.js';
import {
  enrichConditions,
  ocrRegion,
  readConditionSources,
  type OcrRegion,
} from './adapters/blix-conditions.js';
import { hasDetectedConditions, type ConditionEvidence } from './adapters/promotion-conditions.js';

async function main() {
  const { values: args } = parseArgs({
    options: {
      store: { type: 'string' },
      all: { type: 'boolean' },
      persist: { type: 'boolean' },
      'cached-only': { type: 'boolean' },
      budget: { type: 'string', default: '36' },
      state: {
        type: 'string',
        default: fileURLToPath(new URL('../.cache/blix-conditions.json', import.meta.url)),
      },
      drain: { type: 'boolean' },
      'max-batches': { type: 'string', default: '200' },
      'max-hours': { type: 'string', default: '4' },
      leaflet: { type: 'string' },
      file: { type: 'string' },
      match: { type: 'string' },
      limit: { type: 'string', default: '8' },
      ocr: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (args['cached-only']) {
    if (args.ocr || args.all || args.store || args.file || args.leaflet || args.match || args.drain)
      throw new Error('--cached-only cannot be combined with discovery or OCR options');
    const result = await readSavedConditions(args.state);
    if (args.persist) {
      const { connectDatabase, saveSourceOffers } = await import('@promo/shared/db');
      const database = connectDatabase();
      try {
        await saveSourceOffers(database.db, result.candidates);
      } finally {
        await database.close();
      }
    }
    console.info(JSON.stringify(args.json ? result : result.summary, null, 2));
    return;
  }
  if (args.all) {
    if (args.file || args.leaflet || args.match)
      throw new Error('--all cannot be combined with --file, --leaflet or --match');
    const budget = Number(args.budget);
    if (!Number.isInteger(budget) || budget < 0 || budget > 360)
      throw new Error('--budget must be between 0 and 360');
    const maxBatches = Number(args['max-batches']);
    const maxHours = Number(args['max-hours']);
    if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1000)
      throw new Error('--max-batches must be between 1 and 1000');
    if (!Number.isFinite(maxHours) || maxHours <= 0 || maxHours > 24)
      throw new Error('--max-hours must be between 0 and 24');
    if (args.drain && (!args.ocr || !budget))
      throw new Error('--drain requires --ocr and a positive --budget');
    const stores =
      args.store && args.store !== 'all'
        ? [StoreSchema.parse(args.store)]
        : (['lidl', 'biedronka'] as const);
    const runner = args.persist
      ? (await import('./run-conditions.js')).runAndPersist
      : runConditionsBatch;
    const result = await runner({
      stores: [...stores],
      budget: args.ocr ? budget : 0,
      stateFile: args.state,
      drain: args.drain,
      maxBatches,
      maxRuntimeMs: maxHours * 3600_000,
      onProgress: (message) => console.error(message),
    });
    console.info(JSON.stringify(args.json ? result : result.summary, null, 2));
    process.exitCode = result.failures.length ? 1 : result.summary.pending ? 2 : 0;
    return;
  }
  const store = StoreSchema.parse(args.store);
  const limit = Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 36)
    throw new Error('--limit must be between 1 and 36');
  if (args.file && !args.leaflet) throw new Error('--file requires --leaflet');
  const urls = args.leaflet
    ? [blixLeafletUrl(store, args.leaflet)]
    : (await listBlixLeaflets(store))
        .filter((leaflet) => leaflet.active)
        .map((leaflet) => leaflet.url);
  if (!urls.length) throw new Error('No active leaflets found');
  if (urls.length > 20) throw new Error('Too many active leaflets; inspect the listing');
  const rows: {
    candidate: ReturnType<typeof parseBlixCandidates>['candidates'][number];
    texts: ConditionEvidence[];
  }[] = [];
  const regions: OcrRegion[] = [];
  const failures: { sourceUrl: string; message: string }[] = [];
  const inspectedLeaflets: string[] = [];
  for (const url of urls) {
    if (rows.length >= limit) break;
    try {
      if (inspectedLeaflets.length && !args.file) await delay(2000);
      const html = args.file ? await readFile(args.file, 'utf8') : await fetchBlixHtml(url);
      const result = parseBlixCandidates(html, url);
      inspectedLeaflets.push(url);
      for (const candidate of result.candidates) {
        if (rows.length >= limit) break;
        if (
          args.match &&
          !candidate.name.toLocaleLowerCase('pl-PL').includes(args.match.toLocaleLowerCase('pl-PL'))
        )
          continue;
        rows.push({ candidate, texts: readConditionSources(html, candidate) });
        if (args.ocr) {
          try {
            regions.push(ocrRegion(html, candidate));
          } catch (error) {
            failures.push({ sourceUrl: candidate.sourceUrl, message: String(error) });
          }
        }
      }
    } catch (error) {
      failures.push({ sourceUrl: url, message: String(error) });
    }
  }
  const evidence = new Map<string, OcrResult>();
  try {
    for (const result of await readImages(regions)) evidence.set(result.id, result);
  } catch (error) {
    failures.push({ sourceUrl: 'ocr', message: String(error) });
  }
  const candidates = rows.map(({ candidate, texts }) => {
    const ocr = evidence.get(candidate.id);
    if (ocr?.error) failures.push({ sourceUrl: candidate.sourceUrl, message: ocr.error });
    if (ocr && ocr.sourceUrl === candidate.sourceUrl) {
      for (const line of ocr.lines)
        texts.push({ ...line, origin: 'ocr', sourceUrl: candidate.sourceUrl });
    }
    return { ...enrichConditions(candidate, texts, ocr?.ocrLines), ocrEvidence: ocr ?? null };
  });
  const withDetectedConditions = candidates.filter((row) =>
    hasDetectedConditions(row.promotion),
  ).length;
  const summary = {
    inspectedLeaflets,
    selected: candidates.length,
    limit,
    confirmed: 0,
    withDetectedConditions,
    entirelyUnknown: candidates.length - withDetectedConditions,
    withUnknownFields: candidates.filter((row) => row.promotion.unknownFields.length > 0).length,
    requiresReview: candidates.length,
    failures: failures.length,
  };
  if (args.json) console.info(JSON.stringify({ summary, candidates, failures }, null, 2));
  else {
    console.info(JSON.stringify(summary));
    console.info('Detected conditions require verification; unprocessed offers are not included.');
    if (failures.length) console.table(failures);
  }
  if (!candidates.length || failures.length) process.exitCode = 1;
}

process.once('SIGINT', () => process.exit(130));
process.once('SIGTERM', () => process.exit(143));

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
