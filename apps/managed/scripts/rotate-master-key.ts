/**
 * Rotate the envelope KEK (PADI_MASTER_KEY) across all stored connections.
 *
 * Envelope encryption means the master key only WRAPS each per-secret DEK — it
 * never encrypts the refresh token directly. So rotating the master key is just
 * re-wrapping every stored DEK from the old key to the new one; the ciphertext
 * and nonce are untouched and no PADI re-login is needed.
 *
 * Usage:
 *   DATABASE_URL=... \
 *   PADI_MASTER_KEY_OLD=<current base64 key> \
 *   PADI_MASTER_KEY_NEW=<new base64 key> \
 *   npm run rotate-master-key -w @padi-mcp/managed -- [--dry-run]
 *
 * Then set PADI_MASTER_KEY=<new key> in the deployment env and redeploy.
 * See docs/runbooks/secret-rotation.md for the full procedure.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { EnvKeyProvider, parseKek, rewrapSecret } from '../lib/crypto/envelope';
import { eq } from 'drizzle-orm';
import { padiConnections } from '../lib/db/schema';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set.');

  const oldProvider = new EnvKeyProvider(parseKek(process.env.PADI_MASTER_KEY_OLD, 'PADI_MASTER_KEY_OLD'));
  const newProvider = new EnvKeyProvider(parseKek(process.env.PADI_MASTER_KEY_NEW, 'PADI_MASTER_KEY_NEW'));

  const client = postgres(dbUrl, { prepare: false });
  const db = drizzle(client);

  let rotated = 0;
  let failed = 0;
  try {
    const rows = await db
      .select({
        userId: padiConnections.workosUserId,
        ciphertext: padiConnections.encRefreshToken,
        nonce: padiConnections.encNonce,
        wrappedDek: padiConnections.wrappedDek,
      })
      .from(padiConnections);

    console.error(`[rotate] ${rows.length} connection(s) to process${dryRun ? ' (dry run)' : ''}.`);

    for (const row of rows) {
      try {
        const next = await rewrapSecret(
          { ciphertext: row.ciphertext, nonce: row.nonce, wrappedDek: row.wrappedDek },
          oldProvider,
          newProvider,
        );
        // Verify the re-wrapped DEK still unwraps under the new key before writing.
        await newProvider.unwrapDek(next.wrappedDek);

        if (!dryRun) {
          await db
            .update(padiConnections)
            .set({ wrappedDek: next.wrappedDek })
            .where(eq(padiConnections.workosUserId, row.userId));
        }
        rotated += 1;
      } catch (e) {
        failed += 1;
        console.error(`[rotate] FAILED user=${row.userId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    await client.end();
  }

  console.error(`[rotate] done: ${rotated} re-wrapped, ${failed} failed${dryRun ? ' (dry run — nothing written)' : ''}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
