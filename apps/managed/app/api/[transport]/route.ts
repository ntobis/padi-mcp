/**
 * Managed MCP endpoint (Streamable HTTP) via Vercel's mcp-handler, protected by
 * WorkOS AuthKit OAuth (withMcpAuth). Claude does the OAuth handshake against
 * AuthKit (discovered via Protected Resource Metadata at
 * /.well-known/oauth-protected-resource), then sends a bearer token we verify
 * per request. The verified user id is the tenant key — never taken from tool
 * arguments. Each tool loads that tenant's PADI connection, mints an ID token,
 * and calls PADI. Writes (create/update/delete) are recorded in audit_log.
 */
import { deleteTenantData, disconnectPadiAccount, exportTenantData } from '@/lib/account';
import { connectUrl } from '@/lib/current-user';
import { type AppDb, getDb } from '@/lib/db/client';
import { auditLog } from '@/lib/db/schema';
import { verifyWorkosToken } from '@/lib/mcp-auth';
import { checkServiceGate } from '@/lib/kill-switch';
import { checkRateLimit } from '@/lib/ratelimit';
import {
  NeedsReloginError,
  NotConnectedError,
  getConnectionStatus,
  getTenantContext,
} from '@/lib/tokens';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  DiveInput,
  DiveUpdate,
  type PadiContext,
  countDives,
  createDive,
  deleteDive,
  getDive,
  listDives,
  searchDiveSites,
  updateDive,
} from '@padi-mcp/core';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';

type Extra = { authInfo?: AuthInfo };

// Sandbox-delete guard (mirrors the local server). Refuse to delete a dive
// unless it looks like a test fixture — title prefixed MCPTEST_ or dated before
// 1950 — or the caller explicitly overrides. Protects a real logbook from an
// accidental delete-by-voice.
const SANDBOX_TITLE_PREFIX = 'MCPTEST_';
const SANDBOX_DATE_CUTOFF = '1950-01-01';

function isSandboxDive(dive: { dive_title: string | null; dive_date: string | null }): boolean {
  const titleOk = (dive.dive_title ?? '').startsWith(SANDBOX_TITLE_PREFIX);
  const dateOk = (dive.dive_date ?? '') < SANDBOX_DATE_CUTOFF;
  return titleOk || dateOk;
}

function text(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function userIdFrom(extra: Extra): string {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== 'string' || !id) {
    throw new Error('Authenticated user id missing from token.');
  }
  return id;
}

/**
 * Resolve the tenant, run the operation against its PADI context, and map the
 * two "reconnect needed" cases to friendly results with a connect URL. Any
 * other error propagates as a tool error.
 */
function rateLimited(kind: 'tool' | 'write', limit: number) {
  return text({
    error: 'rate_limited',
    kind,
    limit,
    message:
      kind === 'write'
        ? 'Write rate limit exceeded for your account; try again shortly.'
        : 'Rate limit exceeded for your account; slow down and try again shortly.',
  });
}

async function withTenant(
  extra: Extra,
  fn: (scope: { ctx: PadiContext; db: AppDb; userId: string }) => Promise<unknown>,
) {
  const userId = userIdFrom(extra);
  const gate = checkServiceGate(userId);
  if (gate.blocked) return text({ error: gate.error, message: gate.message });
  const toolLimit = await checkRateLimit(userId, 'tool');
  if (!toolLimit.allowed) return rateLimited('tool', toolLimit.limit);
  const db = getDb();
  try {
    const ctx = await getTenantContext(db, userId);
    return text(await fn({ ctx, db, userId }));
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return text({
        error: 'not_connected',
        message: 'Connect your PADI account first.',
        connect_url: connectUrl(),
      });
    }
    if (e instanceof NeedsReloginError) {
      return text({
        error: 'needs_relogin',
        message: 'Your PADI session expired. Reconnect.',
        connect_url: connectUrl(),
      });
    }
    throw e;
  }
}

/**
 * Like withTenant but without loading a PADI context — for account-management
 * tools (disconnect / export / delete) that act on our own stored data and must
 * work even when the PADI connection is missing or needs re-login.
 */
async function withAccount(
  extra: Extra,
  fn: (scope: { db: AppDb; userId: string }) => Promise<unknown>,
) {
  const userId = userIdFrom(extra);
  const gate = checkServiceGate(userId, { allowAccountTools: true });
  if (gate.blocked) return text({ error: gate.error, message: gate.message });
  const toolLimit = await checkRateLimit(userId, 'tool');
  if (!toolLimit.allowed) return rateLimited('tool', toolLimit.limit);
  return text(await fn({ db: getDb(), userId }));
}

function recordWrite(
  db: AppDb,
  userId: string,
  action: 'create_dive' | 'update_dive' | 'delete_dive',
  diveId: number | null,
  detail: Record<string, unknown>,
): Promise<unknown> {
  return db.insert(auditLog).values({ workosUserId: userId, action, diveId, detail });
}

const base = createMcpHandler(
  (server) => {
    server.registerTool(
      'ping',
      {
        title: 'Ping',
        description: 'Health check. Returns "pong" and the server time.',
        inputSchema: {},
      },
      async () => text({ status: 'pong', time: new Date().toISOString() }),
    );

    server.registerTool(
      'padi_connection_status',
      {
        title: 'PADI connection status',
        description:
          'Report whether the caller has a PADI account connected, its status, affiliate id, ' +
          'and when the session was last refreshed. Makes no PADI API call.',
        inputSchema: {},
      },
      async (_args, extra) => {
        const userId = userIdFrom(extra as Extra);
        const status = await getConnectionStatus(getDb(), userId);
        return text(status.connected ? status : { ...status, connect_url: connectUrl() });
      },
    );

    server.registerTool(
      'padi_count_dives',
      {
        title: 'Count dives',
        description: "Return the total number of dives in the caller's connected PADI logbook.",
        inputSchema: {},
      },
      async (_args, extra) =>
        withTenant(extra as Extra, async ({ ctx }) => ({ count: await countDives(ctx) })),
    );

    server.registerTool(
      'padi_list_dives',
      {
        title: 'List dives',
        description:
          'List dives, most recent first. Returns summaries (id, title, date, location, ' +
          'status). No side effects.',
        inputSchema: {
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async (args, extra) =>
        withTenant(extra as Extra, async ({ ctx }) => await listDives(ctx, args)),
    );

    server.registerTool(
      'padi_get_dive',
      {
        title: 'Get dive',
        description: 'Fetch the full record for one dive by id. No side effects.',
        inputSchema: { diveId: z.number().int().positive() },
      },
      async ({ diveId }, extra) =>
        withTenant(extra as Extra, async ({ ctx }) => {
          const dive = await getDive(ctx, diveId);
          return dive ?? { error: 'not_found', diveId };
        }),
    );

    server.registerTool(
      'padi_search_dive_sites',
      {
        title: 'Search dive sites',
        description:
          'Autocomplete dive site names. The query is wrapped with SQL LIKE wildcards ' +
          'automatically — pass a plain substring. No side effects.',
        inputSchema: { query: z.string().min(1) },
      },
      async ({ query }, extra) =>
        withTenant(extra as Extra, async ({ ctx }) => await searchDiveSites(ctx, query)),
    );

    server.registerTool(
      'padi_create_dive',
      {
        title: 'Create dive',
        description:
          'Create a new dive log. Required: dive_title, dive_date (YYYY-MM-DD). Defaults: ' +
          'log_type=Recreational, status=Publish. Returns the new dive id and the full record ' +
          'after re-fetch. SIDE EFFECT: writes to the connected PADI logbook.',
        inputSchema: DiveInput.shape,
      },
      async (args, extra) =>
        withTenant(extra as Extra, async ({ ctx, db, userId }) => {
          const writeLimit = await checkRateLimit(userId, 'write');
          if (!writeLimit.allowed)
            return { error: 'rate_limited', kind: 'write', limit: writeLimit.limit };
          const input = DiveInput.parse(args);
          const id = await createDive(ctx, input);
          const dive = await getDive(ctx, id);
          await recordWrite(db, userId, 'create_dive', id, {
            dive_title: input.dive_title,
            dive_date: input.dive_date,
          });
          return { created: { id }, dive };
        }),
    );

    server.registerTool(
      'padi_update_dive',
      {
        title: 'Update dive',
        description:
          'Update an existing dive. Pass diveId plus any subset of fields; missing fields are ' +
          'preserved (the dive is read first and merged). Returns the dive after re-fetch. ' +
          'SIDE EFFECT: writes to the connected PADI logbook.',
        inputSchema: DiveUpdate.shape,
      },
      async (args, extra) =>
        withTenant(extra as Extra, async ({ ctx, db, userId }) => {
          const writeLimit = await checkRateLimit(userId, 'write');
          if (!writeLimit.allowed)
            return { error: 'rate_limited', kind: 'write', limit: writeLimit.limit };
          const input = DiveUpdate.parse(args);
          await updateDive(ctx, input);
          const dive = await getDive(ctx, input.diveId);
          await recordWrite(db, userId, 'update_dive', input.diveId, {
            fields: Object.keys(input).filter((k) => k !== 'diveId'),
          });
          return { updated: input.diveId, dive };
        }),
    );

    server.registerTool(
      'padi_delete_dive',
      {
        title: 'Delete dive',
        description:
          'Delete a dive. Tries hard-delete → per-table → soft-delete until one succeeds. ' +
          'Requires confirm=true. Refuses to delete a dive whose title does NOT start with ' +
          'MCPTEST_ AND whose date is on or after 1950-01-01, unless ' +
          'iAmSureThisIsNotARealDive=true. SIDE EFFECT: irreversibly removes the dive from the ' +
          'PADI logbook.',
        inputSchema: {
          diveId: z.number().int().positive(),
          confirm: z.literal(true),
          iAmSureThisIsNotARealDive: z.boolean().optional(),
        },
      },
      async ({ diveId, iAmSureThisIsNotARealDive }, extra) =>
        withTenant(extra as Extra, async ({ ctx, db, userId }) => {
          const writeLimit = await checkRateLimit(userId, 'write');
          if (!writeLimit.allowed)
            return { error: 'rate_limited', kind: 'write', limit: writeLimit.limit };
          const existing = await getDive(ctx, diveId);
          if (!existing) return { error: 'not_found', diveId };
          const sandbox = isSandboxDive(existing);
          if (!sandbox && !iAmSureThisIsNotARealDive) {
            return {
              error: 'sandbox_guard',
              diveId,
              dive_title: existing.dive_title,
              dive_date: existing.dive_date,
              message:
                `Refusing to delete: title does not start with ${SANDBOX_TITLE_PREFIX} and date ` +
                `is on/after ${SANDBOX_DATE_CUTOFF}. Set iAmSureThisIsNotARealDive=true to override.`,
            };
          }
          const strategy = await deleteDive(ctx, diveId);
          await recordWrite(db, userId, 'delete_dive', diveId, {
            strategy,
            dive_title: existing.dive_title,
            dive_date: existing.dive_date,
            sandbox,
            override: !sandbox && iAmSureThisIsNotARealDive === true,
          });
          return { deleted: diveId, strategy };
        }),
    );

    server.registerTool(
      'padi_disconnect',
      {
        title: 'Disconnect PADI account',
        description:
          'Revoke the stored link to your PADI account: deletes the envelope-encrypted refresh ' +
          'token so this service can no longer access your logbook. Your dives in PADI are ' +
          'untouched. Requires confirm=true. You can reconnect any time via the connect page.',
        inputSchema: { confirm: z.literal(true) },
      },
      async (_args, extra) =>
        withAccount(extra as Extra, async ({ db, userId }) => {
          const { disconnected } = await disconnectPadiAccount(db, userId);
          return disconnected
            ? { disconnected: true, message: 'Your PADI account has been disconnected.' }
            : { disconnected: false, message: 'No PADI account was connected.' };
        }),
    );

    server.registerTool(
      'padi_export_my_data',
      {
        title: 'Export my stored data',
        description:
          'Return everything this service stores about you: your account record, PADI connection ' +
          'metadata (affiliate id, username, status, timestamps), and your audit log. The ' +
          'encrypted PADI refresh token is never disclosed. No side effects.',
        inputSchema: {},
      },
      async (_args, extra) =>
        withAccount(extra as Extra, async ({ db, userId }) => await exportTenantData(db, userId)),
    );

    server.registerTool(
      'padi_delete_my_data',
      {
        title: 'Delete all my data',
        description:
          'Permanently erase everything this service stores about you: your PADI connection ' +
          '(including the encrypted token), your audit log, and your account record. Does NOT ' +
          'touch your dives in PADI. Irreversible. Requires confirm=true.',
        inputSchema: { confirm: z.literal(true) },
      },
      async (_args, extra) =>
        withAccount(extra as Extra, async ({ db, userId }) => ({
          deleted: await deleteTenantData(db, userId),
          message: 'All your stored data has been deleted.',
        })),
    );
  },
  {
    serverInfo: { name: 'padi-mcp-managed', version: '1.0.0' },
    capabilities: { tools: {} },
  },
  {
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === 'development',
  },
);

const handler = withMcpAuth(base, verifyWorkosToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

export { handler as GET, handler as POST, handler as DELETE };
