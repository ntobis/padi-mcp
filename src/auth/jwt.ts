/**
 * Decode (not verify) a Cognito JWT payload. We never verify the signature —
 * PADI/Hasura does that server-side. We only read claims (`exp`, `sub`,
 * `custom:affiliate_id`, `email`) to drive expiry math and session derivation.
 *
 * Accepts either a raw token or a `Bearer <token>` header value.
 */
export interface JwtClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  'custom:affiliate_id'?: string;
  [key: string]: unknown;
}

export function decodeJwtClaims(token: string | null | undefined): JwtClaims | null {
  if (!token) return null;
  const raw = token.replace(/^Bearer\s+/i, '').trim();
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  try {
    const buf = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
    return JSON.parse(buf.toString('utf8')) as JwtClaims;
  } catch {
    return null;
  }
}
