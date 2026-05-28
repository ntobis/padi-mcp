import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { EnvKeyProvider, decryptSecret, encryptSecret } from '../lib/crypto/envelope';
import * as schema from '../lib/db/schema';

const provider = new EnvKeyProvider(randomBytes(32));
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
});

describe('schema + encrypted refresh token round-trip (PGlite)', () => {
  it('applies migrations and stores an encrypted connection', async () => {
    await db.insert(schema.users).values({ workosUserId: 'user_123', email: 'a@b.c' });

    const sealed = await encryptSecret('the-padi-refresh-token', provider);
    await db.insert(schema.padiConnections).values({
      workosUserId: 'user_123',
      affiliateId: '14867369',
      cognitoSub: 'sub-abc',
      padiUsername: 'a@b.c',
      encRefreshToken: sealed.ciphertext,
      encNonce: sealed.nonce,
      wrappedDek: sealed.wrappedDek,
    });

    const [row] = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_123'));

    expect(row).toBeDefined();
    expect(row?.affiliateId).toBe('14867369');
    expect(row?.status).toBe('active');
    // The stored token is ciphertext, not the plaintext.
    expect(row?.encRefreshToken).not.toContain('the-padi-refresh-token');
    // And it decrypts back to the original.
    const recovered = await decryptSecret(
      { ciphertext: row!.encRefreshToken, nonce: row!.encNonce, wrappedDek: row!.wrappedDek },
      provider,
    );
    expect(recovered).toBe('the-padi-refresh-token');
  });

  it('enforces one connection per user (unique index)', async () => {
    await db.insert(schema.users).values({ workosUserId: 'user_dup' });
    const sealed = await encryptSecret('t', provider);
    const values = {
      workosUserId: 'user_dup',
      affiliateId: '1',
      cognitoSub: 's',
      padiUsername: 'u',
      encRefreshToken: sealed.ciphertext,
      encNonce: sealed.nonce,
      wrappedDek: sealed.wrappedDek,
    };
    await db.insert(schema.padiConnections).values(values);
    await expect(db.insert(schema.padiConnections).values(values)).rejects.toThrow();
  });

  it('cascades connection deletion when the user is removed', async () => {
    await db.delete(schema.users).where(eq(schema.users.workosUserId, 'user_123'));
    const rows = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_123'));
    expect(rows).toHaveLength(0);
  });
});
