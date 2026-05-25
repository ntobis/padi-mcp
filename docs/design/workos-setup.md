# WorkOS AuthKit setup (Feature 2, Phase 4)

Provisioning checklist for Layer-1 caller auth. WorkOS AuthKit is the OAuth 2.1
Authorization Server; our MCP endpoint is the Resource Server. Free tier covers
up to 1M monthly active users.

> Menu labels in the WorkOS dashboard shift over time. Where a label differs,
> the **target** described here is what matters.

## 1. Create the account + app
- Sign up at https://workos.com and open the dashboard.
- You start in the **Staging/Test** environment — use it for all local dev.

## 2. Grab credentials (→ local `.env.local`, keep the API key secret)
- Dashboard → **API Keys** (and dashboard home). Copy:
  - **Client ID** — `client_01…` (not secret, OK to share)
  - **Secret API Key** — `sk_test_01…` (**secret** — keep it local, do not paste in chat)

## 3. Configure AuthKit (the user login)
- Dashboard → **AuthKit** → set it up / enable.
- Enable at least one sign-in method (Email + Password or Magic Auth is fine for dev).
- **Redirects**: add a sign-in callback URI `http://localhost:3000/callback`
  and a logout redirect `http://localhost:3000`.
- Note your **AuthKit domain** (e.g. `https://<slug>.authkit.app`) — shown in
  the AuthKit configuration.

## 4. Enable MCP auth (Dynamic Client Registration + CIMD)
This is what lets Claude self-register and authenticate.
- Dashboard → **Applications → Configuration → Dynamic Client Registration → Manage**:
  enable **DCR** and add default scopes `openid profile email`.
- Dashboard → **Connect → Configuration → MCP Auth settings**: enable both
  **Client ID Metadata Document (CIMD)** and **Dynamic Client Registration (DCR)**.

## 5. Generate the session cookie secret (local only)
```bash
openssl rand -base64 32
```

## 6. Add to `apps/managed/.env.local`
```
WORKOS_API_KEY=sk_test_…            # SECRET — keep local
WORKOS_CLIENT_ID=client_…
WORKOS_COOKIE_PASSWORD=<openssl rand -base64 32 output>   # >=32 chars
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
# already present from earlier phases:
PADI_MASTER_KEY=<base64 32 bytes>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
DATABASE_URL=…                      # a local Postgres or Neon (Phase 6); optional until then
```

## 7. Send me (non-secret only)
- `WORKOS_CLIENT_ID`
- your **AuthKit domain** (`…authkit.app`)
- confirmation that **DCR + CIMD** are enabled

Keep `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` in your local `.env.local` —
I never need their values to write or wire the code.

## What I'll build once provisioned
- Install `@workos-inc/authkit-nextjs`; add middleware + `app/callback/route.ts`.
- Gate `/connect` behind AuthKit and replace the `getCurrentUserId()` stub with
  the authenticated WorkOS user id (the real tenant key).
- Add `withMcpAuth` to `/api/mcp` so the endpoint returns `401` +
  `WWW-Authenticate` with Protected Resource Metadata, and verifies WorkOS
  bearer tokens (JWKS) on every call.
- Verify the full OAuth handshake locally with the MCP Inspector / a client.
