/**
 * Managed MCP endpoint (Streamable HTTP) via Vercel's mcp-handler.
 *
 * Phase 1: a static, single-tenant endpoint exposing `ping` and
 * `padi_count_dives`, wired to the dev token provider. Layer-1 caller auth
 * (WorkOS AuthKit) and per-tenant token minting arrive in later phases; for
 * now this proves the transport + tool registration end to end.
 *
 * Connect a Streamable HTTP MCP client to /api/mcp.
 */
import { countDives } from '@padi-mcp/core';
import { createMcpHandler } from 'mcp-handler';
import { DevProviderNotConfiguredError, devContext } from '@/lib/dev-context';

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
        description:
          "Return the total number of dives in the connected PADI logbook. (Phase 1: uses a " +
          'single dev account configured via PADI_DEV_REFRESH_TOKEN.)',
        inputSchema: {},
      },
      async () => {
        try {
          return text({ count: await countDives(devContext()) });
        } catch (e) {
          if (e instanceof DevProviderNotConfiguredError) {
            return text({ error: 'not_configured', message: e.message });
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
