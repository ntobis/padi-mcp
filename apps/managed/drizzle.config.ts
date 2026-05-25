import { defineConfig } from 'drizzle-kit';

// drizzle-kit (unlike Next.js) doesn't auto-load .env.local — load it here so
// DATABASE_URL is available to the CLI (db:generate / db:migrate).
const proc = process as unknown as { loadEnvFile?: (path?: string) => void };
for (const file of ['.env.local', '.env']) {
  try {
    proc.loadEnvFile?.(file);
  } catch {
    // file absent — ignore
  }
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
