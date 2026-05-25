import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub only the network-touching Cognito calls; keep the real decodeJwtClaims,
// CognitoAuthError, and defaultCognitoConfig from the core package.
vi.mock('@padi-mcp/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@padi-mcp/core')>();
  return { ...actual, loginWithPassword: vi.fn(), refreshTokens: vi.fn() };
});

// No password stored by default.
const loadPassword = vi.fn(async () => null as string | null);
vi.mock('../src/auth/credential-store.js', () => ({
  getCredentialStore: vi.fn(async () => ({
    loadPassword,
    savePassword: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  })),
}));

// Keep the session file off the real filesystem.
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw new Error('no file');
  }),
  unlink: vi.fn(async () => {}),
  chmod: vi.fn(async () => {}),
}));

import * as cognito from '@padi-mcp/core';
import { SessionNeedsLoginError, getValidIdToken, replaceSession } from '../src/session.js';

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
  loadPassword.mockResolvedValue(null);
});

describe('getValidIdToken', () => {
  it('returns the cached token without refreshing when it is still fresh', async () => {
    const fresh = jwt({
      exp: nowSec() + 3600,
      iat: nowSec(),
      sub: 's',
      'custom:affiliate_id': '1',
    });
    await replaceSession({
      affiliate_id: '1',
      x_platform: 'web',
      user_agent: '',
      refresh_token: 'r',
      id_token: fresh,
      id_token_obtained_at: Date.now(),
      id_token_expires_in: 3600,
    });
    const token = await getValidIdToken();
    expect(token).toBe(fresh);
    expect(cognito.refreshTokens).not.toHaveBeenCalled();
  });

  it('serves a legacy id-token-only session while the token is still valid', async () => {
    const fresh = jwt({
      exp: nowSec() + 1800,
      iat: nowSec(),
      sub: 's',
      'custom:affiliate_id': '1',
    });
    await replaceSession({
      affiliate_id: '1',
      x_platform: 'web',
      user_agent: '',
      authorization: `Bearer ${fresh}`, // legacy cURL-capture shape, no refresh token
    });
    expect(await getValidIdToken()).toBe(fresh);
    expect(cognito.refreshTokens).not.toHaveBeenCalled();
  });

  it('refreshes via the refresh token when the cached token is expired', async () => {
    const minted = jwt({
      exp: nowSec() + 3600,
      iat: nowSec(),
      sub: 's',
      'custom:affiliate_id': '1',
    });
    (cognito.refreshTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
      idToken: minted,
      accessToken: 'a',
      expiresIn: 3600,
      obtainedAt: Date.now(),
    });
    await replaceSession({
      affiliate_id: '1',
      x_platform: 'web',
      user_agent: '',
      refresh_token: 'r',
      id_token: jwt({ exp: nowSec() - 10, iat: nowSec() - 3610 }),
      id_token_obtained_at: Date.now() - 3_600_000,
      id_token_expires_in: 3600,
    });
    const token = await getValidIdToken();
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(token).toBe(minted);
  });

  it('throws SessionNeedsLoginError when expired with no refresh token or stored password', async () => {
    await replaceSession({
      affiliate_id: '1',
      x_platform: 'web',
      user_agent: '',
      id_token: jwt({ exp: nowSec() - 10, iat: nowSec() - 3610 }),
      id_token_obtained_at: Date.now() - 3_600_000,
      id_token_expires_in: 3600,
    });
    await expect(getValidIdToken()).rejects.toBeInstanceOf(SessionNeedsLoginError);
  });

  it('falls back to a stored password when the refresh token is dead', async () => {
    const minted = jwt({
      exp: nowSec() + 3600,
      iat: nowSec(),
      sub: 's',
      'custom:affiliate_id': '1',
    });
    (cognito.refreshTokens as ReturnType<typeof vi.fn>).mockRejectedValue(
      new cognito.CognitoAuthError('RefreshExpired', 'Refresh Token has expired'),
    );
    (cognito.loginWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      idToken: minted,
      accessToken: 'a',
      refreshToken: 'r2',
      expiresIn: 3600,
      obtainedAt: Date.now(),
    });
    loadPassword.mockResolvedValue('stored-pw');
    await replaceSession({
      affiliate_id: '1',
      username: 'me@x.com',
      x_platform: 'web',
      user_agent: '',
      refresh_token: 'dead',
      id_token: jwt({ exp: nowSec() - 10, iat: nowSec() - 3610 }),
      id_token_obtained_at: Date.now() - 3_600_000,
      id_token_expires_in: 3600,
    });
    const token = await getValidIdToken();
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(cognito.loginWithPassword).toHaveBeenCalledTimes(1);
    expect(token).toBe(minted);
  });
});
