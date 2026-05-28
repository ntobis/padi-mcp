#!/usr/bin/env tsx
/**
 * Protocol smoke test for the managed MCP endpoint. Connects a real Streamable
 * HTTP MCP client (the same transport real MCP clients use), lists tools, and
 * calls ping + padi_count_dives. Requires the dev server running:
 *
 *   npm run dev -w @padi-mcp/managed      # in one terminal
 *   npm run mcp-http-smoke -w @padi-mcp/managed
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://localhost:3000/api/mcp');

async function main(): Promise<void> {
  const client = new Client({ name: 'mcp-http-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  console.log(`connected to ${url.href}`);

  const { tools } = await client.listTools();
  console.log(`tools/list — ${tools.length}: ${tools.map((t) => t.name).join(', ')}`);

  const ping = await client.callTool({ name: 'ping', arguments: {} });
  console.log(`ping — ${textOf(ping)}`);

  const count = await client.callTool({ name: 'padi_count_dives', arguments: {} });
  console.log(`padi_count_dives — ${textOf(count)}`);

  await client.close();
  console.log('OK');
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .map((c) => c.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

main().catch((e) => {
  console.error('smoke FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
