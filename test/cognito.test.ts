import {
  CognitoAuthError,
  decodeJwtClaims,
  loginWithPassword,
  refreshTokens,
} from '@padi-mcp/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CFG = { region: 'us-west-2', clientId: 'test-client' };

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/x-amz-json-1.1' },
        }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('decodeJwtClaims', () => {
  it('reads claims from a raw token and a Bearer header', () => {
    const t = jwt({ sub: 'abc', exp: 123, 'custom:affiliate_id': '999', email: 'a@b.c' });
    expect(decodeJwtClaims(t)?.sub).toBe('abc');
    expect(decodeJwtClaims(`Bearer ${t}`)?.['custom:affiliate_id']).toBe('999');
    expect(decodeJwtClaims(null)).toBeNull();
    expect(decodeJwtClaims('garbage')).toBeNull();
  });
});

describe('loginWithPassword', () => {
  it('sends USER_PASSWORD_AUTH and parses tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            AuthenticationResult: {
              AccessToken: 'a',
              IdToken: jwt({ sub: 's', 'custom:affiliate_id': '1' }),
              RefreshToken: 'r',
              ExpiresIn: 3600,
              TokenType: 'Bearer',
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await loginWithPassword(CFG, 'me@x.com', 'pw');
    expect(tokens.refreshToken).toBe('r');
    expect(tokens.expiresIn).toBe(3600);
    expect(decodeJwtClaims(tokens.idToken)?.['custom:affiliate_id']).toBe('1');

    // request shape
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    });
    const body = JSON.parse(init.body as string);
    expect(body.AuthFlow).toBe('USER_PASSWORD_AUTH');
    expect(body.AuthParameters.USERNAME).toBe('me@x.com');
  });

  it('maps incorrect-password to NotAuthorized', async () => {
    mockFetchOnce(400, {
      __type: 'NotAuthorizedException',
      message: 'Incorrect username or password.',
    });
    await expect(loginWithPassword(CFG, 'me@x.com', 'bad')).rejects.toMatchObject({
      name: 'CognitoAuthError',
      code: 'NotAuthorized',
    });
  });

  it('throws Challenge when Cognito demands MFA', async () => {
    mockFetchOnce(200, { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'xyz' });
    await expect(loginWithPassword(CFG, 'me@x.com', 'pw')).rejects.toMatchObject({
      code: 'Challenge',
    });
  });
});

describe('refreshTokens', () => {
  it('sends REFRESH_TOKEN_AUTH and parses a token without a new refresh token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            AuthenticationResult: {
              AccessToken: 'a',
              IdToken: jwt({ sub: 's' }),
              ExpiresIn: 3600,
              TokenType: 'Bearer',
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await refreshTokens(CFG, 'refresh-abc');
    expect(tokens.refreshToken).toBeUndefined();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string);
    expect(body.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
    expect(body.AuthParameters.REFRESH_TOKEN).toBe('refresh-abc');
  });

  it('maps an expired/invalid refresh token to RefreshExpired', async () => {
    mockFetchOnce(400, { __type: 'NotAuthorizedException', message: 'Invalid Refresh Token' });
    await expect(refreshTokens(CFG, 'dead')).rejects.toMatchObject({ code: 'RefreshExpired' });
  });

  it('maps network failure to a Network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(refreshTokens(CFG, 'x')).rejects.toBeInstanceOf(CognitoAuthError);
    await expect(refreshTokens(CFG, 'x')).rejects.toMatchObject({ code: 'Network' });
  });
});
