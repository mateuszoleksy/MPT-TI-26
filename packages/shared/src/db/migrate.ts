import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDatabase } from './index.js';

const database = connectDatabase();
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  console.info('Database migrations applied');
} finally {
  await database.close();
}
