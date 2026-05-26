/**
 * Layer-2 token minting. For an authenticated tenant (WorkOS user id), load
 * their PADI connection, decrypt the refresh token, and mint a PADI ID token —
 * caching the minted token in memory until shortly before it expires. Builds
 * the per-request PadiContext the core operations consume.
 *
 * Tenant isolation: the user id is always supplied by the caller (the
 * authenticated session in production), never by tool arguments.
 */
import { CognitoAuthError, type PadiContext, defaultCognitoConfig, refreshTokens } from '@padi-mcp/core';
import { eq } from 'drizzle-orm';
import { decryptSecret } from './crypto/envelope';
import type { AppDb } from './db/client';
import { padiConnections } from './db/schema';

const DEFAULT_ENDPOINT = 'https://logbook.global-prod.padi.com/api/Logbook';

export class NotConnectedError extends Error {
  override readonly name = 'NotConnectedError';
}
export class NeedsReloginError extends Error {
  override readonly name = 'NeedsReloginError';
}

interface CachedToken {
  token: string;
  expMs: number;
}
const tokenCache = new Map<string, CachedToken>();

/** For tests, to start from a clean slate. */
export function _clearTokenCache(): void {
  tokenCache.clear();
}

/** Drop a single tenant's cached minted token (e.g. on disconnect or erasure). */
export function evictCachedToken(userId: string): void {
  tokenCache.delete(userId);
}

export async function getPadiIdToken(
  db: AppDb,
  userId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const [conn] = await db
    .select()
    .from(padiConnections)
    .where(eq(padiConnections.workosUserId, userId));
  if (!conn) throw new NotConnectedError(`No PADI account connected for user ${userId}.`);
  if (conn.status !== 'active') {
    throw new NeedsReloginError(`PADI connection for ${userId} is ${conn.status}; reconnect required.`);
  }

  const now = Date.now();
  const cached = tokenCache.get(userId);
  if (!opts?.forceRefresh && cached && cached.expMs - now > 60_000) return cached.token;

  const refreshToken = decryptSecret({
    ciphertext: conn.encRefreshToken,
    nonce: conn.encNonce,
    wrappedDek: conn.wrappedDek,
  });

  try {
    const tokens = await refreshTokens(defaultCognitoConfig(), refreshToken);
    tokenCache.set(userId, { token: tokens.idToken, expMs: tokens.obtainedAt + tokens.expiresIn * 1000 });
    await db
      .update(padiConnections)
      .set({ lastRefreshedAt: new Date() })
      .where(eq(padiConnections.workosUserId, userId));
    return tokens.idToken;
  } catch (e) {
    if (e instanceof CognitoAuthError && (e.code === 'RefreshExpired' || e.code === 'NotAuthorized')) {
      tokenCache.delete(userId);
      await db
        .update(padiConnections)
        .set({ status: 'needs_relogin' })
        .where(eq(padiConnections.workosUserId, userId));
      throw new NeedsReloginError(`PADI session expired for ${userId}; reconnect required.`);
    }
    throw e;
  }
}

export interface ConnectionStatus {
  connected: boolean;
  status: string | null; // active | needs_relogin | revoked
  affiliateId: string | null;
  padiUsername: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
}

/** Read-only connection status for a tenant. Makes no PADI API call. */
export async function getConnectionStatus(db: AppDb, userId: string): Promise<ConnectionStatus> {
  const [conn] = await db
    .select()
    .from(padiConnections)
    .where(eq(padiConnections.workosUserId, userId));
  if (!conn) {
    return {
      connected: false,
      status: null,
      affiliateId: null,
      padiUsername: null,
      connectedAt: null,
      lastRefreshedAt: null,
    };
  }
  return {
    connected: conn.status === 'active',
    status: conn.status,
    affiliateId: conn.affiliateId,
    padiUsername: conn.padiUsername,
    connectedAt: conn.createdAt.toISOString(),
    lastRefreshedAt: conn.lastRefreshedAt?.toISOString() ?? null,
  };
}

/** Build the PadiContext for a tenant. Used by the MCP tools. */
export async function getTenantContext(db: AppDb, userId: string): Promise<PadiContext> {
  const [conn] = await db
    .select()
    .from(padiConnections)
    .where(eq(padiConnections.workosUserId, userId));
  if (!conn) throw new NotConnectedError(`No PADI account connected for user ${userId}.`);
  return {
    endpoint: process.env.PADI_ENDPOINT ?? DEFAULT_ENDPOINT,
    affiliateId: conn.affiliateId,
    xPlatform: 'web',
    userAgent: 'padi-mcp-managed/1.0',
    getToken: (o) => getPadiIdToken(db, userId, o),
  };
}
