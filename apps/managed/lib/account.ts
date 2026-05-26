/**
 * Per-tenant account management: disconnect (revoke the stored PADI link) and
 * the GDPR data-subject rights (export + erase). Identity is always the
 * authenticated WorkOS user id — never a tool argument.
 */
import { eq } from 'drizzle-orm';
import type { AppDb } from './db/client';
import { auditLog, padiConnections, users } from './db/schema';
import { evictCachedToken } from './tokens';

/**
 * Revoke a tenant's PADI link: delete the connection row (which holds the
 * envelope-encrypted refresh token) and drop any cached minted token. The user
 * account + audit history are kept; reconnecting re-creates the connection.
 */
export async function disconnectPadiAccount(
  db: AppDb,
  userId: string,
): Promise<{ disconnected: boolean }> {
  const deleted = await db
    .delete(padiConnections)
    .where(eq(padiConnections.workosUserId, userId))
    .returning({ id: padiConnections.id });
  evictCachedToken(userId);
  const disconnected = deleted.length > 0;
  if (disconnected) {
    await db.insert(auditLog).values({ workosUserId: userId, action: 'disconnect' });
  }
  return { disconnected };
}

export interface TenantDataExport {
  workosUserId: string;
  user: { email: string | null; createdAt: string } | null;
  connection: {
    affiliateId: string;
    padiUsername: string;
    status: string;
    connectedAt: string;
    lastRefreshedAt: string | null;
  } | null;
  auditLog: Array<{ action: string; diveId: number | null; detail: unknown; createdAt: string }>;
}

/**
 * Export everything this service stores about a tenant. Deliberately omits the
 * envelope-encrypted refresh token and its key material — that secret is only
 * ever stored, never disclosed.
 */
export async function exportTenantData(db: AppDb, userId: string): Promise<TenantDataExport> {
  const [user] = await db.select().from(users).where(eq(users.workosUserId, userId));
  const [conn] = await db
    .select()
    .from(padiConnections)
    .where(eq(padiConnections.workosUserId, userId));
  const audits = await db.select().from(auditLog).where(eq(auditLog.workosUserId, userId));
  return {
    workosUserId: userId,
    user: user ? { email: user.email, createdAt: user.createdAt.toISOString() } : null,
    connection: conn
      ? {
          affiliateId: conn.affiliateId,
          padiUsername: conn.padiUsername,
          status: conn.status,
          connectedAt: conn.createdAt.toISOString(),
          lastRefreshedAt: conn.lastRefreshedAt?.toISOString() ?? null,
        }
      : null,
    auditLog: audits.map((a) => ({
      action: a.action,
      diveId: a.diveId,
      detail: a.detail,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/**
 * GDPR erasure: hard-delete everything this service holds for a tenant — the
 * connection (encrypted token included), the audit log, and the user row — and
 * drop any cached token. Irreversible; leaves no tombstone.
 */
export async function deleteTenantData(
  db: AppDb,
  userId: string,
): Promise<{ connections: number; auditEntries: number; user: boolean }> {
  const conns = await db
    .delete(padiConnections)
    .where(eq(padiConnections.workosUserId, userId))
    .returning({ id: padiConnections.id });
  const audits = await db
    .delete(auditLog)
    .where(eq(auditLog.workosUserId, userId))
    .returning({ id: auditLog.id });
  const usersDeleted = await db
    .delete(users)
    .where(eq(users.workosUserId, userId))
    .returning({ id: users.workosUserId });
  evictCachedToken(userId);
  return {
    connections: conns.length,
    auditEntries: audits.length,
    user: usersDeleted.length > 0,
  };
}
