/**
 * Builds a PadiContext for the local single-tenant server from the file-based
 * session. The token provider delegates to the session's auto-refresh: a plain
 * call returns the cached/refreshed ID token; `forceRefresh` (used on a PADI
 * 401 retry) mints a brand-new one.
 */
import type { PadiContext } from '@padi-mcp/core';
import { getSession, getValidIdToken, refreshIdTokenNow } from './session.js';

export function localContext(): PadiContext {
  const s = getSession();
  return {
    endpoint: s.endpoint,
    affiliateId: s.affiliate_id,
    xPlatform: s.x_platform,
    userAgent: s.user_agent,
    getToken: (opts) => (opts?.forceRefresh ? refreshIdTokenNow() : getValidIdToken()),
  };
}
