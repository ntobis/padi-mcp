# WorkOS AuthKit setup (managed service)

Provisioning checklist for the managed service's caller authentication. WorkOS
AuthKit is the OAuth 2.1 Authorization Server; the MCP endpoint is the Resource
Server. (Only needed if you self-host `apps/managed` — the local server doesn't
use WorkOS.)

> Menu labels in the WorkOS dashboard shift over time. Where a label differs,
> the **target** described here is what matters.

## 1. Create the account + app
- Sign up at <https://workos.com> and open the dashboard.
- Start in the **Staging/Test** environment for local development.

## 2. Grab credentials (→ local `.env.local`; keep the API key secret)
- Dashboard → **API Keys**. Copy:
  - **Client ID** — `client_…` (not secret)
  - **Secret API Key** — `sk_test_…` (**secret** — keep it local)

## 3. Configure AuthKit (user login)
- Dashboard → **AuthKit** → enable it.
- Enable at least one sign-in method (Email + Password or Magic Auth).
- Redirects are configured **per application**: Dashboard → **Applications →
  your app → Redirects**. Add a sign-in callback `http://localhost:3000/callback`
  and a logout redirect `http://localhost:3000`. For a deployed instance, add the
  equivalents on your production domain.
- Note your **AuthKit domain** (e.g. `https://<slug>.authkit.app`).

## 4. Enable MCP auth (Dynamic Client Registration + CIMD)
This lets an MCP client self-register and authenticate. Under **Applications →
Configuration** (and/or **Connect**), enable:
- **Dynamic Client Registration (DCR)** — with default scopes `openid profile email`.
- **Client ID Metadata Document (CIMD)**.

## 5. Generate the session-cookie secret (local only)
```bash
openssl rand -base64 32
```

## 6. Add to `apps/managed/.env.local`
```
WORKOS_API_KEY=sk_test_…            # SECRET — keep local
WORKOS_CLIENT_ID=client_…
WORKOS_COOKIE_PASSWORD=<openssl rand -base64 32 output>   # >=32 chars
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
PADI_MASTER_KEY=<base64 32 bytes>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
DATABASE_URL=…                      # local Postgres or Neon
```

See [`apps/managed/.env.example`](../../apps/managed/.env.example) for the full
list of supported variables (rate limiting, alerting, kill-switch, etc.).
