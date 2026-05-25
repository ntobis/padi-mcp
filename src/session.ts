/**
 * Session state for the PADI MCP server.
 *
 * Evolved from "an ID token string" to "an auth state that can regenerate ID
 * tokens." A session now carries a Cognito refresh token; the server mints a
 * fresh 1-hour ID token whenever the cached one is about to expire, so the user
 * logs in once and stays authenticated for the life of the refresh token
 * (~30 days), or indefinitely if they opted into password storage.
 *
 * Backward compatible: a legacy session.json that only has `authorization`
 * (the old cURL-capture format) still loads and works until that ID token
 * expires, after which the user is asked to log in.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CognitoAuthError,
  type CognitoTokens,
  decodeJwtClaims,
  defaultCognitoConfig,
  loginWithPassword,
  refreshTokens,
} from '@padi-mcp/core';
import { getCredentialStore } from './auth/credential-store.js';

export interface Session {
  endpoint: string;
  affiliate_id: string;
  cognito_sub: string;
  username?: string;
  x_platform: string;
  user_agent: string;
  // Durable credential — lets us mint ID tokens for ~30 days:
  refresh_token?: string;
  // Cached most-recent ID token + expiry bookkeeping:
  id_token?: string;
  id_token_obtained_at?: number; // ms
  id_token_expires_in?: number; // seconds
  // Legacy field from the old cURL-capture flow ("Bearer <jwt>"):
  authorization?: string;
}

export class SessionMissingError extends Error {
  override readonly name = 'SessionMissingError';
}

export class SessionExpiredError extends Error {
  override readonly name = 'SessionExpiredError';
}

export class SessionNeedsLoginError extends Error {
  override readonly name = 'SessionNeedsLoginError';
}

const DEFAULT_ENDPOINT = 'https://logbook.global-prod.padi.com/api/Logbook';
const EXPIRY_SKEW_MS = 60_000; // refresh when <60s of life remains

/**
 * Resolve inputs/session.json relative to this module, NOT process.cwd().
 * (Claude Desktop launches the server with cwd=/, so a cwd-relative path fails.)
 * `PADI_SESSION_PATH` overrides for users who keep the file elsewhere.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const SESSION_PATH =
  process.env.PADI_SESSION_PATH ?? resolve(MODULE_DIR, '../inputs/session.json');

let current: Session | null = null;

/** Fill in derived fields and migrate the legacy `authorization` shape. */
function normalizeSession(parsed: Partial<Session>): Session {
  const s: Session = {
    endpoint: parsed.endpoint || DEFAULT_ENDPOINT,
    affiliate_id: parsed.affiliate_id ?? '',
    cognito_sub: parsed.cognito_sub ?? '',
    username: parsed.username,
    x_platform: parsed.x_platform || 'web',
    user_agent: parsed.user_agent ?? '',
    refresh_token: parsed.refresh_token,
    id_token: parsed.id_token,
    id_token_obtained_at: parsed.id_token_obtained_at,
    id_token_expires_in: parsed.id_token_expires_in,
  };

  // Migrate legacy "Bearer <jwt>" into the cached-id-token fields.
  if (!s.id_token && parsed.authorization) {
    const raw = parsed.authorization.replace(/^Bearer\s+/i, '').trim();
    s.id_token = raw;
    const claims = decodeJwtClaims(raw);
    if (claims?.iat) s.id_token_obtained_at = claims.iat * 1000;
    if (claims?.exp && claims?.iat) s.id_token_expires_in = claims.exp - claims.iat;
  }

  // Derive identity from whichever ID token we have.
  const claims = decodeJwtClaims(s.id_token);
  if (claims) {
    if (!s.affiliate_id) s.affiliate_id = String(claims['custom:affiliate_id'] ?? '');
    if (!s.cognito_sub) s.cognito_sub = String(claims.sub ?? '');
    if (!s.username && typeof claims.email === 'string') s.username = claims.email;
  }
  return s;
}

export async function loadSession(path: string = SESSION_PATH): Promise<Session> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new SessionMissingError(
      `session.json not found at ${path}. Either call the padi_login tool with your PADI ` +
        'email + password, run `npm run login`, or set PADI_SESSION_PATH to point at an ' +
        'existing session file.',
    );
  }
  const parsed = normalizeSession(JSON.parse(raw) as Partial<Session>);
  if (!parsed.refresh_token && !parsed.id_token) {
    throw new SessionMissingError(
      'session.json has no refresh_token or id_token. Run padi_login to sign in.',
    );
  }
  if (!parsed.affiliate_id) {
    throw new SessionMissingError(
      'session.json missing affiliate_id and none could be derived from the token. Run padi_login.',
    );
  }
  current = parsed;
  warnAboutToken(parsed);
  return parsed;
}

export function getSession(): Session {
  if (!current) throw new SessionMissingError('Session not loaded. Call loadSession() first.');
  return current;
}

/** Apply freshly-minted Cognito tokens onto the in-memory session. */
function applyTokens(tokens: CognitoTokens): void {
  if (!current) throw new SessionMissingError('Session not loaded.');
  current.id_token = tokens.idToken;
  current.id_token_obtained_at = tokens.obtainedAt;
  current.id_token_expires_in = tokens.expiresIn;
  if (tokens.refreshToken) current.refresh_token = tokens.refreshToken;
  const claims = decodeJwtClaims(tokens.idToken);
  if (claims) {
    const aff = String(claims['custom:affiliate_id'] ?? '');
    if (aff) current.affiliate_id = aff;
    const sub = String(claims.sub ?? '');
    if (sub) current.cognito_sub = sub;
  }
  current.authorization = undefined; // drop any stale legacy field (omitted by JSON.stringify)
}

function cachedTokenMsRemaining(): number {
  if (!current?.id_token || current.id_token_obtained_at == null) return Number.NEGATIVE_INFINITY;
  // Prefer the token's own exp claim; fall back to obtained_at + expires_in.
  const claims = decodeJwtClaims(current.id_token);
  const expiresAtMs = claims?.exp
    ? claims.exp * 1000
    : current.id_token_obtained_at + (current.id_token_expires_in ?? 0) * 1000;
  return expiresAtMs - Date.now();
}

/**
 * Mint a new ID token: try the refresh token first, then a stored password,
 * else surface SessionNeedsLoginError. Used both when the cache is stale and
 * when PADI rejects a still-cached token (revoked mid-life).
 */
async function mintNewIdToken(): Promise<string> {
  if (!current) throw new SessionMissingError('Session not loaded.');
  const cfg = defaultCognitoConfig();

  if (current.refresh_token) {
    try {
      const tokens = await refreshTokens(cfg, current.refresh_token);
      applyTokens(tokens);
      await persistCurrent();
      return current.id_token as string;
    } catch (e) {
      const fatal =
        e instanceof CognitoAuthError &&
        (e.code === 'RefreshExpired' || e.code === 'NotAuthorized');
      if (!fatal) throw e; // network/unknown — bubble up, don't lose the session
      // else fall through to password re-login
    }
  }

  if (current.username) {
    const store = await getCredentialStore();
    const pw = await store.loadPassword(current.username).catch(() => null);
    if (pw) {
      const tokens = await loginWithPassword(cfg, current.username, pw);
      applyTokens(tokens);
      await persistCurrent();
      return current.id_token as string;
    }
  }

  throw new SessionNeedsLoginError(
    'PADI session expired and cannot auto-refresh (no valid refresh token or stored password). ' +
      'Run padi_login (or `npm run login`) to sign in again.',
  );
}

/** The accessor padi-client uses for every request. Returns a live ID token. */
export async function getValidIdToken(): Promise<string> {
  if (!current) throw new SessionMissingError('Session not loaded.');
  if (current.id_token && cachedTokenMsRemaining() > EXPIRY_SKEW_MS) {
    return current.id_token;
  }
  return mintNewIdToken();
}

/** Force a new ID token regardless of cache (used on a PADI 401 retry). */
export async function refreshIdTokenNow(): Promise<string> {
  return mintNewIdToken();
}

/** Log in with PADI email + password; persist the session (and optionally pw). */
export async function login(
  email: string,
  password: string,
  rememberPassword = false,
): Promise<Session> {
  const tokens = await loginWithPassword(defaultCognitoConfig(), email, password);
  const claims = decodeJwtClaims(tokens.idToken) ?? {};
  const affiliate_id = String(claims['custom:affiliate_id'] ?? '');
  if (!affiliate_id) {
    throw new Error('Login succeeded but the ID token has no custom:affiliate_id claim.');
  }
  current = {
    endpoint: current?.endpoint ?? DEFAULT_ENDPOINT,
    affiliate_id,
    cognito_sub: String(claims.sub ?? ''),
    username: email,
    x_platform: current?.x_platform ?? 'web',
    user_agent: current?.user_agent ?? '',
    refresh_token: tokens.refreshToken,
    id_token: tokens.idToken,
    id_token_obtained_at: tokens.obtainedAt,
    id_token_expires_in: tokens.expiresIn,
  };
  const store = await getCredentialStore();
  if (rememberPassword) await store.savePassword(email, password);
  else await store.clear(email).catch(() => {});
  await persistCurrent();
  return current;
}

/** Clear all auth state: in-memory, the session file, and any stored password. */
export async function logout(): Promise<void> {
  const username = current?.username;
  current = null;
  if (username) {
    const store = await getCredentialStore();
    await store.clear(username).catch(() => {});
  }
  await unlink(SESSION_PATH).catch(() => {});
}

export interface AuthStatus {
  logged_in: boolean;
  has_refresh_token: boolean;
  id_token_expires_in_seconds: number | null;
  affiliate_id: string | null;
  username: string | null;
}

export function authStatus(): AuthStatus {
  if (!current) {
    return {
      logged_in: false,
      has_refresh_token: false,
      id_token_expires_in_seconds: null,
      affiliate_id: null,
      username: null,
    };
  }
  return {
    logged_in: Boolean(current.refresh_token || current.id_token),
    has_refresh_token: Boolean(current.refresh_token),
    id_token_expires_in_seconds: secondsUntilExpiry(),
    affiliate_id: current.affiliate_id || null,
    username: current.username ?? null,
  };
}

export function secondsUntilExpiry(): number | null {
  if (!current?.id_token) return null;
  const claims = decodeJwtClaims(current.id_token);
  if (!claims?.exp) return null;
  return Math.floor(claims.exp - Date.now() / 1000);
}

/**
 * Replace the session from an externally-built object (the legacy
 * padi_refresh_session cURL path). Normalizes + persists best-effort.
 */
export async function replaceSession(
  next: Partial<Session>,
  path: string = SESSION_PATH,
): Promise<{ session: Session; persisted: boolean; path: string; persistError?: string }> {
  current = normalizeSession(next);
  const result = await persistCurrent(path);
  return { session: current, ...result };
}

/** Persist the in-memory session. Best-effort: never throws on write failure. */
async function persistCurrent(
  path: string = SESSION_PATH,
): Promise<{ persisted: boolean; path: string; persistError?: string }> {
  if (!current) return { persisted: false, path, persistError: 'no session' };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await chmod(path, 0o600).catch(() => {});
    return { persisted: true, path };
  } catch (e) {
    const persistError = e instanceof Error ? e.message : String(e);
    console.error(`session: held in memory but could not persist to ${path}: ${persistError}`);
    return { persisted: false, path, persistError };
  }
}

function warnAboutToken(session: Session): void {
  if (session.refresh_token) {
    const secs = secondsUntilExpiry();
    console.error(
      secs != null && secs > 0
        ? `session: ok — ID token valid ${secs}s; auto-refresh enabled (refresh token present).`
        : 'session: ID token stale; will auto-refresh on first request.',
    );
    return;
  }
  // Legacy / id-token-only session.
  const secs = secondsUntilExpiry();
  if (secs == null) {
    console.error('session: warning — could not decode ID token expiry.');
  } else if (secs <= 0) {
    console.error(
      `session: WARNING — ID token expired ${-secs}s ago and there is no refresh token. ` +
        'Run padi_login.',
    );
  } else {
    console.error(
      `session: ok — ID token valid ${secs}s (no refresh token; run padi_login to enable auto-refresh).`,
    );
  }
}
