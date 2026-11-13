import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { StoreSchema } from '@promo/shared';
import { blixLeafletUrl, parseBlixCandidates } from './adapters/blix-parser.js';
import {
  fetchBlixCandidates,
  fetchCurrentBlixCandidates,
  listBlixLeaflets,
} from './adapters/blix.js';

async function main() {
  const { values: args } = parseArgs({
    options: {
      store: { type: 'string' },
      leaflet: { type: 'string' },
      file: { type: 'string' },
      list: { type: 'boolean' },
      json: { type: 'boolean' },
      persist: { type: 'boolean' },
    },
  });
  const store = StoreSchema.parse(args.store);
  if (args.list && args.persist) throw new Error('--list cannot be persisted');
  if (args.list && (args.leaflet || args.file))
    throw new Error('--list cannot be combined with --leaflet or --file');
  if (args.file && !args.leaflet) throw new Error('--file requires --leaflet for source identity');
  if (args.list) {
    const leaflets = await listBlixLeaflets(store);
    if (!leaflets.length) throw new Error('No leaflet metadata found');
    if (args.json) console.log(JSON.stringify(leaflets, null, 2));
    else console.table(leaflets);
    return;
  }
  const batch = args.leaflet ? null : await fetchCurrentBlixCandidates(store);
  const results = batch?.results ?? [
    args.file
      ? parseBlixCandidates(await readFile(args.file, 'utf8'), blixLeafletUrl(store, args.leaflet!))
      : await fetchBlixCandidates(store, args.leaflet!),
  ];
  const candidates = results.flatMap((result) => result.candidates);
  const failures = batch?.failures ?? [];
  if (args.persist) {
    const { connectDatabase, saveSourceOffers } = await import('@promo/shared/db');
    const database = connectDatabase();
    try {
      await saveSourceOffers(database.db, candidates, { failures, pending: 0 });
    } finally {
      await database.close();
    }
  }
  if (args.json)
    console.log(
      JSON.stringify(
        {
          input: args.file ? 'saved HTML' : 'live HTTP',
          store,
          onDate: batch?.onDate ?? null,
          leaflets: batch?.leaflets ?? [],
          results,
          failures,
        },
        null,
        2,
      ),
    );
  else {
    console.log(
      `Source: ${args.file ? `saved HTML (${args.file})` : 'live HTTP'}; leaflets: ${results.length}; candidates: ${candidates.length}; failed leaflets: ${failures.length}`,
    );
    if (batch) console.table(batch.leaflets);
    console.log(
      'Review required: prices, terms, units and source dates are not independently confirmed.',
    );
    console.table(
      candidates
        .slice(0, 20)
        .map(({ name, reportedPrice, validFrom, validTo, pageNumber, leafletId }) => ({
          name,
          reportedPrice,
          validFrom,
          validTo,
          pageNumber,
          leafletId,
        })),
    );
    if (candidates.length > 20)
      console.log('Showing the first 20 candidates; use --json for all records.');
    if (failures.length) console.table(failures);
  }
  if (!candidates.length || failures.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message);
  process.exitCode = 1;
});
