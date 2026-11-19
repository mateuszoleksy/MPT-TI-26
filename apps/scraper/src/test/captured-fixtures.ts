import { readFileSync } from 'node:fs';
import { enrichConditions } from '../adapters/blix-conditions.js';
import type { BlixCandidate } from '../adapters/blix-parser.js';
import type { ConditionEvidence } from '../adapters/promotion-conditions.js';
import type { OcrResult } from '../condition-ocr.js';

type Entry = {
  candidate: BlixCandidate;
  texts: ConditionEvidence[];
  ocr: Omit<OcrResult, 'ocrLines'> & {
    ocrLines: { text: string; confidence: number; box: number[][] }[];
  };
};
interface Catalog {
  captures: Record<string, OcrResult>;
  offers: Record<string, { candidate: BlixCandidate; texts: ConditionEvidence[]; capture: string }>;
  groups: Record<string, string[]>;
}
const data = JSON.parse(
  readFileSync(new URL('../adapters/__fixtures__/captured-offers.json', import.meta.url), 'utf8'),
) as Catalog;
function entry(id: string): Entry {
  const offer = data.offers[id];
  if (!offer || !data.captures[offer.capture]) throw new Error('Missing captured offer: ' + id);
  return {
    candidate: offer.candidate,
    texts: offer.texts,
    ocr: {
      ...data.captures[offer.capture],
      ocrLines: (data.captures[offer.capture].ocrLines ?? []) as {
        text: string;
        confidence: number;
        box: number[][];
      }[],
      id: offer.candidate.id,
      sourceUrl: offer.candidate.sourceUrl,
    },
  };
}
export function readCaptured(group: string): Entry[] {
  if (!data.groups[group]) throw new Error('Unknown captured group: ' + group);
  return data.groups[group].map(entry);
}
export function enrichCaptured(entry: Entry | undefined, raw = entry?.ocr.ocrLines) {
  if (!entry) throw new Error('Missing captured test entry');
  return enrichConditions(
    entry.candidate,
    [
      ...entry.texts,
      ...entry.ocr.lines.map((line) => ({
        ...line,
        origin: 'ocr' as const,
        sourceUrl: entry.candidate.sourceUrl,
      })),
    ],
    raw,
  );
}
