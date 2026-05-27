# PADI MCP

**Talk to your PADI dive logbook in plain language.** An [MCP](https://modelcontextprotocol.io)
server that lets Claude (or any MCP client) read and manage the dives in your own
PADI account — *"how many dives do I have?"*, *"log today's dive at Blue Hole, 28m, 42 min"*,
*"show my last 10 dives."*

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![CI](https://github.com/ntobis/padi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ntobis/padi-mcp/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF.svg)](https://modelcontextprotocol.io)

> [!IMPORTANT]
> **Unofficial & independent.** This project is **not affiliated with, endorsed by, or
> operated by PADI.** PADI has no public API; this server talks to the same backend the
> `learning.padi.com` web app uses, authenticating as **your own account**. Use it for your
> own logbook. See the [disclaimer](#disclaimer).

---

## What you can do

Once it's connected to Claude, just talk to it:

| You say… | It does |
|---|---|
| "How many dives are in my logbook?" | counts your dives |
| "Show me my last 5 dives" | lists recent dives with site, date, depth |
| "What was my deepest dive this year?" | reads details and answers |
| "Log a dive: Blue Hole, today, 28m, 42 min, nitrox 32" | creates the dive in your logbook |
| "Fix the buddy on dive 20749634 to 'Alex'" | updates that dive |

It authenticates **once** with your PADI email + password (via PADI's Cognito), stores only an
encrypted refresh token, and silently renews the short-lived access token after that — no hourly
re-login.

---

## Two ways to run it

- **Local (this repo, open source)** — runs on your machine, uses *your* credentials, connects to
  Claude Desktop or any MCP client over stdio. **This is what the guide below sets up.**
- **Managed (hosted)** — a multi-tenant web service ([`apps/managed/`](apps/managed)) with WorkOS
  sign-in and a browser connect page, reachable as a remote MCP connector. Heavier to operate; see
  its own directory.

---

## Quickstart (local, ~3 minutes)

**Prerequisites:** Node.js ≥ 20, a PADI account, and an MCP client (e.g. Claude Desktop).

```bash
# 1. Clone + install + build
git clone https://github.com/ntobis/padi-mcp.git
cd padi-mcp
npm install
npm run build

# 2. Log in once (stores an encrypted refresh token; your password is not kept)
npm run login                 # prompts for PADI email + password
```

Then add it to Claude Desktop — edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

Quit Claude Desktop (`Cmd-Q`) and reopen it. The PADI tools appear in the tool picker — try
*"how many dives do I have?"*

> Prefer hands-off forever? `npm run login -- you@example.com --remember` also stores your password
> (macOS Keychain, else an AES-encrypted file) so it can re-login even after the ~30-day refresh
> token expires. Off by default.

---

## Authentication

### Recommended: `padi_login`

You log in **once** with your PADI email + password. The server:

- exchanges them with PADI's Cognito for an ID token + a ~30-day refresh token,
- stores **only** the encrypted refresh token (never the password, unless you pass `--remember`),
- silently mints a fresh 1-hour ID token whenever the old one expires.

From the terminal (`npm run login`) or just tell Claude: *"Log into PADI, email … password …"*
(the `padi_login` tool). Check state with `padi_auth_status`; sign out (and wipe any stored
password) with `padi_logout`.

### Fallback: capture a session from a cURL

If you can't log in directly, you can load a short-lived session from a browser capture (note: a
cURL-only session has **no** refresh token, so it expires after ~1 hour):

1. Sign in at <https://learning.padi.com>, open DevTools → Network, filter `Logbook`.
2. Trigger a request (open your logbook), right-click a `POST /api/Logbook` → Copy → **Copy as cURL**.
3. `npm run curl-to-session -- scratch.txt` (writes `inputs/session.json`). Re-capture each hour, or
   call the `padi_refresh_session` tool with a fresh cURL.

---

## Tools

| Tool | What it does |
|---|---|
| `ping` | Health check + JWT expiry info |
| `padi_count_dives` | Total dive count |
| `padi_list_dives` | Most recent first; `limit` + `offset` |
| `padi_get_dive` | Full detail by id |
| `padi_search_dive_sites` | Autocomplete by name substring |
| `padi_create_dive` | Create a dive (writes to your real logbook) |
| `padi_update_dive` | Patch any subset of fields by id |
| `padi_delete_dive` | **Sandbox-guarded** delete (see below) |
| `padi_login` | Log in with email + password; enables auto-refresh |
| `padi_logout` | Clear the stored session + any saved password |
| `padi_auth_status` | Report login state + token expiry (no secrets) |
| `padi_refresh_session` | Advanced/fallback: load a session from a raw cURL |
| `padi_dry_run` | Preview the GraphQL payload that would be sent |

### Delete safety

`padi_delete_dive` **refuses to delete** a dive unless it looks like a test fixture — title starts
with `MCPTEST_`, **or** the date is before `1950-01-01` — **or** you explicitly pass
`iAmSureThisIsNotARealDive: true` (logged to `docs/deletions.log`). This stops an accidental
"delete my last dive" from nuking a real entry.

---

## Configuration

All optional — sensible defaults target PADI production.

| Variable | Purpose |
|---|---|
| `PADI_SESSION_PATH` | Absolute path to the session file (default: next to `dist/`) |
| `PADI_COGNITO_REGION` / `PADI_COGNITO_CLIENT_ID` | Override the Cognito target if PADI changes it |
| `PADI_ENDPOINT` | Override the logbook GraphQL endpoint |

The session file is resolved relative to the server's own location, so it works no matter which
working directory Claude Desktop launches it from. Set `PADI_SESSION_PATH` to relocate it:

```json
{ "mcpServers": { "padi": {
  "command": "node",
  "args": ["/absolute/path/to/padi-mcp/dist/index.js"],
  "env": { "PADI_SESSION_PATH": "/absolute/path/to/session.json" }
} } }
```

---

## How it works

```
MCP client (Claude)  ──stdio──▶  src/index.ts (MCP server)
                                      │
                          @padi-mcp/core (auth + GraphQL client)
                                      │
                  Cognito (login/refresh)   PADI logbook GraphQL
```

- **`@padi-mcp/core`** (`packages/core`) — shared auth (Cognito login/refresh, no AWS SDK), the
  GraphQL client, types, and the dive operations. Multi-tenant-safe (no global session state).
- **Local server** (`src/`) — binds core to a file-backed session for single-user, on-device use.
- **Managed service** (`apps/managed`) — binds core to a per-tenant, database-backed context for
  the hosted multi-user deployment.

---

## Development

```bash
npm run dev          # run the server via tsx (no build step)
npm test             # unit tests (transforms, auth, session, crypto)
npm run typecheck    # tsc, no emit
npm run lint         # biome
npm run build        # build core, then the local server → dist/

# live probes (need a valid session)
npm run probe -- count
npm run probe -- list 5
npm run probe -- get 20716851
npm run lifecycle    # full CRUD round-trip on a sandbox dive
npm run mcp-smoke    # drive the stdio server end-to-end over JSON-RPC
```

<details>
<summary>Repo layout</summary>

```
packages/core/   @padi-mcp/core — shared auth + GraphQL client + operations
src/             local stdio MCP server (entrypoint: index.ts)
apps/managed/    hosted multi-tenant service (Next.js + WorkOS)
scripts/         CLIs: login, probes, lifecycle, cURL/HAR → session, smoke test
docs/            discovered-schema.md, enums.md, anomalies.md, progress.md
```
</details>

See [`docs/discovered-schema.md`](docs/discovered-schema.md) (schema + operations),
[`docs/enums.md`](docs/enums.md) (confirmed enum values), and
[`docs/anomalies.md`](docs/anomalies.md) (wire-format gotchas).

---

## Troubleshooting

- **"Not logged in" / token expired** — run `npm run login` again, or `padi_auth_status` to inspect
  state. With a refresh token stored, renewal is automatic; a cURL-only session expires after 1 hour.
- **`ENOENT inputs/session.json` in Claude Desktop** — the session path is resolved next to `dist/`,
  not the launch dir; set `PADI_SESSION_PATH` to an absolute path if you moved it.
- **`401` from PADI** — the token was rejected; the client auto-retries once with a forced refresh.
  Persistent 401s mean a re-login is needed.
- **`Host not in allowlist` / network 403** — your network/sandbox is blocking
  `logbook.global-prod.padi.com`; run from a network that can reach it.

---

## Security

Your password is never stored unless you explicitly pass `--remember` (then it's in the macOS
Keychain or an AES-256-GCM-encrypted file). The refresh token is stored locally. To report a
vulnerability, see [`SECURITY.md`](SECURITY.md) — please don't open a public issue for security bugs.

## Contributing

PRs welcome — please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first (it covers the contributor
license terms that keep the project dual-licensable) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Copyright © 2026 Nicolas Tobis. Released under **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)): use,
modify, and self-host freely, but if you run a modified version as a network service you must
release your source. A **commercial / proprietary license** (and acquisition of the IP) is available
separately — see [`NOTICE`](NOTICE), contact nicolas.tobis@me.com.

## Disclaimer

Unofficial; not affiliated with or endorsed by PADI. Provided "as is," without warranty. **Not for
dive planning or any safety-critical decision** — rely on your training, instruments, and
certified professionals. You are responsible for what you create, edit, or delete in your logbook.
