import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteTenantData, disconnectPadiAccount, exportTenantData } from '../lib/account';
import * as schema from '../lib/db/schema';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seed(userId: string, opts?: { secret?: string }) {
  await db.insert(schema.users).values({ workosUserId: userId, email: `${userId}@x.com` });
  await db.insert(schema.padiConnections).values({
    workosUserId: userId,
    affiliateId: '10000000',
    cognitoSub: 'cog-sub',
    padiUsername: `${userId}@x.com`,
    encRefreshToken: opts?.secret ?? 'enc-secret',
    encNonce: 'nonce-value',
    wrappedDek: 'wrapped-dek-value',
    status: 'active',
    lastRefreshedAt: new Date(),
  });
  await db.insert(schema.auditLog).values({ workosUserId: userId, action: 'connect' });
}

beforeAll(async () => {
  process.env.PADI_MASTER_KEY = randomBytes(32).toString('base64');
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(schema.auditLog);
  await db.delete(schema.padiConnections);
  await db.delete(schema.users);
});

describe('disconnectPadiAccount', () => {
  it('deletes the connection, keeps the account + audit, and logs a disconnect', async () => {
    await seed('user_A');
    const res = await disconnectPadiAccount(db, 'user_A');
    expect(res.disconnected).toBe(true);

    const conns = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_A'));
    expect(conns).toHaveLength(0);

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workosUserId, 'user_A'));
    expect(user).toBeDefined();

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workosUserId, 'user_A'));
    expect(audits.some((a) => a.action === 'disconnect')).toBe(true);
  });

  it('is a no-op (no audit row) when nothing is connected', async () => {
    const res = await disconnectPadiAccount(db, 'nobody');
    expect(res.disconnected).toBe(false);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workosUserId, 'nobody'));
    expect(audits).toHaveLength(0);
  });
});

describe('exportTenantData', () => {
  it('returns stored metadata and never the encrypted token or key material', async () => {
    await seed('user_X', { secret: 'TOP-SECRET-ENC-TOKEN' });
    const out = await exportTenantData(db, 'user_X');

    expect(out.user?.email).toBe('user_X@x.com');
    expect(out.connection?.affiliateId).toBe('10000000');
    expect(out.connection?.padiUsername).toBe('user_X@x.com');
    expect(out.auditLog.length).toBeGreaterThan(0);

    const blob = JSON.stringify(out);
    expect(blob).not.toContain('TOP-SECRET-ENC-TOKEN');
    expect(blob).not.toContain('wrapped-dek-value');
    expect(blob).not.toContain('nonce-value');
  });

  it('reports nulls / empty for an unknown tenant', async () => {
    const out = await exportTenantData(db, 'ghost');
    expect(out.user).toBeNull();
    expect(out.connection).toBeNull();
    expect(out.auditLog).toHaveLength(0);
  });
});

describe('deleteTenantData', () => {
  it('erases everything for one tenant and leaves other tenants intact', async () => {
    await seed('user_1');
    await seed('user_2');

    const res = await deleteTenantData(db, 'user_1');
    expect(res).toEqual({ connections: 1, auditEntries: 1, user: true });

    expect(
      await db.select().from(schema.users).where(eq(schema.users.workosUserId, 'user_1')),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.padiConnections)
        .where(eq(schema.padiConnections.workosUserId, 'user_1')),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.workosUserId, 'user_1')),
    ).toHaveLength(0);

    const user2 = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workosUserId, 'user_2'));
    expect(user2).toHaveLength(1);
    const conn2 = await db
      .select()
      .from(schema.padiConnections)
      .where(eq(schema.padiConnections.workosUserId, 'user_2'));
    expect(conn2).toHaveLength(1);
  });

  it('returns zero counts for an unknown tenant', async () => {
    const res = await deleteTenantData(db, 'ghost');
    expect(res).toEqual({ connections: 0, auditEntries: 0, user: false });
  });
});
