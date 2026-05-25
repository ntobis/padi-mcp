/**
 * Shared Cognito auth core. PADI's logbook is gated by an AWS Cognito user
 * pool; the ID token in the `Authorization` header is a Cognito ID token.
 *
 * We talk to Cognito with plain `fetch` (no AWS SDK): the InitiateAuth flows we
 * use are UNAUTHENTICATED operations against a public app client (no client
 * secret → no SECRET_HASH), so no AWS credentials are involved. This keeps the
 * dependency tree tiny and runs identically in Node (local server) and Vercel
 * serverless (managed service). The wire contracts were verified by live probe.
 *
 * This module is intentionally pure/transport-agnostic: no filesystem, no
 * globals. Persistence is the caller's job.
 */

const DEFAULT_REGION = 'us-west-2';
const DEFAULT_CLIENT_ID = '2arn5r23p0ugce89a5moe95v1l';
const INITIATE_AUTH_TARGET = 'AWSCognitoIdentityProviderService.InitiateAuth';

export interface CognitoConfig {
  region: string;
  clientId: string;
}

export function defaultCognitoConfig(): CognitoConfig {
  return {
    region: process.env.PADI_COGNITO_REGION || DEFAULT_REGION,
    clientId: process.env.PADI_COGNITO_CLIENT_ID || DEFAULT_CLIENT_ID,
  };
}

export interface CognitoTokens {
  idToken: string; // the Bearer token PADI's API wants
  accessToken: string;
  refreshToken?: string; // present on password login; absent on refresh
  expiresIn: number; // seconds, typically 3600
  obtainedAt: number; // Date.now() ms, for expiry math
}

export type CognitoErrorCode =
  | 'NotAuthorized'
  | 'RefreshExpired'
  | 'PasswordResetRequired'
  | 'UserNotConfirmed'
  | 'Challenge'
  | 'Network'
  | 'Unknown';

export class CognitoAuthError extends Error {
  override readonly name = 'CognitoAuthError';
  constructor(
    readonly code: CognitoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface AuthenticationResult {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
  TokenType?: string;
}

interface InitiateAuthResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
  Session?: string;
  __type?: string;
  message?: string;
}

function endpoint(cfg: CognitoConfig): string {
  return `https://cognito-idp.${cfg.region}.amazonaws.com/`;
}

async function initiateAuth(
  cfg: CognitoConfig,
  body: Record<string, unknown>,
): Promise<InitiateAuthResponse> {
  let res: Response;
  try {
    res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': INITIATE_AUTH_TARGET,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new CognitoAuthError(
      'Network',
      `Could not reach Cognito at ${endpoint(cfg)}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const text = await res.text();
  let json: InitiateAuthResponse;
  try {
    json = JSON.parse(text) as InitiateAuthResponse;
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw mapError(json.__type ?? '', json.message ?? text);
  }
  return json;
}

function mapError(type: string, message: string): CognitoAuthError {
  const shortType = type.split('#').pop() ?? type;
  switch (shortType) {
    case 'NotAuthorizedException':
      // Same exception type covers bad password AND dead refresh token;
      // disambiguate by message so callers can fall back to re-login.
      if (/refresh token/i.test(message)) {
        return new CognitoAuthError('RefreshExpired', message);
      }
      return new CognitoAuthError('NotAuthorized', message);
    case 'PasswordResetRequiredException':
      return new CognitoAuthError('PasswordResetRequired', message);
    case 'UserNotConfirmedException':
      return new CognitoAuthError('UserNotConfirmed', message);
    default:
      return new CognitoAuthError('Unknown', `${shortType || 'Error'}: ${message}`);
  }
}

function toTokens(json: InitiateAuthResponse): CognitoTokens {
  const r = json.AuthenticationResult;
  if (!r || !r.IdToken || !r.AccessToken) {
    throw new CognitoAuthError('Unknown', 'Cognito returned no AuthenticationResult');
  }
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn ?? 3600,
    obtainedAt: Date.now(),
  };
}

/** USER_PASSWORD_AUTH — exchange email + password for tokens (incl. refresh). */
export async function loginWithPassword(
  cfg: CognitoConfig,
  username: string,
  password: string,
): Promise<CognitoTokens> {
  const json = await initiateAuth(cfg, {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cfg.clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password },
  });
  if (json.ChallengeName) {
    throw new CognitoAuthError(
      'Challenge',
      `Unexpected auth challenge "${json.ChallengeName}". PADI is not expected to require this ` +
        '(e.g. MFA). Cannot proceed automatically.',
    );
  }
  return toTokens(json);
}

/**
 * REFRESH_TOKEN_AUTH — mint a fresh ID/access token from a refresh token.
 * The response does NOT include a new refresh token (no rotation observed);
 * callers must keep reusing the stored one.
 */
export async function refreshTokens(
  cfg: CognitoConfig,
  refreshToken: string,
): Promise<CognitoTokens> {
  const json = await initiateAuth(cfg, {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: cfg.clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return toTokens(json);
}
