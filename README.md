# padi-mcp

A local MCP server that exposes the PADI dive logbook (recreational dives) as
tools an LLM can call. Lets you list, fetch, create, update, and delete dives
in your own PADI account via Claude Desktop or any MCP client.

PADI has no public API. This server talks to the same Hasura GraphQL
endpoint the `learning.padi.com` web app uses, with your own auth token.

## Status

Built phases 0–5 (bootstrap through MCP tool surface). Live verification
(read round-trip, create/update/delete lifecycle, enum probing) requires a
JWT capture — see "Capture a session" below.

See [`docs/discovered-schema.md`](docs/discovered-schema.md) for the full
schema, GraphQL operations, and known quirks.

## Tools

| Tool | What it does |
|---|---|
| `ping` | Health check + JWT expiry info |
| `padi_count_dives` | Total dive count |
| `padi_list_dives` | Most recent first; `limit` + `offset` |
| `padi_get_dive` | Full detail by id |
| `padi_search_dive_sites` | Autocomplete by name substring |
| `padi_create_dive` | Create a new dive (writes to your real logbook) |
| `padi_update_dive` | Patch any subset of fields by id |
| `padi_delete_dive` | Sandbox-guarded delete (tries hard → per-table → soft) |
| `padi_refresh_session` | Replace the loaded JWT mid-session |
| `padi_dry_run` | Preview the GraphQL payload that would be sent |

## Setup

```bash
npm install
npm run build
```

### Capture a session

PADI's JWT lives in the browser. To get one for the server:

1. Open Chrome at <https://learning.padi.com> and sign in.
2. Open DevTools → Network tab, type `Logbook` in the filter box.
3. Navigate to the dive logbook page so a request fires.
4. Right-click any successful `POST /api/Logbook` row → Copy → **Copy as cURL**.
5. Paste into a scratch file, e.g. `scratch.txt`.
6. Run:

   ```bash
   npm run curl-to-session -- scratch.txt
   ```

   That writes `inputs/session.json` with the JWT, affiliate id, user-agent
   and a decoded `cognito_sub`.

The JWT expires **1 hour** after it was issued by Cognito. When it does,
re-capture with the same flow and re-run the script — or call the
`padi_refresh_session` MCP tool with the new cURL string.

### Install in Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`
(merging with any existing `mcpServers`):

```json
{
  "mcpServers": {
    "padi": {
      "command": "node",
      "args": ["/absolute/path/to/padi-mcp/dist/index.js"]
    }
  }
}
```

Then `Cmd-Q` Claude Desktop and reopen it. The PADI tools appear in the
tool picker.

## Sandbox conventions

The MCP server **refuses to delete** any dive unless:

- title starts with `MCPTEST_`, **or**
- date is before `1950-01-01`, **or**
- the caller passes `iAmSureThisIsNotARealDive: true` (logged to `docs/deletions.log`).

Lifecycle / enum-probe scripts always use the test markers and clean up
after themselves.

## Scripts

```bash
npm run dev                      # run via tsx (no build needed)
npm test                         # vitest (transforms etc.)
npm run probe -- count           # quick read smoke test
npm run probe -- list 5
npm run probe -- get 20716851
npm run probe -- search "South Point"
npm run lifecycle                # full CRUD sweep (creates+deletes a sandbox dive)
npm run enum-probe               # write every candidate enum and read back
```

## Repo layout

```
src/
├── index.ts            MCP server entrypoint (stdio)
├── padi-client.ts      fetch-based GraphQL client
├── session.ts          session.json loader + JWT decode
├── curl-parser.ts      Chrome cURL → Session helper
├── types.ts            Zod schemas (raw wire + canonical)
├── transforms/         date/number coercion
└── operations/         one file per GraphQL operation
scripts/
├── curl-to-session.ts  Paste a cURL → write inputs/session.json
├── har-to-session.ts   Pull samples from a HAR (auth gets stripped by Chrome)
├── probe.ts            CLI: count / list / get / search
├── test-lifecycle.ts   CRUD round-trip
└── enum-probe.ts       Probe candidate enum values
docs/
├── progress.md         persistent build log
├── discovered-schema.md the brief, plus live additions
├── enums.md            confirmed/rejected enum values
├── field-mapping.md    UI ↔ GraphQL field map
├── anomalies.md        weird responses
└── deletions.log       audit of every delete
inputs/                 (gitignored) session.json + HAR captures
samples/                (gitignored) one GraphQL payload per captured op
```
