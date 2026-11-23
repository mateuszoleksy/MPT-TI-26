import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OcrRegion } from './adapters/blix-conditions.js';
import { validatedOcrLines } from './adapters/price-layout.js';
import { matchBundleConditions, readPageBundles } from './adapters/bundle-conditions.js';
import type { ConditionEvidence } from './adapters/promotion-conditions.js';

export interface OcrResult {
  id: string;
  sourceUrl: string;
  lines: (Pick<ConditionEvidence, 'text' | 'scope'> & { confidence: number })[];
  error?: string;
  imageSha256?: string;
  bbox?: number[];
  ocrLines?: unknown[];
  pageCached?: boolean;
  ocrCached?: boolean;
  seconds?: number;
  pageChecked?: boolean;
  reuseVersion?: string;
  stateReused?: boolean;
}

type RegionRequest = OcrRegion & { reuseImageSha256?: string };
type ReadRegions = (items: RegionRequest[], pages: OcrRegion[]) => Promise<OcrResult[]>;

function reuseVersion() {
  // Bump when OCR models, crop extraction, or page-condition rules change.
  return `rapidocr-1.4.4:page-context-v1:${process.env.OCR_PAGE_MAX_SIDE ?? '0'}`;
}

export function createOcrSession(cacheDirectory: string) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let pending:
    | {
        resolve: (results: OcrResult[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let closed = false;

  function finish(worker: ChildProcessWithoutNullStreams, error: Error) {
    if (child !== worker) return;
    child = undefined;
    worker.kill();
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  }

  function start() {
    const worker = spawn(
      process.env.PYTHON ?? 'python',
      [fileURLToPath(new URL('../scripts/promotion_ocr.py', import.meta.url)), '--worker'],
      { windowsHide: true },
    );
    child = worker;
    let output = '';
    let stderr = '';
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stdout.on('data', (chunk: string) => {
      if (child !== worker) return;
      output += chunk;
      if (Buffer.byteLength(output) > 20_000_000) {
        finish(worker, new Error('OCR response exceeded 20 MB'));
        return;
      }
      if (!output.endsWith('\n')) return;
      if (!pending) {
        finish(worker, new Error('Unexpected OCR response'));
        return;
      }
      try {
        const result = JSON.parse(output);
        if (!Array.isArray(result)) throw new Error('Expected OCR results');
        clearTimeout(pending.timer);
        pending.resolve(result);
        pending = undefined;
        output = '';
      } catch {
        finish(worker, new Error('Invalid OCR response'));
      }
    });
    worker.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    worker.on('error', (error) => finish(worker, error));
    worker.stdin.on('error', (error) => finish(worker, error));
    worker.on('close', (code) => {
      finish(
        worker,
        new Error(`OCR failed (${code}): ${stderr || 'check Python and OCR dependencies'}`),
      );
    });
    return worker;
  }

  const read: ReadRegions = (items, pages) => {
    if (closed || pending) return Promise.reject(new Error('OCR session is unavailable'));
    const worker = child ?? start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(worker, new Error('OCR batch timed out')),
        pages.length ? 600_000 : 300_000,
      );
      pending = { resolve, reject, timer };
      worker.stdin.write(JSON.stringify({ items, pages, cacheDirectory }) + '\n');
    });
  };

  return {
    read: (items: OcrRegion[], previous?: ReadonlyMap<string, OcrResult>) =>
      readImagesWith(items, read, previous),
    close() {
      closed = true;
      if (child) finish(child, new Error('OCR session closed'));
    },
  };
}

const compactOcr = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\p{M}\s]/gu, '');

export function breakfastAddOn(
  crop: OcrResult,
  page: OcrResult | undefined,
  rollPriceInGrosze: number | undefined,
) {
  if (crop.error || page?.error || rollPriceInGrosze === undefined) return undefined;
  const cropLines = validatedOcrLines(crop.ocrLines ?? [], 0.9);
  if (!cropLines.some((line) => compactOcr(line.text).includes('bulkiwpromocji'))) return undefined;
  const pageLines = validatedOcrLines(page?.ocrLines ?? [], 0.9);
  const caption = pageLines.find(
    (line) => line.confidence >= 0.94 && /kup(?:jeden|1)dowolnydodatek/.test(compactOcr(line.text)),
  );
  if (!caption) return undefined;
  const reward = pageLines.some((line) => {
    const match = /odbierz[a-z]{3,8}(\d{1,2})groszy(?:szt|[.!]|$)/.exec(compactOcr(line.text));
    return match && Number(match[1]) === rollPriceInGrosze;
  });
  if (!reward) return undefined;
  return { text: caption.text, confidence: caption.confidence };
}

export async function readImages(
  items: OcrRegion[],
  cacheDirectory = join(tmpdir(), 'mpt26-promotion-ocr'),
): Promise<OcrResult[]> {
  const session = createOcrSession(cacheDirectory);
  try {
    return await session.read(items);
  } finally {
    session.close();
  }
}

async function readImagesWith(
  items: OcrRegion[],
  readRegions: ReadRegions,
  previous?: ReadonlyMap<string, OcrResult>,
): Promise<OcrResult[]> {
  if (!items.length) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const pageRequests = new Map<string, OcrRegion>();
  for (const item of items) {
    if (
      (item.bundleProduct || item.rollPriceInGrosze !== undefined) &&
      !pageRequests.has(item.imageUrl)
    ) {
      pageRequests.set(item.imageUrl, { ...item, id: item.imageUrl, area: [0, 0, 1, 1] });
    }
  }
  const version = reuseVersion();
  const reusable = new Map<string, OcrResult>();
  const requests = items.map((item) => {
    const old = previous?.get(item.id);
    if (
      !old ||
      old.error ||
      old.sourceUrl !== item.sourceUrl ||
      !old.pageChecked ||
      old.reuseVersion !== version ||
      !old.imageSha256 ||
      !/^[a-f0-9]{64}$/.test(old.imageSha256)
    )
      return item;
    reusable.set(item.id, old);
    return { ...item, reuseImageSha256: old.imageSha256 };
  });
  const results = await readRegions(requests, [...pageRequests.values()]);
  const crops = results.slice(0, items.length);
  const pages = new Map(results.slice(items.length).map((page) => [page.id, page]));
  const bundles = new Map([...pages].map(([url, page]) => [url, readPageBundles(page)]));
  return crops.map((crop) => {
    const item = byId.get(crop.id);
    if (!item || crop.error) return crop;
    if (crop.stateReused) {
      const old = reusable.get(crop.id);
      if (old && old.imageSha256 === crop.imageSha256 && old.sourceUrl === crop.sourceUrl)
        return { ...old, stateReused: true };
      return { ...crop, error: 'OCR worker returned an unverified reuse result' };
    }
    const page = pages.get(item.imageUrl);
    const pageChecked =
      !pageRequests.has(item.imageUrl) ||
      Boolean(page && !page.error && page.ocrLines && page.imageSha256 === crop.imageSha256);
    const breakfast = breakfastAddOn(crop, page, item.rollPriceInGrosze);
    const captions = matchBundleConditions(bundles.get(item.imageUrl) ?? [], item.bundleProduct);
    if (breakfast) captions.push(breakfast);
    return {
      ...crop,
      lines: captions.length ? [...crop.lines, ...captions] : crop.lines,
      pageChecked,
      reuseVersion: version,
    };
  });
}
