# padi-mcp

A local MCP server that exposes the PADI dive logbook (recreational dives) as
tools an LLM can call. Lets you list, fetch, create, update, and delete dives
in your own PADI account via Claude Desktop or any MCP client.

PADI has no public API. This server talks to the same Hasura GraphQL
endpoint the `learning.padi.com` web app uses, with your own auth token.

## Status

Fully working against the live PADI logbook. All MCP tools are exercised by an
end-to-end stdio smoke test (`npm run mcp-smoke`). Authentication is via
`padi_login` (PADI email + password → Cognito), which auto-refreshes the
1-hour ID token from a stored refresh token; the older cURL-capture flow is
kept as a fallback.

See [`docs/discovered-schema.md`](docs/discovered-schema.md) for the full
schema and GraphQL operations, [`docs/enums.md`](docs/enums.md) for the
confirmed/rejected enum values, and [`docs/anomalies.md`](docs/anomalies.md)
for the four spots where the brief was wrong about wire shape.

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
| `padi_login` | Log in with PADI email + password; enables auto-refresh |
| `padi_logout` | Clear the stored session and any saved password |
| `padi_auth_status` | Report login state + token expiry (no secrets) |
| `padi_refresh_session` | Advanced/fallback: load a session from a raw cURL |
| `padi_dry_run` | Preview the GraphQL payload that would be sent |

## Setup

```bash
npm install
npm run build
```

### Log in (recommended)

The server authenticates against PADI's Cognito and keeps itself signed in.
You log in **once** with your PADI email + password; it stores the refresh
token and silently mints a fresh 1-hour ID token whenever the old one expires
— no more re-capturing a cURL every hour.

From the terminal:

```bash
npm run login                 # prompts for email + password
npm run login -- you@x.com --remember   # also store the password for hands-off forever
```

Or, inside Claude, just say: *"Log into PADI, my email is … and password is …"*
(calls the `padi_login` tool).

- The **refresh token** lasts ~30 days. Within that window the server
  re-authenticates automatically; you do nothing.
- `--remember` / `remember_password: true` additionally stores your password
  (in the **macOS Keychain** when available, otherwise an AES-encrypted file in
  `inputs/`) so the server can re-login even after the refresh token expires —
  truly zero-touch. Off by default; your password is never logged or echoed.
- Check state any time with the `padi_auth_status` tool; sign out with
  `padi_logout`.

Override the Cognito target if PADI ever changes it via `PADI_COGNITO_REGION` /
`PADI_COGNITO_CLIENT_ID`.

### Capture a session from a cURL (advanced / fallback)

If you can't log in directly, you can still load a short-lived session from a
browser capture (note: a cURL-only session has **no** refresh token, so it
still expires after ~1 hour):

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

A cURL-captured JWT expires **1 hour** after Cognito issued it, with no way to
renew it — that's why `padi_login` is the recommended path. If you do use the
cURL flow, re-capture and re-run the script (or call `padi_refresh_session`)
each hour.

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

The server resolves `inputs/session.json` relative to its own location
(next to `dist/`), not the launch directory — so it works regardless of
the working directory Claude Desktop starts it in. To keep the session
file somewhere else, set `PADI_SESSION_PATH` to an absolute path:

```json
{
  "mcpServers": {
    "padi": {
      "command": "node",
      "args": ["/absolute/path/to/padi-mcp/dist/index.js"],
      "env": { "PADI_SESSION_PATH": "/absolute/path/to/session.json" }
    }
  }
}
```

When the JWT expires, call the `padi_refresh_session` tool with a fresh
cURL — no restart needed. The response includes `persisted` and
`session_path` so you can confirm where it was saved.

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
npm run login                    # log in with PADI email + password (enables auto-refresh)
npm test                         # vitest (transforms, cognito, session, credential store)
npm run probe -- count           # quick read smoke test
npm run probe -- list 5
npm run probe -- get 20716851
npm run probe -- search "South Point"
npm run lifecycle                # full CRUD sweep (creates+deletes a sandbox dive)
npm run enum-probe               # write every candidate enum and read back
npm run enum-probe-extra         # targeted second-pass probe for gap fields
npm run mcp-smoke                # build + drive the stdio server end-to-end via JSON-RPC
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
├── enum-probe.ts       Probe candidate enum values
├── enum-probe-extra.ts Second-pass probe for gap fields + additional_equipment shape
├── probe-array.ts      One-shot pg-array literal shape probe
└── mcp-smoke.ts        Drive the stdio MCP server end-to-end via JSON-RPC
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
