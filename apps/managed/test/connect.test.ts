import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub only the network Cognito call; keep decodeJwtClaims/defaultCognitoConfig real.
vi.mock('@padi-mcp/core', async (orig) => {
  const actual = await orig<typeof import('@padi-mcp/core')>();
  return { ...actual, loginWithPassword: vi.fn() };
});

import * as core from '@padi-mcp/core';
import { connectPadiAccount } from '../lib/connect';
import { decryptSecret } from '../lib/crypto/envelope';
import * as schema from '../lib/db/schema';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
let db: ReturnType<typeof drizzle<typeof schema>>;

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

beforeAll(async () => {
  process.env.PADI_MASTER_KEY = randomBytes(32).toString('base64');
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
});

beforeEach(() => {
  vi.clearAllMocks();
  (core.loginWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
    idToken: jwt({ sub: 'cog-sub-1', 'custom:affiliate_id': '10000000' }),
    accessToken: 'a',
    refreshToken: 'the-refresh-token',
    expiresIn: 3600,
    obtainedAt: Date.now(),
  });
});

describe('connectPadiAccount', () => {
  it('stores an encrypted connection and never persists the password', async () => {
    const { affiliateId } = await connectPadiAccount(db, 'user_A', 'me@x.com', 'secret-password');
    expect(affiliateId).toBe('10000000');

    const [conn] = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_A'));
    expect(conn?.affiliateId).toBe('10000000');
    expect(conn?.cognitoSub).toBe('cog-sub-1');
    expect(conn?.status).toBe('active');

    // The encrypted token decrypts to the refresh token, never the password.
    const recovered = await decryptSecret({
      ciphertext: conn!.encRefreshToken,
      nonce: conn!.encNonce,
      wrappedDek: conn!.wrappedDek,
    });
    expect(recovered).toBe('the-refresh-token');
    const blob = JSON.stringify(conn);
    expect(blob).not.toContain('secret-password');
    expect(blob).not.toContain('the-refresh-token');

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workosUserId, 'user_A'));
    expect(audit.some((a) => a.action === 'connect')).toBe(true);
  });

  it('is idempotent — reconnecting replaces the single connection', async () => {
    await connectPadiAccount(db, 'user_B', 'b@x.com', 'pw1');
    (core.loginWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      idToken: jwt({ sub: 'cog-sub-2', 'custom:affiliate_id': '999' }),
      accessToken: 'a',
      refreshToken: 'token-2',
      expiresIn: 3600,
      obtainedAt: Date.now(),
    });
    await connectPadiAccount(db, 'user_B', 'b@x.com', 'pw2');

    const rows = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_B'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.affiliateId).toBe('999');
  });
});
