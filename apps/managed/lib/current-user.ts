/**
 * The authenticated tenant id. Phase 3 stub — a fixed dev user so the connect
 * flow and per-tenant token minting can be built and tested before Layer-1
 * auth exists. Phase 4 replaces the body with the WorkOS AuthKit session user.
 */
export async function getCurrentUserId(): Promise<string> {
  return process.env.MANAGED_DEV_USER_ID ?? 'dev-user';
}

/** Where to send a user to (re)connect their PADI account. */
export function connectUrl(): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/connect`;
}
