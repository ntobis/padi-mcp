/**
 * Tenant identity now comes from WorkOS AuthKit: the web /connect flow reads it
 * from the session via `withAuth()`, and the MCP endpoint reads it from the
 * verified bearer token (`extra.authInfo.extra.userId`). This module just holds
 * the connect URL helper used in tool error messages.
 */
export function connectUrl(): string {
  // APP_URL is the explicit override; on Vercel we fall back to the auto-injected
  // stable production domain so the link is never a dev localhost address even when
  // APP_URL was not configured. Local dev with neither set still gets localhost.
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base =
    process.env.APP_URL ?? (vercelDomain ? `https://${vercelDomain}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/connect`;
}
