import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@padi-mcp/core', async (orig) => {
  const actual = await orig<typeof import('@padi-mcp/core')>();
  return { ...actual, refreshTokens: vi.fn() };
});

import * as core from '@padi-mcp/core';
import { encryptSecret } from '../lib/crypto/envelope';
import * as schema from '../lib/db/schema';
import {
  NeedsReloginError,
  NotConnectedError,
  _clearTokenCache,
  getConnectionStatus,
  getPadiIdToken,
  getTenantContext,
} from '../lib/tokens';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
let db: ReturnType<typeof drizzle<typeof schema>>;

const nowSec = () => Math.floor(Date.now() / 1000);
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

async function seedConnection(userId: string, refreshToken: string): Promise<void> {
  const sealed = await encryptSecret(refreshToken);
  await db.insert(schema.users).values({ workosUserId: userId }).onConflictDoNothing();
  await db.insert(schema.padiConnections).values({
    workosUserId: userId,
    affiliateId: '10000000',
    cognitoSub: 's',
    padiUsername: 'u@x.com',
    encRefreshToken: sealed.ciphertext,
    encNonce: sealed.nonce,
    wrappedDek: sealed.wrappedDek,
  });
}

beforeAll(async () => {
  process.env.PADI_MASTER_KEY = randomBytes(32).toString('base64');
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
});

beforeEach(() => {
  vi.clearAllMocks();
  _clearTokenCache();
  (core.refreshTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
    idToken: jwt({ exp: nowSec() + 3600, sub: 's' }),
    accessToken: 'a',
    expiresIn: 3600,
    obtainedAt: Date.now(),
  });
});

describe('getPadiIdToken', () => {
  it('throws NotConnectedError when the user has no connection', async () => {
    await expect(getPadiIdToken(db, 'nobody')).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('mints a token from the stored refresh token and caches it', async () => {
    await seedConnection('u_mint', 'refresh-1');
    const t1 = await getPadiIdToken(db, 'u_mint');
    const t2 = await getPadiIdToken(db, 'u_mint');
    expect(t1).toBe(t2);
    expect(core.refreshTokens).toHaveBeenCalledTimes(1); // second call served from cache
    // Decrypted refresh token is what got passed to Cognito.
    expect((core.refreshTokens as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe('refresh-1');
  });

  it('forceRefresh re-mints', async () => {
    await seedConnection('u_force', 'refresh-1');
    await getPadiIdToken(db, 'u_force');
    await getPadiIdToken(db, 'u_force', { forceRefresh: true });
    expect(core.refreshTokens).toHaveBeenCalledTimes(2);
  });

  it('marks the connection needs_relogin when the refresh token is dead', async () => {
    await seedConnection('u_dead', 'refresh-dead');
    (core.refreshTokens as ReturnType<typeof vi.fn>).mockRejectedValue(
      new core.CognitoAuthError('RefreshExpired', 'Refresh Token has expired'),
    );
    await expect(getPadiIdToken(db, 'u_dead')).rejects.toBeInstanceOf(NeedsReloginError);

    const [conn] = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'u_dead'));
    expect(conn?.status).toBe('needs_relogin');
    // Subsequent calls short-circuit on the non-active status.
    await expect(getPadiIdToken(db, 'u_dead')).rejects.toBeInstanceOf(NeedsReloginError);
  });
});

describe('getTenantContext', () => {
  it('builds a context whose token provider mints via the stored connection', async () => {
    await seedConnection('u_ctx', 'refresh-ctx');
    const ctx = await getTenantContext(db, 'u_ctx');
    expect(ctx.affiliateId).toBe('10000000');
    const token = await ctx.getToken();
    expect(token).toContain('.');
    expect(core.refreshTokens).toHaveBeenCalledTimes(1);
  });
});

describe('getConnectionStatus', () => {
  it('reports not connected when the user has no connection', async () => {
    const status = await getConnectionStatus(db, 'nobody');
    expect(status).toMatchObject({ connected: false, status: null, affiliateId: null });
  });

  it('reports connected with affiliate id and no PADI call for an active connection', async () => {
    await seedConnection('u_status', 'refresh-status');
    const status = await getConnectionStatus(db, 'u_status');
    expect(status.connected).toBe(true);
    expect(status.status).toBe('active');
    expect(status.affiliateId).toBe('10000000');
    expect(status.padiUsername).toBe('u@x.com');
    expect(status.connectedAt).not.toBeNull();
    expect(core.refreshTokens).not.toHaveBeenCalled();
  });

  it('reports not connected (but with status) when the connection needs relogin', async () => {
    await seedConnection('u_relogin', 'refresh-relogin');
    await db
      .update(schema.padiConnections)
      .set({ status: 'needs_relogin' })
      .where(eq(schema.padiConnections.workosUserId, 'u_relogin'));
    const status = await getConnectionStatus(db, 'u_relogin');
    expect(status.connected).toBe(false);
    expect(status.status).toBe('needs_relogin');
  });
});
