/**
 * Runtime database client (postgres.js + Drizzle). Works against local Postgres
 * and Neon's pooled connection string (Node runtime on Vercel). `prepare: false`
 * keeps it compatible with transaction-pooled connections.
 *
 * Tests don't use this — they run the schema against an in-process PGlite
 * instance (see test/db.test.ts).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const client = postgres(url, { prepare: false });
  db = drizzle(client, { schema });
  return db;
}
