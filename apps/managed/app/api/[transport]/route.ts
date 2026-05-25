/**
 * Managed MCP endpoint (Streamable HTTP) via Vercel's mcp-handler.
 *
 * Tools resolve the caller's tenant id (Phase 3: a dev stub; Phase 4: the
 * WorkOS AuthKit session), load that tenant's PADI connection, mint an ID
 * token, and call PADI. If no account is connected the tool returns the
 * /connect URL instead of failing opaquely.
 *
 * Connect a Streamable HTTP MCP client to /api/mcp.
 */
import { countDives } from '@padi-mcp/core';
import { createMcpHandler } from 'mcp-handler';
import { connectUrl, getCurrentUserId } from '@/lib/current-user';
import { getDb } from '@/lib/db/client';
import { NeedsReloginError, NotConnectedError, getTenantContext } from '@/lib/tokens';

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

async function withTenant<T>(run: (ctx: Awaited<ReturnType<typeof getTenantContext>>) => Promise<T>) {
  const userId = await getCurrentUserId();
  const ctx = await getTenantContext(getDb(), userId);
  return run(ctx);
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'ping',
      {
        title: 'Ping',
        description: 'Health check. Returns "pong" and the server time. No auth required.',
        inputSchema: {},
      },
      async () => text({ status: 'pong', time: new Date().toISOString() }),
    );

    server.registerTool(
      'padi_count_dives',
      {
        title: 'Count dives',
        description: "Return the total number of dives in the caller's connected PADI logbook.",
        inputSchema: {},
      },
      async () => {
        try {
          return await withTenant(async (ctx) => text({ count: await countDives(ctx) }));
        } catch (e) {
          if (e instanceof NotConnectedError) {
            return text({ error: 'not_connected', message: 'Connect your PADI account first.', connect_url: connectUrl() });
          }
          if (e instanceof NeedsReloginError) {
            return text({ error: 'needs_relogin', message: 'Your PADI session expired. Reconnect.', connect_url: connectUrl() });
          }
          throw e;
        }
      },
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

export { handler as GET, handler as POST, handler as DELETE };
