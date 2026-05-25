/**
 * Managed MCP endpoint (Streamable HTTP) via Vercel's mcp-handler, protected by
 * WorkOS AuthKit OAuth (withMcpAuth). Claude does the OAuth handshake against
 * AuthKit (discovered via Protected Resource Metadata at
 * /.well-known/oauth-protected-resource), then sends a bearer token we verify
 * per request. The verified user id is the tenant key — never taken from tool
 * arguments. Each tool loads that tenant's PADI connection, mints an ID token,
 * and calls PADI.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { countDives } from '@padi-mcp/core';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { connectUrl } from '@/lib/current-user';
import { getDb } from '@/lib/db/client';
import { verifyWorkosToken } from '@/lib/mcp-auth';
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

function userIdFrom(extra: { authInfo?: AuthInfo }): string {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== 'string' || !id) {
    throw new Error('Authenticated user id missing from token.');
  }
  return id;
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
      'padi_count_dives',
      {
        title: 'Count dives',
        description: "Return the total number of dives in the caller's connected PADI logbook.",
        inputSchema: {},
      },
      async (_args, extra) => {
        try {
          const userId = userIdFrom(extra as { authInfo?: AuthInfo });
          const ctx = await getTenantContext(getDb(), userId);
          return text({ count: await countDives(ctx) });
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

const handler = withMcpAuth(base, verifyWorkosToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

export { handler as GET, handler as POST, handler as DELETE };
