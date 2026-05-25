/**
 * Phase-1 dev token provider — a stand-in for the real per-tenant provider
 * (Phase 3, which decrypts a stored refresh token per authenticated user).
 *
 * Reads a single refresh token + affiliate id from env and mints PADI ID
 * tokens from it, caching the minted token in memory until shortly before it
 * expires. Lets us exercise the MCP endpoint end-to-end against the live PADI
 * API with no database or auth wired up yet.
 */
import { type PadiContext, decodeJwtClaims, defaultCognitoConfig, refreshTokens } from '@padi-mcp/core';

const DEFAULT_ENDPOINT = 'https://logbook.global-prod.padi.com/api/Logbook';

let cached: { token: string; expMs: number } | null = null;

export class DevProviderNotConfiguredError extends Error {
  override readonly name = 'DevProviderNotConfiguredError';
}

async function devGetToken(opts?: { forceRefresh?: boolean }): Promise<string> {
  const refreshToken = process.env.PADI_DEV_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new DevProviderNotConfiguredError(
      'PADI_DEV_REFRESH_TOKEN is not set. The Phase-1 dev provider needs a PADI refresh token ' +
        'to mint ID tokens. Set it (and optionally PADI_DEV_AFFILIATE_ID) in apps/managed/.env.local.',
    );
  }
  const now = Date.now();
  if (!opts?.forceRefresh && cached && cached.expMs - now > 60_000) return cached.token;
  const tokens = await refreshTokens(defaultCognitoConfig(), refreshToken);
  cached = { token: tokens.idToken, expMs: tokens.obtainedAt + tokens.expiresIn * 1000 };
  return tokens.idToken;
}

/** Build a PadiContext from the dev refresh token. affiliate_id from env or token claims. */
export function devContext(): PadiContext {
  return {
    endpoint: process.env.PADI_ENDPOINT ?? DEFAULT_ENDPOINT,
    affiliateId: resolveAffiliateId(),
    xPlatform: 'web',
    userAgent: 'padi-mcp-managed/0.1 (phase1-dev)',
    getToken: devGetToken,
  };
}

function resolveAffiliateId(): string {
  const fromEnv = process.env.PADI_DEV_AFFILIATE_ID;
  if (fromEnv) return fromEnv;
  // Fall back to the affiliate id baked into the last minted token, if any.
  if (cached) {
    const claims = decodeJwtClaims(cached.token);
    const aff = claims?.['custom:affiliate_id'];
    if (aff) return String(aff);
  }
  return '';
}
