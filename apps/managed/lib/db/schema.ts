/**
 * Drizzle schema for the managed service. Tenant identity is the WorkOS user
 * id (Layer-1 auth); everything is keyed on it. We never store the PADI
 * password — only an envelope-encrypted refresh token (see lib/crypto/envelope).
 */
import {
  bigint,
  bigserial,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  workosUserId: text('workos_user_id').primaryKey(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const padiConnections = pgTable(
  'padi_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workosUserId: text('workos_user_id')
      .notNull()
      .references(() => users.workosUserId, { onDelete: 'cascade' }),
    affiliateId: text('affiliate_id').notNull(),
    cognitoSub: text('cognito_sub').notNull(),
    padiUsername: text('padi_username').notNull(),
    // Envelope-encrypted refresh token, all base64 (see SealedSecret):
    encRefreshToken: text('enc_refresh_token').notNull(),
    encNonce: text('enc_nonce').notNull(),
    wrappedDek: text('wrapped_dek').notNull(),
    status: text('status').notNull().default('active'), // active | needs_relogin | revoked
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('padi_connections_workos_user_id_key').on(t.workosUserId)],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workosUserId: text('workos_user_id').notNull(),
  action: text('action').notNull(), // create_dive | update_dive | delete_dive | connect | relogin
  diveId: bigint('dive_id', { mode: 'number' }),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PadiConnection = typeof padiConnections.$inferSelect;
export type NewPadiConnection = typeof padiConnections.$inferInsert;
