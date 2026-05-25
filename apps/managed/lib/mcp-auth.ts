/**
 * Verifies a WorkOS AuthKit access token (the bearer Claude sends after the
 * OAuth handshake) for the MCP endpoint.
 *
 * The MCP/DCR flow is served by your AuthKit domain (https://<slug>.authkit.app),
 * NOT api.workos.com. We discover that authorization server's metadata
 * (issuer + jwks_uri) from WORKOS_AUTHKIT_DOMAIN, verify the JWT signature
 * against its JWKS and check the issuer, and take `sub` as the tenant id (the
 * same WorkOS user id the web /connect flow uses). No secret needed.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';

interface AuthServerMetadata {
  issuer: string;
  jwks_uri: string;
}

let metadata: AuthServerMetadata | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let loading: Promise<void> | null = null;

function authkitDomain(): string {
  const domain = (process.env.WORKOS_AUTHKIT_DOMAIN ?? '').trim().replace(/\/$/, '');
  if (!domain) {
    throw new Error('WORKOS_AUTHKIT_DOMAIN is not set (e.g. https://your-slug.authkit.app).');
  }
  return domain;
}

async function ensureLoaded(): Promise<void> {
  if (metadata && jwks) return;
  if (!loading) {
    loading = (async () => {
      const url = `${authkitDomain()}/.well-known/oauth-authorization-server`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Auth server metadata fetch failed (${res.status}) from ${url}`);
      const meta = (await res.json()) as AuthServerMetadata;
      if (!meta.jwks_uri || !meta.issuer) throw new Error('Auth server metadata missing jwks_uri/issuer');
      jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
      metadata = meta;
    })().catch((e) => {
      loading = null; // allow retry on next request
      throw e;
    });
  }
  await loading;
}

export async function verifyWorkosToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  let payload: JWTPayload;
  try {
    await ensureLoaded();
    ({ payload } = await jwtVerify(bearerToken, jwks as NonNullable<typeof jwks>, {
      issuer: (metadata as AuthServerMetadata).issuer,
    }));
  } catch {
    return undefined; // invalid signature/issuer, expired, or metadata unavailable
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
