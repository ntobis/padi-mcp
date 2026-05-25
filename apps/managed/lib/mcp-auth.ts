/**
 * Verifies a WorkOS AuthKit access token (the bearer Claude sends after the
 * OAuth handshake) for the MCP endpoint. We validate the JWT signature against
 * WorkOS's public JWKS and take the `sub` claim as the tenant id (the same
 * WorkOS user id the web /connect flow uses). No secret needed — JWKS is public
 * and we don't fetch the user profile, only the id.
 *
 * Hardening TODO (pre-public): also assert the token audience is bound to this
 * resource URL, per the MCP authorization spec.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';

function jwksUrl(): URL {
  if (process.env.WORKOS_JWKS_URL) return new URL(process.env.WORKOS_JWKS_URL);
  const clientId = process.env.WORKOS_CLIENT_ID ?? '';
  return new URL(`https://api.workos.com/sso/jwks/${clientId}`);
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(jwksUrl());
  return jwks;
}

export async function verifyWorkosToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(bearerToken, getJwks()));
  } catch {
    return undefined; // invalid signature, expired, etc.
  }
  if (typeof payload.sub !== 'string' || !payload.sub) return undefined;
  const scopes =
    typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
  return {
    token: bearerToken,
    clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
    scopes,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
    extra: { userId: payload.sub },
  };
}
