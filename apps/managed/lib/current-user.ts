/**
 * Tenant identity now comes from WorkOS AuthKit: the web /connect flow reads it
 * from the session via `withAuth()`, and the MCP endpoint reads it from the
 * verified bearer token (`extra.authInfo.extra.userId`). This module just holds
 * the connect URL helper used in tool error messages.
 */
export function connectUrl(): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/connect`;
}
