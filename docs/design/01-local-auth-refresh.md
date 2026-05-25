# Feature 1 — Local Cognito Auth & Auto-Refresh (Open-Source Build)

## Mission

Eliminate the hourly manual cURL paste. Today a user must open Chrome
DevTools, copy a request as cURL, and re-run `curl-to-session` every time the
1-hour JWT expires. This feature replaces that with a **log-in-once** flow: the
user provides their PADI email + password a single time, and the MCP server
authenticates against PADI's AWS Cognito user pool, stores the long-lived
**refresh token**, and silently mints a fresh ID token whenever the current one
expires. The user is hands-off for the lifetime of the refresh token (Cognito
default ~30 days), and optionally forever if they opt into credential storage.

This is the **open-source / local** build: it runs entirely on the user's own
Mac, adds no external services, and must be clone-and-run for a non-technical
user. The Cognito auth logic written here is the **shared core** reused
verbatim by Feature 2 (the managed service) — design it as a clean, transport-
agnostic module.

**Operating mode:** Work continuously and autonomously. Self-verify every step.
Maintain `docs/progress.md`. Only stop to ask the user for input at the explicit
human-gated checkpoints listed at the end (essentially: the one live login that
needs a real password, which the user can run themselves).

---

## What we already know (verified)

PADI's auth is an AWS Cognito user pool. All facts below were confirmed by live
probing during the build of the original MCP server (see `docs/anomalies.md` and
the conversation that produced this doc):

| Fact | Value |
|---|---|
| Cognito region | `us-west-2` |
| User pool id | `us-west-2_hGwJiwtcI` (from JWT `iss`) |
| App client id | `2arn5r23p0ugce89a5moe95v1l` (from JWT `aud`) |
| Client secret | **None** — public SPA client; no `SECRET_HASH` required |
| `USER_PASSWORD_AUTH` flow | **Enabled** (probe returned "Incorrect username or password", not "flow not enabled") |
| `REFRESH_TOKEN_AUTH` flow | **Enabled** (probe returned "Invalid Refresh Token", not "flow not enabled") |
| MFA | **Not used** on PADI accounts (confirmed by user) |
| ID token TTL | ~3600s (`exp - iat == 3600` on every captured token) |
| Refresh token TTL | Unknown exact value; Cognito default is 30 days. **Probe and document** (see Phase 6). |
| ID token claims of interest | `sub` (cognito_sub), `custom:affiliate_id` (e.g. `14867369`), `email`, `exp`, `iss`, `aud` |

**Key consequence:** after a successful login the ID token's claims contain both
`sub` and `custom:affiliate_id`. The server can derive `affiliate_id` and
`cognito_sub` from the token itself — **no separate cURL capture is ever needed
again.** Login is the only input.

### Cognito host

```
POST https://cognito-idp.us-west-2.amazonaws.com/
```

This host must be reachable from wherever the server runs. On the user's Mac it
is (normal outbound HTTPS). In the dev sandbox it was confirmed reachable after
the network policy allowed it.

---

## Decisions (and rationale)

1. **Talk to Cognito with plain `fetch`, not the AWS SDK.**
   The `InitiateAuth` calls we need (`USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`)
   are *unauthenticated* operations against a public client — they need no AWS
   credentials. Using `@aws-sdk/client-cognito-identity-provider` would drag in
   a large dependency and trigger AWS credential-resolution logic we don't want.
   Plain `fetch` matches the project's existing "plain fetch, no Apollo" ethos,
   keeps the dependency tree tiny, and — importantly — runs identically in Node
   (local) and Vercel serverless (Feature 2). The exact wire contracts are in
   the appendix; they were verified by probe.

2. **Store the refresh token, never require the password by default.**
   After login, persist the refresh token (not the password). Mint ID tokens
   from it on demand. This gives ~30 days hands-off with no password at rest.

3. **Optional credential storage for true zero-touch**, gated behind an explicit
   opt-in (`remember_password`). When enabled, prefer the **macOS Keychain**
   (via the `security` CLI — no native module) over a plaintext file. If
   Keychain is unavailable, fall back to the encrypted-at-rest file with a loud
   warning. Default is OFF.

4. **Backward compatible with the cURL flow.** The existing
   `padi_refresh_session` tool and `inputs/session.json` (ID-token-only) keep
   working. A pasted ID token is used until it expires; without a refresh token
   the server then asks the user to log in. No breaking change for existing
   users.

5. **The auth module is transport-agnostic and side-effect-free at its core.**
   Pure functions for "exchange credentials → tokens" and "refresh token →
   tokens". Persistence is injected. This is what Feature 2 imports.

---

## Architecture

### New module: `src/auth/cognito.ts` (the shared core)

Pure functions, no filesystem, no globals:

```ts
export interface CognitoTokens {
  idToken: string;        // the Bearer token PADI's API wants
  accessToken: string;
  refreshToken?: string;  // present on password login; usually absent on refresh
  expiresIn: number;      // seconds, typically 3600
  obtainedAt: number;     // Date.now() ms, for expiry math
}

export interface CognitoConfig {
  region: string;         // 'us-west-2'
  clientId: string;       // '2arn5r23p0ugce89a5moe95v1l'
}

// USER_PASSWORD_AUTH
export async function loginWithPassword(
  cfg: CognitoConfig, username: string, password: string,
): Promise<CognitoTokens>;

// REFRESH_TOKEN_AUTH
export async function refreshTokens(
  cfg: CognitoConfig, refreshToken: string,
): Promise<CognitoTokens>;

// Typed errors so callers can react:
export class CognitoAuthError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
// code ∈ { 'NotAuthorized', 'RefreshExpired', 'PasswordResetRequired',
//          'UserNotConfirmed', 'Challenge', 'Network', 'Unknown' }
```

`loginWithPassword` must detect a `ChallengeName` in the response (e.g. MFA) and
throw `CognitoAuthError('Challenge', ...)` rather than silently returning no
tokens — PADI doesn't use MFA, but fail loudly if that ever changes.

The Cognito config defaults live in `src/auth/cognito.ts` as constants but are
overridable via env (`PADI_COGNITO_REGION`, `PADI_COGNITO_CLIENT_ID`) so the
code stays generic and testable.

### Token store refactor: `src/session.ts`

Evolve the session model from "an ID token string" to "an auth state that can
regenerate ID tokens." New persisted shape (`inputs/session.json`, still
gitignored):

```json
{
  "endpoint": "https://logbook.global-prod.padi.com/api/Logbook",
  "affiliate_id": "14867369",
  "cognito_sub": "df250b39-...",
  "username": "nicolas.tobis@me.com",
  "x_platform": "web",
  "user_agent": "Mozilla/5.0 ...",
  "refresh_token": "eyJ...",            // NEW — the durable credential
  "id_token": "eyJ...",                  // cached most-recent ID token
  "id_token_obtained_at": 1779688225000,
  "id_token_expires_in": 3600
}
```

Rules:
- `affiliate_id`, `cognito_sub`, `username` are **derived from the ID token
  claims** at login time — never asked for separately.
- Backward compat: a legacy file with only `authorization`/`id_token` and no
  `refresh_token` still loads; the server uses the ID token until expiry, then
  raises `SessionNeedsLoginError`.
- `getValidIdToken()` is the new central accessor used by `padi-client.ts`:
  1. If the cached ID token has >60s of life left, return it.
  2. Else, if a `refresh_token` exists, call `refreshTokens()`, update the
     cache, persist (best-effort write, as already implemented), return the new
     ID token.
  3. Else, if `remember_password` storage exists, `loginWithPassword()` again,
     persist, return.
  4. Else, throw `SessionNeedsLoginError` with a message telling the user to run
     `padi_login` (or `npm run login`).

### Client integration: `src/padi-client.ts`

Currently reads a static `authorization` from the session. Change it to call
`await getValidIdToken()` immediately before building request headers, so every
request transparently gets a fresh token. The existing
`NetworkPolicyError` / `SessionExpiredError` handling stays; add handling so a
401 from PADI triggers exactly one forced refresh-and-retry before surfacing
`SessionNeedsLoginError` (covers the edge case where a token is revoked
server-side mid-life).

### Credential storage: `src/auth/credential-store.ts`

Abstraction with two backends, selected at runtime:

```ts
export interface CredentialStore {
  savePassword(username: string, password: string): Promise<void>;
  loadPassword(username: string): Promise<string | null>;
  clear(username: string): Promise<void>;
}
```

- `KeychainCredentialStore` — shells out to macOS `security add-generic-password`
  / `find-generic-password` / `delete-generic-password` under service name
  `padi-mcp`. No native dependency. Detect availability by probing for the
  `security` binary + `darwin` platform.
- `FileCredentialStore` — AES-256-GCM encrypts the password into
  `inputs/credentials.enc` using a key derived from a machine-local secret
  (e.g. a randomly generated `inputs/.cred-key` created on first use, chmod
  600). Loud warning in logs + README that this is plaintext-equivalent if the
  machine is compromised. Only used when Keychain is unavailable AND the user
  opted in.

Default: no credential store active; only the refresh token is persisted.

### Tools (in `src/index.ts`)

| Tool | Change |
|---|---|
| `padi_login` | **NEW.** Inputs: `email`, `password`, `remember_password?` (default false). Calls `loginWithPassword`, derives affiliate_id/sub/username from claims, persists session, optionally stores password. Returns `{ logged_in: true, affiliate_id, expires_in_seconds, refresh_token_stored: true, password_stored: bool }`. NEVER echo the password back. |
| `padi_logout` | **NEW.** Clears `refresh_token`, cached ID token, and any stored password. Returns `{ logged_out: true }`. |
| `padi_refresh_session` | **KEEP** for backward compat (cURL paste still works for power users). Update its description to recommend `padi_login` instead. |
| `padi_auth_status` | **NEW** (or fold into `ping`). Reports: logged in? refresh token present? seconds until ID token expiry? password stored? This is the diagnostic the user/Claude checks first. |
| read/write tools | Unchanged — they go through `padi-client.ts`, which now auto-refreshes. |

### CLI for non-Claude setup: `scripts/login.ts`

`npm run login` — prompts for email + password on the terminal (password hidden
via `readline` muted input), calls the same `loginWithPassword`, writes the
session. This lets an open-source user authenticate without going through Claude
Desktop, and gives me a self-test entry point.

---

## File structure (additions/changes)

```
src/
├── auth/
│   ├── cognito.ts            # NEW — shared core: loginWithPassword, refreshTokens
│   └── credential-store.ts   # NEW — Keychain | File backends (optional pw storage)
├── session.ts                # CHANGED — refresh-token-aware token store + getValidIdToken()
├── padi-client.ts            # CHANGED — await getValidIdToken() per request; 401→refresh→retry
└── index.ts                  # CHANGED — padi_login, padi_logout, padi_auth_status tools
scripts/
├── login.ts                  # NEW — `npm run login` terminal flow
└── curl-to-session.ts        # KEPT — still works
test/
├── cognito.test.ts           # NEW — unit tests w/ mocked fetch (success, bad creds, refresh, challenge)
├── session-refresh.test.ts   # NEW — token-cache/expiry logic w/ injected clock + mock cognito
└── credential-store.test.ts  # NEW — File backend round-trip; Keychain skipped if unavailable
docs/
├── design/01-local-auth-refresh.md   # this file
└── progress.md               # append as you go
```

---

## Phased plan

Each phase ends with a self-test you can run without human input (except the one
checkpoint flagged in Phase 6).

### Phase 0 — Cognito core module
1. Write `src/auth/cognito.ts` with `loginWithPassword`, `refreshTokens`, typed
   errors, using `fetch` against the contracts in the appendix.
2. Add a tiny decode helper (reuse `decodeJwt` from `session.ts`) to extract
   `sub`, `custom:affiliate_id`, `email` from the ID token.
**Self-test:** `test/cognito.test.ts` with mocked `fetch` — assert correct
request shape (target header, body), correct parsing of `AuthenticationResult`,
correct error mapping for `NotAuthorizedException` and the `ChallengeName`
branch. Also a live negative test: real `fetch` to Cognito with a bad password
asserting `CognitoAuthError('NotAuthorized')` (no secret needed; this is the
same probe already proven to work).

### Phase 1 — Token store refactor
1. Extend the `Session` type and `inputs/session.json` shape (above).
2. Implement `getValidIdToken()` with the 4-step logic. Inject a clock for
   testability.
3. Keep `loadSession`/`replaceSession`/path-resolution (module-relative, the
   Feature-0 fix) intact. Maintain legacy-file backward compat.
**Self-test:** `test/session-refresh.test.ts` — mock cognito + fake clock:
(a) fresh token returned as-is; (b) expired token + refresh token → refresh
called once, cache updated; (c) expired token + no refresh → `SessionNeedsLogin`.

### Phase 2 — Client auto-refresh
1. `padi-client.ts` calls `await getValidIdToken()` per request.
2. On HTTP 401 from PADI, force one refresh + retry, then surface
   `SessionNeedsLoginError`.
**Self-test:** existing live operations suite (`npm run probe -- count`,
`npm run mcp-smoke`) still passes — using a session file that now carries a
refresh token (provided once at the Phase 6 checkpoint, or via the existing
ID token until then).

### Phase 3 — Tools + CLI
1. Add `padi_login`, `padi_logout`, `padi_auth_status` to `src/index.ts`.
2. Write `scripts/login.ts` + `npm run login`.
3. Update tool descriptions; keep `padi_refresh_session`.
**Self-test:** extend `scripts/mcp-smoke.ts` to call `padi_auth_status` and
assert shape. (Can't fully test `padi_login` without a real password — that's
Phase 6.)

### Phase 4 — Optional credential storage
1. Implement `credential-store.ts` (Keychain + File backends).
2. Wire `remember_password` into `padi_login` and the
   step-3 fallback in `getValidIdToken()`.
**Self-test:** `test/credential-store.test.ts` — File backend save/load/clear
round-trip; Keychain test auto-skips when `security` or darwin is absent. On a
Mac I can additionally smoke the Keychain path.

### Phase 5 — Docs & migration
1. Update `README.md`: new "Log in once" setup (replaces the cURL-every-hour
   section as the primary path; keep cURL as an "advanced/alternative"). Document
   `remember_password`, the Keychain option, and `PADI_COGNITO_*` overrides.
2. One-line migration note for existing users (old session.json keeps working;
   run `padi_login` once to upgrade).
**Self-test:** `npm run build`, `npm run typecheck`, `npm test`, `npm run
mcp-smoke` all green.

### Phase 6 — Live verification (HUMAN-GATED — see checkpoints)
1. Perform a real `loginWithPassword` against the user's account, confirm an ID
   token comes back with the right `affiliate_id` claim, let it auto-refresh,
   and run the full lifecycle (`npm run lifecycle`) using the auto-minted token.
2. **Probe the refresh-token TTL**: decode nothing (refresh tokens are opaque),
   but record the date; document the observed validity window when/if a refresh
   eventually fails. At minimum, confirm `refreshTokens()` returns a working ID
   token immediately after login.

---

## Human-gated checkpoints (the ONLY times to ask the user)

1. **One live login.** I cannot test the real `USER_PASSWORD_AUTH` path without a
   real password, and the user does not want to paste it into chat. Resolution:
   ask the user to run `npm run login` themselves once (password entered locally,
   never shared) and confirm `padi_auth_status` shows logged-in + a future
   expiry — OR, if they prefer, to paste a **refresh token** (opaque, not a
   password) so I can verify `refreshTokens()` end-to-end. Everything else is
   self-tested with mocks + the existing live ID token.

That's the only required human input for Feature 1. No cloud provisioning.

---

## Stopping conditions

1. Cognito returns an unexpected `ChallengeName` (would mean PADI enabled MFA) —
   stop, document in `docs/anomalies.md`, ask the user how to proceed (MFA
   handling is a design change).
2. `USER_PASSWORD_AUTH` starts returning "flow not enabled" (PADI changed the
   app client config) — stop; we'd need the SRP flow, a larger change.
3. The refresh-token TTL turns out to be very short (< 1 day), undermining the
   value — document and flag; the managed service or password-storage option
   becomes more important.

---

## Security notes

- The refresh token is a bearer credential: anyone with it can mint PADI ID
  tokens for ~30 days. It lives in `inputs/session.json` (gitignored, chmod
  600 on write). Document this in the README.
- Stored passwords (opt-in) go to Keychain by default; the file fallback is
  clearly labeled as weak.
- Never log tokens or passwords. `padi_auth_status` reports presence/expiry
  only, never values.
- `PADI_MASTER_KEY` is **not** used here (that's Feature 2); the local file
  encryption key is machine-local and auto-generated.

---

## Appendix — Cognito wire contracts (verified by probe)

### USER_PASSWORD_AUTH
Request:
```
POST https://cognito-idp.us-west-2.amazonaws.com/
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth

{"AuthFlow":"USER_PASSWORD_AUTH","ClientId":"2arn5r23p0ugce89a5moe95v1l",
 "AuthParameters":{"USERNAME":"<email>","PASSWORD":"<password>"}}
```
Success:
```json
{"AuthenticationResult":{"AccessToken":"...","ExpiresIn":3600,"IdToken":"...",
 "RefreshToken":"...","TokenType":"Bearer"},"ChallengeParameters":{}}
```
Failure (bad creds), HTTP 400:
```json
{"__type":"NotAuthorizedException","message":"Incorrect username or password."}
```
MFA/other challenge (not expected for PADI): top-level `ChallengeName`,
`Session`, `ChallengeParameters`, no `AuthenticationResult`.

### REFRESH_TOKEN_AUTH
Request:
```
{"AuthFlow":"REFRESH_TOKEN_AUTH","ClientId":"2arn5r23p0ugce89a5moe95v1l",
 "AuthParameters":{"REFRESH_TOKEN":"<refresh_token>"}}
```
Success: `AuthenticationResult` with `AccessToken`, `IdToken`, `ExpiresIn`,
`TokenType` — **no `RefreshToken`** (reuse the stored one).
Failure, HTTP 400:
```json
{"__type":"NotAuthorizedException","message":"Invalid Refresh Token"}
```
or `"Refresh Token has expired"` → map to `CognitoAuthError('RefreshExpired')`.

### ID token claims (decode payload, base64url)
Contains `sub`, `custom:affiliate_id`, `email`, `exp`, `iat`, `iss`, `aud`,
`cognito:username`. Derive `affiliate_id` and `cognito_sub` from here.
