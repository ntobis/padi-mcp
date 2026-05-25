/**
 * Session state for the PADI MCP server.
 *
 * - Loads `inputs/session.json` at startup.
 * - Exposes the current values via a singleton accessor.
 * - Supports in-place replacement (used by the `padi_refresh_session` tool).
 * - Validates the JWT expiry and warns when close to expiration.
 *
 * The JWT itself is a Cognito ID token (RS256). We don't verify the
 * signature — Hasura/PADI does that server-side — we only decode the
 * payload to read `exp` and `sub`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Session {
  endpoint: string;
  authorization: string;
  affiliate_id: string;
  x_platform: string;
  user_agent: string;
  cognito_sub: string;
}

export class SessionMissingError extends Error {
  override readonly name = 'SessionMissingError';
}

export class SessionExpiredError extends Error {
  override readonly name = 'SessionExpiredError';
}

export interface JwtClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

export function decodeJwt(authHeader: string): JwtClaims | null {
  const m = authHeader.match(/Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
  if (!m) return null;
  const payload = m[1]!.split('.')[1]!;
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  try {
    const buf = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
    return JSON.parse(buf.toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
}

/**
 * Resolve inputs/session.json relative to this module, NOT process.cwd().
 *
 * When Claude Desktop launches the server (`node /abs/path/dist/index.js`)
 * the working directory is the OS default (often `/`), so a cwd-relative
 * path would point at `/inputs/session.json` — unreadable and unwritable.
 * Resolving from the module location works whether we're running the
 * compiled `dist/session.js` or the source `src/session.ts` via tsx, since
 * `inputs/` sits one level up from both. `PADI_SESSION_PATH` overrides
 * everything for users who want to keep the session file elsewhere.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const SESSION_PATH =
  process.env.PADI_SESSION_PATH ?? resolve(MODULE_DIR, '../inputs/session.json');
const EXPIRY_WARN_SECONDS = 5 * 60;

let current: Session | null = null;

export async function loadSession(path: string = SESSION_PATH): Promise<Session> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new SessionMissingError(
      `session.json not found at ${path}. Either call the padi_refresh_session tool with a ` +
        `fresh cURL from Chrome DevTools, run \`npm run curl-to-session\` to create it, or set ` +
        `the PADI_SESSION_PATH env var to point at an existing session file.`,
    );
  }
  const parsed = JSON.parse(raw) as Session;
  if (!parsed.endpoint) throw new SessionMissingError('session.json missing `endpoint`');
  if (!parsed.authorization)
    throw new SessionMissingError(
      'session.json missing `authorization` (Chrome may have stripped it from a HAR export — ' +
        'paste a cURL instead).',
    );
  if (!parsed.affiliate_id) throw new SessionMissingError('session.json missing `affiliate_id`');
  current = parsed;
  warnIfExpiring(parsed);
  return parsed;
}

export function getSession(): Session {
  if (!current) throw new SessionMissingError('Session not loaded. Call loadSession() first.');
  return current;
}

/**
 * Set the in-memory session and try to persist it to disk. The in-memory
 * update always succeeds; the disk write is best-effort so a read-only or
 * unexpected filesystem doesn't block the running process (the refreshed
 * session stays usable until the server restarts). `persisted` reports
 * whether the file was written.
 */
export async function replaceSession(
  next: Session,
  path: string = SESSION_PATH,
): Promise<{ session: Session; persisted: boolean; path: string; persistError?: string }> {
  current = next;
  warnIfExpiring(next);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { session: next, persisted: true, path };
  } catch (e) {
    const persistError = e instanceof Error ? e.message : String(e);
    console.error(`session: refreshed in memory but could not persist to ${path}: ${persistError}`);
    return { session: next, persisted: false, path, persistError };
  }
}

export function isExpired(session: Session = getSession(), nowSec = Date.now() / 1000): boolean {
  const claims = decodeJwt(session.authorization);
  if (!claims?.exp) return false;
  return claims.exp <= nowSec;
}

export function secondsUntilExpiry(
  session: Session = getSession(),
  nowSec = Date.now() / 1000,
): number | null {
  const claims = decodeJwt(session.authorization);
  if (!claims?.exp) return null;
  return Math.floor(claims.exp - nowSec);
}

function warnIfExpiring(session: Session): void {
  const secs = secondsUntilExpiry(session);
  if (secs === null) {
    console.error('session: warning — could not decode JWT exp claim');
    return;
  }
  if (secs <= 0) {
    console.error(`session: WARNING — JWT expired ${-secs}s ago. Refresh required.`);
    return;
  }
  if (secs < EXPIRY_WARN_SECONDS) {
    console.error(`session: warning — JWT expires in ${secs}s (< ${EXPIRY_WARN_SECONDS}s).`);
    return;
  }
  console.error(`session: ok — JWT expires in ${secs}s (sub=${session.cognito_sub || '?'})`);
}
