# PADI MCP

**Talk to your PADI dive logbook in plain language.** This is an
[MCP](https://modelcontextprotocol.io) server — a small program an AI assistant like
Claude can call — that lets you read and manage the dives in *your own* PADI account just
by asking: *"how many dives do I have?"*, *"log today's dive at Blue Hole, 28 m, 42 min"*,
*"show my last 10 dives."*

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![CI](https://github.com/ntobis/padi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ntobis/padi-mcp/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF.svg)](https://modelcontextprotocol.io)

> [!IMPORTANT]
> **Unofficial & independent.** Not affiliated with, endorsed by, or operated by PADI.
> PADI has no public API, so this connects to the same backend the PADI logbook web app
> uses, signing in as **your own account**. Use it for your own logbook. See the
> [disclaimer](#disclaimer).

---

## Contents

- [What you can do](#what-you-can-do)
- [Quickstart](#quickstart)
- [Connecting your PADI account](#connecting-your-padi-account)
- [Tools reference](#tools-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Hosted version](#hosted-version)
- [Contributing](#contributing) · [Security](#security) · [License](#license) · [Disclaimer](#disclaimer)

---

## What you can do

Once it's connected, you just talk to your assistant:

| You say… | What happens |
|---|---|
| "How many dives are in my logbook?" | counts your dives |
| "Show me my last 5 dives" | lists recent dives with site, date, depth |
| "What was my deepest dive this year?" | reads the details and answers |
| "Log a dive: Blue Hole, today, 28 m, 42 min, nitrox 32" | creates the dive in your logbook |
| "Change the buddy on dive 20749634 to 'Alex'" | updates that dive |

Set it up once and it keeps itself signed in — no copying tokens every hour.

---

## Quickstart

**You'll need:** [Node.js](https://nodejs.org) 20 or newer, a PADI account, and an MCP
client (this guide uses [Claude Desktop](https://claude.ai/download)).

**1. Install and build**

```bash
git clone https://github.com/ntobis/padi-mcp.git
cd padi-mcp
npm install
npm run build
```

**2. Connect your PADI account** (stores an encrypted token; your password isn't kept)

```bash
npm run login          # prompts for your PADI email + password
```

**3. Add it to Claude Desktop**

Open your `claude_desktop_config.json` and add a `padi` entry:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

**4. Restart Claude Desktop** (fully quit and reopen). The PADI tools now appear in the
tools menu — try *"how many dives do I have?"*

> **Using a different MCP client?** Point it at the same command — run
> `node /absolute/path/to/padi-mcp/dist/index.js` over stdio.

---

## Connecting your PADI account

The server needs to access your PADI account on your behalf. Pick whichever you prefer:

### Option A — Sign in with email + password *(recommended)*

You enter your PADI email + password **once**. The server exchanges them for an access
token plus a long-lived refresh token, stores **only the encrypted refresh token** (never
your password), and automatically renews access from then on. Set it and forget it.

```bash
npm run login                              # prompts for email + password
npm run login -- you@example.com --remember   # also store the password, fully hands-off
```

Or just tell your assistant: *"Log into PADI, my email is … and my password is …"*
(the `padi_login` tool).

- The refresh token lasts ~30 days; within that window renewal is automatic.
- `--remember` additionally stores your password — in the **macOS Keychain** when
  available, otherwise an AES-256-GCM-encrypted file — so it can re-authenticate even
  after 30 days. Off by default; the password is never logged.
- Check state with `padi_auth_status`; sign out (and wipe any stored password) with
  `padi_logout`.

### Option B — Paste a session from your browser

Prefer not to hand over your password? Copy an already-authenticated request from your
browser instead. It works immediately, but this kind of session **can't auto-renew — it
expires after about an hour**, so you'll repeat these steps periodically.

1. Sign in to the PADI logbook in Chrome, open DevTools → **Network**, and filter for
   `Logbook`.
2. Open your logbook so a request fires, then right-click a successful `POST .../Logbook`
   row → **Copy → Copy as cURL**, and save it to a file (e.g. `scratch.txt`).
3. Load it:
   ```bash
   npm run curl-to-session -- scratch.txt
   ```
   When it expires, re-capture and re-run — or call the `padi_refresh_session` tool with a
   fresh copy.

---

## Tools reference

| Tool | What it does |
|---|---|
| `padi_count_dives` | Total number of dives |
| `padi_list_dives` | Recent dives first (`limit`, `offset`) |
| `padi_get_dive` | Full detail for one dive by id |
| `padi_search_dive_sites` | Autocomplete dive-site names |
| `padi_create_dive` | Create a dive *(writes to your logbook)* |
| `padi_update_dive` | Update any fields of a dive *(writes)* |
| `padi_delete_dive` | Delete a dive — [guarded](#deleting-dives-is-guarded) *(writes)* |
| `padi_login` / `padi_logout` / `padi_auth_status` | Manage the connection (Option A) |
| `padi_refresh_session` | Load a session from a browser capture (Option B) |
| `padi_dry_run` | Preview the request that would be sent, without sending it |
| `ping` | Health check |

### Deleting dives is guarded

`padi_delete_dive` **refuses to delete** a dive unless it clearly looks like a test entry
— its title starts with `MCPTEST_`, **or** its date is before `1950-01-01` — **or** you
explicitly override with `iAmSureThisIsNotARealDive: true`. This keeps an offhand "delete
my last dive" from removing something real.

---

## Configuration

All optional — the defaults target the live PADI service.

| Variable | Purpose |
|---|---|
| `PADI_SESSION_PATH` | Where to store the session file (default: next to `dist/`) |
| `PADI_COGNITO_REGION`, `PADI_COGNITO_CLIENT_ID` | Override the login target if PADI changes it |
| `PADI_ENDPOINT` | Override the logbook API endpoint |

The session file is found relative to the server itself, so it works no matter which
directory Claude Desktop launches it from. To put it elsewhere, set `PADI_SESSION_PATH`:

```json
{ "mcpServers": { "padi": {
  "command": "node",
  "args": ["/absolute/path/to/padi-mcp/dist/index.js"],
  "env": { "PADI_SESSION_PATH": "/absolute/path/to/session.json" }
} } }
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"Not logged in" / expired** | Run `npm run login` again, or `padi_auth_status` to inspect. With Option A renewal is automatic; an Option B session expires after ~1 hour. |
| **`ENOENT … session.json`** in Claude Desktop | The session is stored next to `dist/`; if you moved things, set `PADI_SESSION_PATH` to an absolute path. |
| **`401` from PADI** | The token was rejected; the client retries once with a fresh token. Persistent 401s mean you need to log in again. |
| **`Host not in allowlist` / network 403** | Your network is blocking the PADI logbook host — run from a network that can reach it. |

---

## How it works

```
Your AI client  ──stdio──▶  local MCP server (src/index.ts)
                                   │
                       @padi-mcp/core  ──▶  PADI login (token refresh)
                                       └─▶  PADI logbook API
```

- **`@padi-mcp/core`** (`packages/core`) — shared sign-in (token refresh), the API client,
  types, and the dive operations.
- **Local server** (`src/`) — what the quickstart sets up: single-user, on your machine,
  talking to your assistant over stdio.

<details>
<summary>Developing & internals</summary>

```bash
npm run dev          # run from source via tsx (no build step)
npm test             # unit tests
npm run typecheck    # tsc, no emit
npm run lint         # biome
npm run build        # build core, then the server → dist/
npm run mcp-smoke    # drive the server end-to-end over JSON-RPC
```

Repo layout:

```
packages/core/   shared sign-in + API client + dive operations
src/             local MCP server (entrypoint: index.ts)
apps/managed/    optional hosted multi-user service (see "Hosted version")
scripts/         CLIs: login, probes, session capture, smoke test
docs/            reverse-engineering notes for PADI's (undocumented) API
```

Because PADI has no public API, the request shapes were reverse-engineered from the web
app. Those notes live in [`docs/`](docs) — API schema, accepted field values, and wire-
format quirks — and are useful if you're extending the operations. They're developer
references, not needed to *use* the tool.

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
</details>

---

## Hosted version

This repo also contains an optional **multi-user hosted service** in
[`apps/managed/`](apps/managed) (a web app with sign-in and a browser "connect" page,
reachable as a remote MCP connector). Most people don't need it — the
[quickstart](#quickstart) above runs everything locally. The hosted service has its own
setup and is heavier to operate; see that directory if you're curious.

---

## Security

Your PADI password is never stored unless you explicitly pass `--remember` (then it's kept
in the macOS Keychain or an AES-256-GCM-encrypted file). The refresh token is stored
locally on your machine. Found a vulnerability? Please report it privately — see
[`SECURITY.md`](SECURITY.md) — rather than opening a public issue.

## Contributing

PRs welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) (it covers the contributor
license terms) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

Copyright © 2026 Nicolas Tobis. Released under **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)):
use, modify, and self-host freely, but if you run a modified version as a network service
you must release your source. A separate **commercial / proprietary license** is available
— see [`NOTICE`](NOTICE) or contact nicolas.tobis@me.com.

## Disclaimer

Unofficial; not affiliated with or endorsed by PADI. Provided "as is," without warranty.
**Not for dive planning or any safety-critical decision** — rely on your training,
instruments, and certified professionals. You are responsible for whatever you create,
edit, or delete in your logbook.
