# Feature 2 — Managed Multi-Tenant PADI MCP Service

## Mission

Stand up a **hosted, multi-tenant MCP server** that any number of users can
connect to from Claude on **any device** (phone, web, desktop) as a "custom
connector." Each user authenticates to the service, connects their PADI account
once, and can then list/read/create/update/delete their own dives by voice or
chat from anywhere — no local install, no cURL, no per-machine setup.

This builds on Feature 1: the Cognito auth core (`loginWithPassword`,
`refreshTokens`) and the entire `operations/`, `transforms/`, `types.ts` layer
are **shared, not reimplemented**. Feature 2 adds: a remote MCP transport, a
caller-authentication layer, a multi-tenant encrypted token store, and a hosted
deployment.

**End-goal framing:** the same git repo serves both products — the open-source
local server (Feature 1) and this managed service. They share a core package.

**Operating mode:** Work continuously and autonomously. Build and self-test the
entire stack **locally first** (docker-compose harness described below) before
any cloud provisioning. Only stop at the human-gated checkpoints — all of which
are "create/authorize a cloud account" or "set a production secret/domain"
steps that genuinely require the account owner.

**Scale target:** *Build private, design for public.* Ship invite-only with the
multi-tenant architecture, rate-limit hooks, and data model already in place so
that flipping to public signup later is a config change plus the documented
"pre-public-launch checklist" — not a rewrite.

---

## Confirmed constraints that shape the design

1. **We do not control PADI's Cognito app client.** Its redirect URIs point at
   `learning.padi.com`; we cannot register `https://our-service/callback`.
   Therefore the clean "Log in with PADI (hosted UI redirect)" OAuth flow is
   **not available**. We must obtain each user's PADI tokens ourselves. Per the
   user's decision: **collect PADI email+password over TLS, exchange immediately
   via `USER_PASSWORD_AUTH`, store ONLY the encrypted refresh token, discard the
   password.** (Verified feasible in Feature 1.)
2. **Two distinct auth layers** (do not conflate):
   - **Layer 1 — caller → our service.** OAuth 2.1, per the MCP Authorization
     spec, so Claude (any device) can connect and we can isolate tenants.
   - **Layer 2 — our service → PADI.** Per-tenant encrypted refresh tokens,
     used to mint PADI ID tokens server-side on demand.
3. **Vercel functions are stateless/ephemeral.** No in-memory session survives
   between requests. All state lives in Postgres (durable) and optionally Redis
   (cache/rate-limit). Use the **stateless Streamable HTTP** MCP transport
   (SSE disabled) so no long-lived connection is required — this is exactly
   what Vercel recommends and what cuts their CPU cost.

---

## Stack (decided)

| Concern | Choice | Why |
|---|---|---|
| Host | **Vercel** (Next.js App Router) | User preference; officially supports MCP hosting; low ops. |
| MCP transport | **`mcp-handler`** (Vercel's adapter) + Streamable HTTP, SSE disabled | Official Vercel package; wraps the MCP TS SDK; built for serverless. Pin `@modelcontextprotocol/sdk@^1.26.0` (earlier versions have CVEs). |
| Layer-1 auth | **WorkOS AuthKit** | Spec-compatible OAuth 2.1 AS for MCP (implements DCR, Protected Resource Metadata, the `withAuth`/`authHandler` wrapper). Official Vercel+AuthKit MCP template exists. Generous free tier (large MAU allowance) → fits "design for public." Least for us to manage. |
| Layer-2 auth | **Shared Cognito core from Feature 1** | `loginWithPassword` once at connect time; `refreshTokens` per MCP request. |
| Database | **Neon Postgres** (Vercel-native serverless PG) via **Drizzle ORM** | Serverless, Vercel-integrated, low ops; Drizzle is lightweight + type-safe + easy local docker testing. |
| Cache / rate-limit | **Upstash Redis** (Vercel KV) | Serverless Redis; used for minted-ID-token cache + per-tenant rate limiting. Optional in phase 1. |
| Secret encryption | **App-layer AES-256-GCM** (Node `crypto`), envelope pattern, master key (KEK) in Vercel env var | No KMS dependency to start; documented upgrade path to AWS KMS / Vercel KMS. |
| Shared code | **pnpm workspace monorepo**, package `@padi-mcp/core` | One source of truth for operations/transforms/types/cognito across local + managed. |

> If any of these turn out to block during build (e.g. a WorkOS limitation),
> stop at the relevant checkpoint and surface the specific problem — do not
> silently substitute a different vendor.

---

## Repository shape (monorepo refactor)

Convert the current single-package repo into a pnpm workspace. **This refactor
is Phase 0 and must keep the existing local server working unchanged.**

```
padi-mcp/                      (workspace root)
├── pnpm-workspace.yaml
├── packages/
│   └── core/                  # @padi-mcp/core — the shared engine
│       ├── src/
│       │   ├── auth/cognito.ts        # from Feature 1 (moved here)
│       │   ├── operations/*.ts        # moved from src/operations
│       │   ├── transforms/*.ts        # moved
│       │   ├── types.ts               # moved
│       │   └── padi-client.ts         # refactored: token provider injected
│       └── package.json
├── apps/
│   ├── local/                 # the existing open-source MCP server (Feature 1)
│   │   ├── src/index.ts       # stdio server; imports @padi-mcp/core
│   │   ├── src/session.ts     # local file-based token store
│   │   └── package.json
│   └── managed/               # the Vercel app (this doc)
│       ├── app/
│       │   ├── api/[transport]/route.ts   # mcp-handler endpoint
│       │   ├── connect/page.tsx           # PADI-account connect UI (behind AuthKit)
│       │   ├── connect/actions.ts         # server action: exchange + store
│       │   └── .well-known/...            # OAuth PRM (provided by AuthKit/mcp-handler)
│       ├── lib/
│       │   ├── db/schema.ts               # Drizzle schema
│       │   ├── db/client.ts
│       │   ├── crypto/envelope.ts         # AES-256-GCM envelope encryption
│       │   ├── tokens.ts                  # get-or-mint PADI ID token for a tenant
│       │   └── ratelimit.ts               # Upstash-based limiter
│       ├── package.json
│       └── vercel.json
└── docs/design/02-managed-service.md      # this file
```

**Critical:** `@padi-mcp/core`'s `padi-client.ts` must take a **token provider**
(`() => Promise<string>`) instead of reading a session file, so the local app
injects "read from session.json" and the managed app injects "decrypt this
tenant's refresh token and mint an ID token." This is the single most important
refactor — get the seam right and both apps fall out cleanly.

---

## Data model (Postgres / Drizzle)

```sql
-- Tenant identity comes from WorkOS (Layer 1). We key everything on it.
CREATE TABLE users (
  workos_user_id   TEXT PRIMARY KEY,         -- from the AuthKit token `sub`
  email            TEXT,                       -- convenience copy
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One PADI connection per user (1:1 for v1; table allows future 1:many).
CREATE TABLE padi_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id       TEXT NOT NULL REFERENCES users(workos_user_id) ON DELETE CASCADE,
  affiliate_id         TEXT NOT NULL,          -- derived from PADI ID token claims
  cognito_sub          TEXT NOT NULL,
  padi_username        TEXT NOT NULL,          -- the PADI email (for re-login UX only)
  enc_refresh_token    BYTEA NOT NULL,         -- AES-256-GCM ciphertext
  enc_nonce            BYTEA NOT NULL,         -- GCM nonce/IV
  wrapped_dek          BYTEA NOT NULL,         -- per-row data key, wrapped by KEK
  status               TEXT NOT NULL DEFAULT 'active',  -- active | needs_relogin | revoked
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at    TIMESTAMPTZ,
  UNIQUE (workos_user_id)
);

-- Audit: every mutating PADI action, for safety + support + abuse review.
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  workos_user_id  TEXT NOT NULL,
  action          TEXT NOT NULL,              -- create_dive | update_dive | delete_dive | connect | relogin
  dive_id         BIGINT,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

We **never** store the PADI password. The refresh token is the only PADI secret
at rest, and it's encrypted (below).

---

## Encryption (envelope, app-layer)

- **KEK** (key-encryption key): 32 random bytes, base64 in Vercel env
  `PADI_MASTER_KEY`. Set once at provisioning (human-gated).
- **Per-row DEK**: generate 32 random bytes per connection; AES-256-GCM-encrypt
  the refresh token with the DEK; wrap (encrypt) the DEK with the KEK; store
  ciphertext + nonce + wrapped DEK. Decrypt is the reverse.
- Module `lib/crypto/envelope.ts`: `encrypt(plaintext): {ct, nonce, wrappedDek}`
  and `decrypt({ct, nonce, wrappedDek}): plaintext`. Pure, unit-testable with a
  fixed test KEK.
- **Upgrade path (documented, not built now):** replace the file/env KEK with
  AWS KMS `GenerateDataKey`/`Decrypt` so the KEK never leaves the HSM. Interface
  stays identical; only `envelope.ts` internals change. Required before public
  launch if storing many users' tokens.

---

## Layer 1 — caller authentication (WorkOS AuthKit)

- WorkOS AuthKit acts as the OAuth 2.1 **Authorization Server**; our MCP
  endpoint is the **Resource Server**. `mcp-handler` + AuthKit provide:
  - Protected Resource Metadata (`/.well-known/oauth-protected-resource`).
  - `401` with `WWW-Authenticate: ... resource_metadata=...` for unauthenticated
    calls (so Claude discovers where to log in).
  - Dynamic Client Registration (Claude registers itself at runtime).
  - The `withMcpAuth` / `authHandler` wrapper that validates the bearer token on
    each MCP request and hands us the authenticated **WorkOS user id** — our
    tenant key.
- Follow the official `workos/vercel-mcp-example` pattern: wrap the
  `mcp-handler` route with the AuthKit auth handler; individual tools read the
  authenticated user id from context.
- **Invite-only for private phase:** configure AuthKit to restrict sign-ups
  (allowlist domains/emails or invitation-only). Flipping to public = AuthKit
  setting + removing our allowlist check. No code rearchitecture.

---

## Layer 2 — PADI token minting per request

`lib/tokens.ts` exposes `getPadiIdToken(workosUserId): Promise<string>`:
1. Look up the `padi_connections` row for the user. None → throw
   `NotConnectedError` (tools convert this to a friendly "connect your PADI
   account at `<APP_URL>/connect`" message).
2. Check Redis for a cached, still-valid minted ID token (key
   `padi:idtoken:<workosUserId>`, TTL = token life − 60s). Hit → return it.
3. Miss → decrypt the refresh token (envelope), call `refreshTokens()` (shared
   core), cache the new ID token in Redis, update `last_refreshed_at`, return.
4. If `refreshTokens()` throws `RefreshExpired`/`NotAuthorized` → set
   `status='needs_relogin'`, throw `NeedsReloginError` (tool message: "your PADI
   session expired, reconnect at `<APP_URL>/connect`").

The per-request `@padi-mcp/core` client is constructed with
`tokenProvider = () => getPadiIdToken(userId)` and `affiliate_id` from the row.

---

## The connect flow (PADI account linking)

A normal web page in the Next.js app, **behind AuthKit login**, not an MCP tool:

1. User (already authenticated to our service via AuthKit, e.g. from a link
   Claude shows them) visits `/connect`.
2. Form: PADI email + password (TLS only; autocomplete=off; never logged).
3. Server action `connect/actions.ts`:
   - `loginWithPassword(email, password)` (shared core).
   - Parse `affiliate_id`, `cognito_sub` from the returned ID token claims.
   - Envelope-encrypt the **refresh token**; upsert `padi_connections`.
   - **Discard the password** (never written anywhere).
   - Audit-log `connect`.
4. Success page: "PADI connected — go back to Claude and try 'count my dives.'"

MCP tools that need PADI but find no active connection return the `/connect`
URL so the user is guided there from within Claude on any device.

---

## MCP tools (managed)

Mirror the local tool surface, but **tenant-scoped** and with no session-
management tools (auth is handled by the platform, not by tools):

- `padi_count_dives`, `padi_list_dives`, `padi_get_dive`,
  `padi_search_dive_sites` — read.
- `padi_create_dive`, `padi_update_dive`, `padi_delete_dive` — write (same
  sandbox-guard semantics; audit-logged).
- `padi_connection_status` — reports whether the caller has connected a PADI
  account and the connect URL if not. (Replaces `padi_auth_status`.)
- **No** `padi_login` / `padi_refresh_session` here — connecting happens via the
  web flow; refresh happens server-side automatically.

Every tool handler: `userId = auth.userId` (from AuthKit) → construct core
client via `getPadiIdToken(userId)` → call the shared operation. Wrap
`NotConnectedError`/`NeedsReloginError` into friendly text with the connect URL.

---

## Rate limiting & abuse (hooks now, enforcement scaled later)

- `lib/ratelimit.ts` (Upstash sliding-window): per-`workosUserId` limits on
  tool calls and especially on writes/deletes. Private phase: generous limits,
  logging only. Public phase: enforce + alert.
- Sandbox-delete guard from the core stays (refuses non-`MCPTEST_`/post-1950
  dives without override) — protects users from destructive mistakes.

---

## Self-test strategy (do as much as possible without cloud)

**Local docker-compose harness** (`apps/managed/docker-compose.test.yml`):
- Postgres (real, for Drizzle migrations + queries).
- The Next.js app via `vercel dev` or `next dev` on `localhost:3000`.
- Redis (real Upstash-compatible, e.g. `redis` image; the Upstash SDK speaks
  plain Redis locally).
- WorkOS: use a **WorkOS dev/sandbox environment** (free) for real Layer-1, OR
  a documented bypass flag `MCP_DEV_FAKE_AUTH=1` that injects a fixed test user
  id so the MCP path is testable with zero external auth during early phases.

What I can verify locally, end-to-end, before any deploy:
1. **MCP protocol**: drive `http://localhost:3000/api/mcp` with the MCP SDK
   client and/or `npx @modelcontextprotocol/inspector` — `initialize`,
   `tools/list`, and tool calls. Reuse/extend the existing `mcp-smoke.ts` to
   speak Streamable HTTP instead of stdio.
2. **Encryption**: unit tests for `envelope.ts` (round-trip, tamper-detection).
3. **DB**: Drizzle migrations apply; `padi_connections` upsert/read works.
4. **Connect flow**: POST to the connect server action with a real PADI
   email+password (the Phase-6 human-gated login from Feature 1) → row stored,
   encrypted, password absent; then an MCP `padi_count_dives` call returns the
   real count — proving the full Layer-2 path (decrypt → mint → call PADI)
   works against the live API from the managed code path.
5. **Token minting/caching**: force-expire the cached token, assert a refresh
   happens once and is reused.
6. **Auth (Layer 1)**: with a WorkOS dev env, complete a real OAuth handshake
   from the MCP Inspector; assert unauthenticated calls get the correct `401` +
   `WWW-Authenticate`.

Only the production-domain connector test from a real phone (Phase 7) and the
provisioning steps require the human.

---

## Phased plan

### Phase 0 — Monorepo + `@padi-mcp/core` extraction
Convert to pnpm workspace; move operations/transforms/types/cognito/padi-client
into `packages/core`; refactor `padi-client` to take an injected token provider;
re-point the existing local app at the core. **Done when** the local app still
passes `npm run build`/`test`/`mcp-smoke` unchanged (now via the core package).
*Fully self-testable; no human input.*

### Phase 1 — Next.js app + MCP endpoint (no auth yet)
Scaffold `apps/managed`; add `mcp-handler` route at `/api/[transport]` exposing a
public `ping` + `padi_count_dives` wired to a **hardcoded dev token provider**
(reads a local refresh token from env for now). Streamable HTTP, SSE disabled.
**Done when** the MCP Inspector connects to `localhost:3000/api/mcp` and lists/
calls tools. *Self-testable.*

### Phase 2 — Postgres + Drizzle + encryption
Add Neon/Drizzle schema + migrations (run against docker Postgres locally);
implement `envelope.ts`. **Done when** migrations apply and envelope unit tests
pass. *Self-testable.*

### Phase 3 — Connect flow (Layer 2)
Build `/connect` page + server action: `loginWithPassword` → encrypt → store →
discard password. Implement `lib/tokens.ts` (decrypt → mint → cache).
**Done when** (Phase-6/Feature-1 login) a real PADI connect stores an encrypted
row and an MCP `padi_count_dives` returns the real count via the managed path.
*Self-testable except the one real PADI login (human-gated, shared with
Feature 1).*

### Phase 4 — Layer-1 auth (WorkOS AuthKit) — GATED on WorkOS provisioning
Integrate AuthKit + `withMcpAuth`; tenant-scope every tool by the AuthKit user
id; emit PRM + `401`/`WWW-Authenticate`. **Done when** an MCP Inspector OAuth
handshake against a WorkOS **dev** env succeeds and unauthenticated calls are
rejected correctly. *Needs the user to create a WorkOS account + dev app
(checkpoint 2).*

### Phase 5 — Rate limiting, audit, connection-status tool
Upstash limiter (log-only thresholds), audit_log writes on mutations,
`padi_connection_status` tool, friendly not-connected/needs-relogin messaging.
*Self-testable with local Redis.*

### Phase 6 — Deploy to Vercel — GATED on Vercel/Neon/Upstash provisioning + secrets
`vercel.json`, env vars (`PADI_MASTER_KEY`, DB url, Redis url, WorkOS keys,
`APP_URL`), connect Neon + Upstash, deploy. **Done when** the deployed
`/api/mcp` passes the same Inspector tests against the preview URL.
*Needs provisioning + secrets (checkpoints 3–5).*

### Phase 7 — Real-device connector test — GATED (light)
Add the deployed URL as a custom connector in Claude (web + mobile), complete
the AuthKit login + PADI connect, and run "count my dives" / a sandbox
create+delete from the phone. **Done when** the full round trip works from
mobile. *Needs the user to add the connector + do the one connect (can reuse
their own login).* 

### Phase 8 — Pre-public-launch checklist (DESIGN NOW, EXECUTE LATER)
Documented, not built in the private phase:
- Open signup flip (AuthKit setting + remove allowlist).
- KMS-backed KEK (swap `envelope.ts` internals).
- ToS + Privacy Policy; GDPR/DPA posture (EU divers): data export + delete
  endpoints, retention policy, processor agreement with WorkOS/Neon/Upstash.
- Enforced rate limits + abuse alerting; secret rotation runbook.
- PADI ToS review (this is an unofficial integration) + a kill-switch.
- Per-tenant token-revocation/disconnect endpoint.

---

## Human-gated checkpoints (the ONLY times to ask)

All are account/secret/domain actions only the owner can do. Batch them when
possible and tell the user exactly what to click.

1. **One live PADI login** (shared with Feature 1) — to verify the Layer-2 path
   end-to-end. User runs it locally / via the connect form; password never
   shared with me.
2. **WorkOS account + dev application** (Phase 4) — user creates a WorkOS
   account, an AuthKit app, and provides the client id / API key (dev). I'll
   give exact instructions.
3. **Vercel project** (Phase 6) — user creates/links the Vercel project (likely
   `vercel link`), authorizes deploy.
4. **Neon Postgres + Upstash Redis** (Phase 6) — provision (both have Vercel
   one-click integrations) and provide connection strings.
5. **Production secrets + domain** (Phase 6/7) — set `PADI_MASTER_KEY` (I'll
   generate the bytes; user pastes into Vercel env), WorkOS production keys, and
   choose the connector URL/domain.

Everything else — code, schema, encryption, MCP wiring, local end-to-end tests —
I do and verify autonomously.

---

## Stopping conditions

1. WorkOS AuthKit cannot satisfy an MCP-spec requirement Claude needs (DCR, PRM,
   token audience) → stop, report specifics, propose an alternative provider
   (Stytch/Clerk/Descope/Better Auth all have Vercel MCP templates).
2. Vercel function limits block the Streamable HTTP flow (e.g. duration) for a
   real operation → stop, report, consider Fluid Compute settings or a fallback
   host.
3. PADI changes Cognito (MFA on, `USER_PASSWORD_AUTH` disabled, refresh TTL
   slashed) → the connect flow breaks for everyone; stop and reassess (this is
   the systemic risk of an unofficial integration).
4. Any sign that a single user's tokens could be served to another tenant
   (isolation bug) → **hard stop**, treat as a security incident, do not deploy.

---

## Security & trust posture (must hold before public)

- We are a **custodian of other people's PADI refresh tokens.** Encrypt at rest
  (envelope; KMS before public), isolate per tenant on every single request
  (derive tenant from the validated AuthKit token, never from client input),
  never log secrets, and provide disconnect/delete.
- Password is transient: exchanged once at connect, never persisted, never
  logged.
- Tenant isolation is enforced server-side from the AuthKit identity — a tool
  must never accept a `userId`/`affiliate_id` from the caller's arguments.
- Document the unofficial-API risk and keep a kill-switch (disable connect +
  pause tools) for if PADI objects.
