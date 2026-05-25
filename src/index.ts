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
import { CognitoAuthError } from './auth/cognito.js';
import { buildSessionFromCurl } from './curl-parser.js';
import { countDives } from './operations/count-dives.js';
import { buildInsertGeneral, createDive } from './operations/create-dive.js';
import { deleteDive, logDeletion } from './operations/delete-dive.js';
import { getDive } from './operations/get-dive.js';
import { listDives } from './operations/list-dives.js';
import { searchDiveSites } from './operations/search-dive-sites.js';
import { buildUpdateVariables, updateDive } from './operations/update-dive.js';
import {
  type Session,
  SessionMissingError,
  authStatus,
  loadSession,
  login,
  logout,
  replaceSession,
  secondsUntilExpiry,
} from './session.js';
import { DiveInput, DiveUpdate } from './types.js';

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
    'padi_login',
    {
      description:
        'Log in to PADI with your email and password. The server authenticates against ' +
        "PADI's Cognito and stores a refresh token so it can keep itself signed in for ~30 days " +
        '— you do NOT need to capture a cURL or re-log-in every hour. Set remember_password=true ' +
        'to also store your password (in the macOS Keychain when available) so it can re-login ' +
        'automatically even after the refresh token expires. Your password is never echoed or logged.',
      inputSchema: {
        email: z.string().min(1),
        password: z.string().min(1),
        remember_password: z.boolean().optional(),
      },
    },
    async ({ email, password, remember_password }) => {
      try {
        await login(email, password, remember_password ?? false);
        const status = authStatus();
        return asText({
          logged_in: true,
          affiliate_id: status.affiliate_id,
          id_token_expires_in_seconds: status.id_token_expires_in_seconds,
          refresh_token_stored: status.has_refresh_token,
          password_stored: remember_password ?? false,
        });
      } catch (e) {
        if (e instanceof CognitoAuthError) {
          return asText({ logged_in: false, error: e.code, message: e.message });
        }
        return asText({ logged_in: false, error: 'unknown', message: String(e) });
      }
    },
  );

  server.registerTool(
    'padi_logout',
    {
      description:
        'Clear the stored PADI session: removes the refresh token, cached ID token, and any ' +
        'stored password. You will need to padi_login again afterwards.',
      inputSchema: {},
    },
    async () => {
      await logout();
      return asText({ logged_out: true });
    },
  );

  server.registerTool(
    'padi_auth_status',
    {
      description:
        'Report the current PADI auth state: whether you are logged in, whether a refresh token ' +
        'is present (auto-refresh enabled), seconds until the current ID token expires, and the ' +
        'affiliate id. No secrets are returned.',
      inputSchema: {},
    },
    async () => asText(authStatus()),
  );

  server.registerTool(
    'padi_count_dives',
    {
      description: "Return the total number of dives in the authenticated user's logbook.",
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
        'full record after re-fetch. ENUM hints (all confirmed against live API): ' +
        'log_type [Recreational|Training], dive_type [Boat|BeachShore|Other], ' +
        'status [Publish|Draft|Pending], water_type [Salt|Fresh], ' +
        'body_of_water [Ocean|Lake|Quarry|River|Other], ' +
        'weather [Sunny|Partly Cloudy|Cloudy|Rainy|Windy|Foggy], visibility [High|Average|Low], ' +
        'wave_condition [NoWaves|SmallWaves|MediumWaves|LargeWaves], current ' +
        '[NoCurrent|SomeCurrent|MediumCurrent|StrongCurrent], surge ' +
        '[NoSurge|SomeSurge|MediumSurge|BigSurge], suit_type ' +
        '[NoExposure|Shorty|FullSuit_3mm|FullSuit_5mm|FullSuit_7mm|SemiDrySuit|DrySuit], ' +
        'weight_type [Light|Good|Heavy], cylinder_type [Aluminum|Steel|Other], gas_mixture ' +
        '[Air|Enriched_32|Enriched_36|Enriched_40|Enriched|Trimix|Heliox|Rebreather|Nitrox], ' +
        'feeling [Amazing|Good|Average|Poor]. additional_equipment is a string array, e.g. ' +
        '["Camera","Light"]. When picking Enriched_32/36/40, ALSO set oxygen= and nitrogen= ' +
        'to match (e.g. Enriched_32 → oxygen:32, nitrogen:68) — the API does not enforce ' +
        'consistency. SIDE EFFECT: writes to the real PADI logbook.',
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
        await logDeletion(
          diveId,
          dive.dive_title,
          dive.dive_date,
          strategy as never,
          'success',
          'mcp',
        );
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
        'ADVANCED / fallback. Replace the session from a raw cURL captured in Chrome DevTools ' +
        '(or explicit fields). Prefer padi_login instead — it logs in with email+password and ' +
        'enables automatic token refresh. Use this only if you cannot log in directly (e.g. an ' +
        'account that requires the browser flow). A cURL-only session has no refresh token, so ' +
        'it still expires after ~1 hour.',
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
            error: 'pass either `curl` or both `authorization` and `affiliate_id` at minimum',
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
      const { persisted, path, persistError } = await replaceSession(next);
      const secs = secondsUntilExpiry();
      return asText({
        refreshed: true,
        affiliate_id: next.affiliate_id,
        expires_in_seconds: secs,
        persisted,
        session_path: path,
        ...(persistError ? { persist_error: persistError } : {}),
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
