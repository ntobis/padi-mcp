/**
 * Connect (link) a PADI account to a tenant: exchange the PADI email + password
 * for tokens via Cognito, derive the affiliate id from the ID token, store ONLY
 * the envelope-encrypted refresh token, and discard the password. Idempotent —
 * reconnecting replaces the existing connection.
 */
import { decodeJwtClaims, defaultCognitoConfig, loginWithPassword } from '@padi-mcp/core';
import { encryptSecret } from './crypto/envelope';
import type { AppDb } from './db/client';
import { auditLog, padiConnections, users } from './db/schema';

export async function connectPadiAccount(
  db: AppDb,
  userId: string,
  email: string,
  password: string,
): Promise<{ affiliateId: string }> {
  const tokens = await loginWithPassword(defaultCognitoConfig(), email, password);
  if (!tokens.refreshToken) {
    throw new Error('PADI login did not return a refresh token; cannot connect.');
  }
  const claims = decodeJwtClaims(tokens.idToken) ?? {};
  const affiliateId = String(claims['custom:affiliate_id'] ?? '');
  const cognitoSub = String(claims.sub ?? '');
  if (!affiliateId) throw new Error('PADI ID token has no custom:affiliate_id claim.');

  const sealed = await encryptSecret(tokens.refreshToken);
  // password is now out of scope and never persisted.

  const connectionValues = {
    affiliateId,
    cognitoSub,
    padiUsername: email,
    encRefreshToken: sealed.ciphertext,
    encNonce: sealed.nonce,
    wrappedDek: sealed.wrappedDek,
    status: 'active' as const,
    lastRefreshedAt: new Date(),
  };

  await db
    .insert(users)
    .values({ workosUserId: userId, email })
    .onConflictDoUpdate({ target: users.workosUserId, set: { email } });

  await db
    .insert(padiConnections)
    .values({ workosUserId: userId, ...connectionValues })
    .onConflictDoUpdate({ target: padiConnections.workosUserId, set: connectionValues });

  await db.insert(auditLog).values({ workosUserId: userId, action: 'connect' });

  return { affiliateId };
}
