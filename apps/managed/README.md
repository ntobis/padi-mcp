# `@padi-mcp/managed` — hosted multi-tenant service

A Next.js app that exposes the PADI dive logbook as a **remote MCP endpoint** with
multi-tenant sign-in. Users authenticate with WorkOS AuthKit, link their PADI account
once via a browser flow, and then call the same dive tools as the local server — but
over Streamable HTTP, from any device that speaks MCP.

> Most people don't need this. The single-user local server in the repo root is faster
> to set up. This subdirectory is for self-hosting a multi-user service (or for studying
> how it's wired).

## What's inside

```
app/                    Next.js routes: /, /connect, /terms, /privacy, /api/[transport]
  api/[transport]/      The MCP endpoint (Streamable HTTP, OAuth-protected)
  .well-known/          OAuth Protected Resource Metadata (RFC 9728)
lib/                    Auth, tenant resolution, account tools, crypto envelope,
                        rate limiting, kill-switch, alerts, env-guard
drizzle/                Postgres schema + migrations (users, padi_connections, audit_log)
scripts/                connect-smoke, mcp-http-smoke, p7-preflight, rotate-master-key
test/                   Vitest suite (68 tests; PGlite-backed schema round-trips)
```

The MCP tools mirror the local server (`padi_list_dives`, `padi_create_dive`, etc.)
plus per-tenant account tools (`padi_disconnect`, `padi_export_my_data`,
`padi_delete_my_data`).

## How it works

```
MCP client ──OAuth─▶ WorkOS AuthKit ──token──▶ /api/[transport]
                                                    │
                                                    ▼
                              withMcpAuth → withTenant → tenant context
                                                    │
                                  load envelope-encrypted refresh token
                                                    │
                                  mint short-lived PADI ID token (cached)
                                                    │
                                                @padi-mcp/core ──▶ PADI logbook API
```

- **Tenant identity** comes from the verified WorkOS access token. Never from tool
  arguments.
- **At rest:** each user's PADI refresh token is sealed with a DEK that is wrapped by
  the AES-256-GCM master key (`PADI_MASTER_KEY`). The DEK can be re-wrapped
  (`scripts/rotate-master-key.ts`) without re-encrypting ciphertext.
- **Boot-time env guard** fails fast if anything required is missing (see `lib/env-guard.ts`).

## Required environment

Copy `.env.example` to `.env.local` and fill in the values. The boot env-guard refuses
to start without these:

| Variable | Notes |
|---|---|
| `WORKOS_API_KEY` | From your WorkOS app |
| `WORKOS_CLIENT_ID` | From your WorkOS app |
| `WORKOS_COOKIE_PASSWORD` | 32+ random bytes (e.g. `openssl rand -base64 32`) |
| `WORKOS_AUTHKIT_DOMAIN` | `https://<your-slug>.authkit.app` |
| `PADI_MASTER_KEY` | AES-256-GCM key, 32 bytes base64 (`openssl rand -base64 32`) |
| `DATABASE_URL` | Postgres (Neon/Supabase/any Postgres URL) |

Optional toggles (rate limiting, kill-switch, alerting) are in `.env.example`.

## Development

```bash
# from the repo root
npm install
npm run build:core

# then, in apps/managed:
cp .env.example .env.local        # fill in values
npm run db:generate -w @padi-mcp/managed   # if you edited schema
npm run db:migrate  -w @padi-mcp/managed
npm run dev          -w @padi-mcp/managed

# in another terminal:
npm run mcp-http-smoke -w @padi-mcp/managed   # protocol smoke test (no auth)
npm run test           -w @padi-mcp/managed
```

The connect flow:

1. Visit `http://localhost:3000/` → sign in with WorkOS AuthKit.
2. Land on `/connect` → enter your PADI email + password.
3. Point an MCP client at `http://localhost:3000/api/mcp` (DCR-supported clients will
   discover the OAuth flow automatically).

## Deployment (Vercel)

The Vercel build target is configured via `vercel-build` in `package.json` (builds
`@padi-mcp/core` first, then `next build`).

1. Push to a branch — Vercel deploys a preview.
2. Set the **required env vars** in the Vercel project (Production + Preview scopes).
3. Register your deployment URLs as redirect URIs in the WorkOS application
   (`https://<host>/callback`, including a wildcard for previews if you want them).
4. The runtime computes the AuthKit redirect URI from each request's origin, so
   previews redirect back to themselves — no rebuild needed per deploy.

See [`../../docs/runbooks/secret-rotation.md`](../../docs/runbooks/secret-rotation.md)
for rotating any of the secrets above and
[`../../docs/runbooks/launch-open-signup.md`](../../docs/runbooks/launch-open-signup.md)
for the pre-flight checklist before opening up signup.
