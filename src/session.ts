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
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

const SESSION_PATH = resolve(process.cwd(), 'inputs/session.json');
const EXPIRY_WARN_SECONDS = 5 * 60;

let current: Session | null = null;

export async function loadSession(path: string = SESSION_PATH): Promise<Session> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new SessionMissingError(
      `inputs/session.json not found at ${path}. Provide a cURL capture from Chrome ` +
        `DevTools and run \`npm run curl-to-session\` to create it.`,
    );
  }
  const parsed = JSON.parse(raw) as Session;
  if (!parsed.endpoint) throw new SessionMissingError('session.json missing `endpoint`');
  if (!parsed.authorization)
    throw new SessionMissingError(
      'session.json missing `authorization` (Chrome may have stripped it from a HAR export — ' +
        'paste a cURL instead).',
    );
  if (!parsed.affiliate_id)
    throw new SessionMissingError('session.json missing `affiliate_id`');
  current = parsed;
  warnIfExpiring(parsed);
  return parsed;
}

export function getSession(): Session {
  if (!current)
    throw new SessionMissingError('Session not loaded. Call loadSession() first.');
  return current;
}

export async function replaceSession(
  next: Session,
  path: string = SESSION_PATH,
): Promise<Session> {
  current = next;
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  warnIfExpiring(next);
  return next;
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
