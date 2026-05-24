#!/usr/bin/env node
/**
 * MCP server entrypoint. Speaks stdio. All logging goes to stderr.
 *
 * Tools:
 *   ping                       — health check
 *   padi_count_dives           — aggregate count
 *   padi_list_dives            — most recent first
 *   padi_get_dive              — full detail
 *   padi_search_dive_sites     — autocomplete
 *   padi_create_dive           — create + readback
 *   padi_update_dive           — update + readback
 *   padi_delete_dive           — delete (sandbox-guarded)
 *   padi_refresh_session       — replace inputs/session.json
 *   padi_dry_run               — preview create/update payload
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  loadSession,
  replaceSession,
  secondsUntilExpiry,
  SessionMissingError,
  type Session,
} from './session.js';
import { listDives } from './operations/list-dives.js';
import { getDive } from './operations/get-dive.js';
import { countDives } from './operations/count-dives.js';
import { searchDiveSites } from './operations/search-dive-sites.js';
import { createDive, buildInsertGeneral } from './operations/create-dive.js';
import { updateDive, buildUpdateVariables } from './operations/update-dive.js';
import { deleteDive, logDeletion } from './operations/delete-dive.js';
import { DiveInput, DiveUpdate } from './types.js';
import { buildSessionFromCurl } from './curl-parser.js';

const SANDBOX_TITLE_PREFIX = 'MCPTEST_';
const SANDBOX_DATE_CUTOFF = '1950-01-01';

function asText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function isSandboxDive(dive: { dive_title: string | null; dive_date: string | null }): boolean {
  const titleOk = (dive.dive_title ?? '').startsWith(SANDBOX_TITLE_PREFIX);
  const dateOk = (dive.dive_date ?? '') < SANDBOX_DATE_CUTOFF;
  return titleOk || dateOk;
}

async function main(): Promise<void> {
  // Best-effort session load. The server still starts even if there's no
  // session (so the MCP inspector can poke at ping and refresh_session).
  try {
    await loadSession();
  } catch (e) {
    if (e instanceof SessionMissingError) {
      console.error(`startup: ${e.message}`);
    } else {
      throw e;
    }
  }

  const server = new McpServer({
    name: 'padi-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'ping',
    {
      description: 'Health check. Returns "pong" and JWT expiry info if a session is loaded.',
      inputSchema: {},
    },
    async () => {
      let expiry = 'no session loaded';
      try {
        const secs = secondsUntilExpiry();
        expiry = secs === null ? 'no exp claim' : `${secs}s until expiry`;
      } catch {
        // ignore
      }
      return asText({ status: 'pong', session: expiry, time: new Date().toISOString() });
    },
  );

  server.registerTool(
    'padi_count_dives',
    {
      description: 'Return the total number of dives in the authenticated user\'s logbook.',
      inputSchema: {},
    },
    async () => asText({ count: await countDives() }),
  );

  server.registerTool(
    'padi_list_dives',
    {
      description:
        'List dives, most recent first. Returns summaries (id, title, date, location, status). ' +
        'No side effects.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) => asText(await listDives(args)),
  );

  server.registerTool(
    'padi_get_dive',
    {
      description: 'Fetch the full record for one dive by id. No side effects.',
      inputSchema: { diveId: z.number().int().positive() },
    },
    async ({ diveId }) => {
      const dive = await getDive(diveId);
      if (!dive) return asText({ error: 'not found', diveId });
      return asText(dive);
    },
  );

  server.registerTool(
    'padi_search_dive_sites',
    {
      description:
        'Autocomplete dive site names. The query is wrapped with SQL LIKE wildcards ' +
        'automatically — pass a plain substring. No side effects.',
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => asText(await searchDiveSites(query)),
  );

  server.registerTool(
    'padi_create_dive',
    {
      description:
        'Create a new dive log. Required: dive_title, dive_date (YYYY-MM-DD). ' +
        'Defaults: log_type=Recreational, status=Publish. Returns the new dive id and the ' +
        'full record after re-fetch. ENUM hints: dive_type [Boat|Shore|Other], water_type ' +
        '[Salt|Fresh], weather [Partly Cloudy|Cloudy|Sunny|Rainy], visibility [High|Average|Low], ' +
        'wave_condition [NoWaves|SmallWaves|MediumWaves|LargeWaves], current ' +
        '[NoCurrent|SomeCurrent|MediumCurrent|StrongCurrent], surge ' +
        '[LightSurge|SomeSurge|MediumSurge|StrongSurge], suit_type ' +
        '[None|Shorty|FullSuit3mm|FullSuit5mm|FullSuit7mm|SemiDry|DrySuit], cylinder_type ' +
        '[Aluminum|Steel|Other], gas_mixture [Air|Nitrox32|Nitrox36|Enriched|Trimix], feeling ' +
        '[Amazing|Good|Average|Poor]. SIDE EFFECT: writes to the real PADI logbook.',
      inputSchema: DiveInput.shape,
    },
    async (args) => {
      const input = DiveInput.parse(args);
      const id = await createDive(input);
      const fetched = await getDive(id);
      return asText({ created: { id }, dive: fetched });
    },
  );

  server.registerTool(
    'padi_update_dive',
    {
      description:
        'Update an existing dive. Pass diveId plus any subset of fields. Missing fields are ' +
        'preserved (we read the dive first and merge). Returns the dive after re-fetch. ' +
        'SIDE EFFECT: writes to the real PADI logbook.',
      inputSchema: DiveUpdate.shape,
    },
    async (args) => {
      const input = DiveUpdate.parse(args);
      await updateDive(input);
      const fetched = await getDive(input.diveId);
      return asText({ updated: input.diveId, dive: fetched });
    },
  );

  server.registerTool(
    'padi_delete_dive',
    {
      description:
        'Delete a dive. Tries hard-delete → per-table → soft-delete in order until one ' +
        'succeeds. Refuses to delete a dive whose title does NOT start with MCPTEST_ AND ' +
        `whose date is on or after ${SANDBOX_DATE_CUTOFF}, unless iAmSureThisIsNotARealDive ` +
        'is true. SIDE EFFECT: irreversibly removes the dive from the PADI logbook.',
      inputSchema: {
        diveId: z.number().int().positive(),
        confirm: z.literal(true),
        iAmSureThisIsNotARealDive: z.boolean().optional(),
      },
    },
    async ({ diveId, iAmSureThisIsNotARealDive }) => {
      const dive = await getDive(diveId);
      if (!dive) return asText({ error: 'not found', diveId });
      if (!isSandboxDive(dive) && !iAmSureThisIsNotARealDive) {
        return asText({
          error: 'sandbox-guard',
          diveId,
          dive_title: dive.dive_title,
          dive_date: dive.dive_date,
          message:
            `Refusing to delete: title does not start with ${SANDBOX_TITLE_PREFIX} and date ` +
            `is on/after ${SANDBOX_DATE_CUTOFF}. Set iAmSureThisIsNotARealDive=true to override.`,
        });
      }
      let strategy: string;
      try {
        strategy = await deleteDive(diveId);
        await logDeletion(diveId, dive.dive_title, dive.dive_date, strategy as never, 'success', 'mcp');
      } catch (e) {
        await logDeletion(diveId, dive.dive_title, dive.dive_date, 'hard', 'failed', 'mcp');
        throw e;
      }
      return asText({ deleted: diveId, strategy });
    },
  );

  server.registerTool(
    'padi_refresh_session',
    {
      description:
        'Replace inputs/session.json with a fresh capture. Pass either `curl` (the raw cURL ' +
        'copied from Chrome DevTools Network panel) OR the four explicit fields. The cURL ' +
        'path is preferred because it picks up the User-Agent automatically.',
      inputSchema: {
        curl: z.string().optional(),
        authorization: z.string().optional(),
        affiliate_id: z.string().optional(),
        x_platform: z.string().optional(),
        user_agent: z.string().optional(),
      },
    },
    async (args) => {
      let next: Session;
      if (args.curl) {
        next = buildSessionFromCurl(args.curl);
      } else {
        if (!args.authorization || !args.affiliate_id) {
          return asText({
            error:
              'pass either `curl` or both `authorization` and `affiliate_id` at minimum',
          });
        }
        next = {
          endpoint: 'https://logbook.global-prod.padi.com/api/Logbook',
          authorization: args.authorization,
          affiliate_id: args.affiliate_id,
          x_platform: args.x_platform ?? 'web',
          user_agent: args.user_agent ?? '',
          cognito_sub: '',
        };
      }
      await replaceSession(next);
      const secs = secondsUntilExpiry();
      return asText({
        refreshed: true,
        affiliate_id: next.affiliate_id,
        expires_in_seconds: secs,
      });
    },
  );

  server.registerTool(
    'padi_dry_run',
    {
      description:
        'Preview the GraphQL payload that would be sent for a create or update. No side ' +
        'effects. Useful for sanity-checking enum values and field shapes before committing.',
      inputSchema: {
        operation: z.enum(['create', 'update']),
        input: z.record(z.string(), z.unknown()),
      },
    },
    async ({ operation, input }) => {
      if (operation === 'create') {
        const parsed = DiveInput.parse(input);
        return asText({ operation: 'create', general: buildInsertGeneral(parsed) });
      }
      const parsed = DiveUpdate.parse(input);
      return asText({
        operation: 'update',
        variables: await buildUpdateVariables(parsed),
      });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('padi-mcp: server connected (stdio)');
}

main().catch((e) => {
  console.error('padi-mcp: fatal', e);
  process.exit(1);
});
