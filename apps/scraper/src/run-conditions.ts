import { checkDatabase, connectDatabase, saveSourceOffers } from '@promo/shared/db';
import { runConditionsBatch } from './conditions-batch.js';

export async function runAndPersist(options: Parameters<typeof runConditionsBatch>[0]) {
  const database = connectDatabase();
  try {
    await checkDatabase(database.db);
    const result = await runConditionsBatch({
      ...options,
      onCandidates: async (rows) => {
        await saveSourceOffers(database.db, rows);
      },
    });
    if (!options.signal?.aborted) {
      await saveSourceOffers(database.db, [], {
        failures: result.failures,
        pending: result.summary.pending,
        saved: result.candidates.length,
      });
    }
    return result;
  } finally {
    await database.close();
  }
}
