import { spawn } from 'node:child_process';
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
}

function readCrops(items: OcrRegion[], cacheDirectory: string): Promise<OcrResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON ?? 'python',
      [fileURLToPath(new URL('../scripts/promotion_ocr.py', import.meta.url))],
      { windowsHide: true },
    );
    const timer = setTimeout(() => child.kill(), 300_000);
    let output = '',
      error = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 20_000_000) child.kill();
    });
    child.stderr.on('data', (chunk: string) => {
      error = (error + chunk).slice(-4000);
    });
    child.on('error', (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(
          new Error(`OCR failed (${code}): ${error || 'check Python and OCR dependencies'}`),
        );
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('Invalid OCR response'));
      }
    });
    child.stdin.end(JSON.stringify({ items, cacheDirectory }));
  });
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
  if (!items.length) return [];
  const crops = await readCrops(items, cacheDirectory);
  const byId = new Map(items.map((item) => [item.id, item]));
  const pageRequests = new Map<string, OcrRegion>();
  for (const crop of crops) {
    const item = byId.get(crop.id);
    if (
      item &&
      !crop.error &&
      (item.bundleProduct ||
        (item.rollPriceInGrosze !== undefined &&
          validatedOcrLines(crop.ocrLines ?? [], 0.9).some((line) =>
            compactOcr(line.text).includes('bulkiwpromocji'),
          ))) &&
      !pageRequests.has(item.imageUrl)
    ) {
      pageRequests.set(item.imageUrl, { ...item, id: item.imageUrl, area: [0, 0, 1, 1] });
    }
  }
  if (!pageRequests.size) return crops;
  const pages = new Map(
    (await readCrops([...pageRequests.values()], cacheDirectory)).map((page) => [page.id, page]),
  );
  const bundles = new Map([...pages].map(([url, page]) => [url, readPageBundles(page)]));
  return crops.map((crop) => {
    const item = byId.get(crop.id);
    if (!item || crop.error) return crop;
    const page = pages.get(item.imageUrl);
    const breakfast = breakfastAddOn(crop, page, item.rollPriceInGrosze);
    const captions = matchBundleConditions(bundles.get(item.imageUrl) ?? [], item.bundleProduct);
    if (breakfast) captions.push(breakfast);
    return captions.length ? { ...crop, lines: [...crop.lines, ...captions] } : crop;
  });
}
