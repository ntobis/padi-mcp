#!/usr/bin/env tsx
/**
 * Live Phase-3 check WITHOUT Postgres or a password. Seeds an encrypted PADI
 * connection (from your existing dev refresh token) into an in-process PGlite
 * database, then exercises the real managed token path: decrypt -> mint ID
 * token (live Cognito) -> count dives (live PADI).
 *
 *   # uses apps/managed/.env.local: PADI_DEV_REFRESH_TOKEN + PADI_DEV_AFFILIATE_ID
 *   npm run connect-smoke -w @padi-mcp/managed
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countDives } from '@padi-mcp/core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { encryptSecret } from '../lib/crypto/envelope';
import * as schema from '../lib/db/schema';
import { getTenantContext } from '../lib/tokens';

// Best-effort load of apps/managed/.env.local (Next loads it for the app; a
// plain tsx script does not).
try {
  const raw = readFileSync(fileURLToPath(new URL('../.env.local', import.meta.url)), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // no .env.local — rely on the ambient environment
}

async function main(): Promise<void> {
  const refreshToken = process.env.PADI_DEV_REFRESH_TOKEN;
  const affiliateId = process.env.PADI_DEV_AFFILIATE_ID;
  if (!refreshToken || !affiliateId) {
    console.error(
      'Set PADI_DEV_REFRESH_TOKEN and PADI_DEV_AFFILIATE_ID (apps/managed/.env.local) first.',
    );
    process.exit(2);
  }
  if (!process.env.PADI_MASTER_KEY) {
    process.env.PADI_MASTER_KEY = randomBytes(32).toString('base64');
    console.error('(generated an ephemeral PADI_MASTER_KEY for this run)');
  }

  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  const sealed = await encryptSecret(refreshToken);
  await db.insert(schema.users).values({ workosUserId: 'dev-user' });
  await db.insert(schema.padiConnections).values({
    workosUserId: 'dev-user',
    affiliateId,
    cognitoSub: 'dev',
    padiUsername: 'dev',
    encRefreshToken: sealed.ciphertext,
    encNonce: sealed.nonce,
    wrappedDek: sealed.wrappedDek,
  });
  console.error('seeded an encrypted connection in PGlite; minting + counting via the managed path…');

  const ctx = await getTenantContext(db, 'dev-user');
  const count = await countDives(ctx);
  console.error(`PADI accepted the minted token. Total dives: ${count}.`);
  console.error('Phase-3 connect → decrypt → mint → count verified end-to-end.');
}

main().catch((e) => {
  console.error('connect-smoke FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
