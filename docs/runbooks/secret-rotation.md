# Runbook: secret rotation

How to rotate each secret the managed service depends on. Do these from a
machine that can reach the database and has the Vercel project access; never
commit secrets.

Inventory of secrets (Vercel project env, `padi-mcp-managed`):

| Secret | Used for | Rotatable without user impact? |
| --- | --- | --- |
| `PADI_MASTER_KEY` | Envelope KEK wrapping each per-tenant DEK | Yes — re-wrap script (below) |
| `WORKOS_API_KEY` | WorkOS server calls | Yes — dual-key window in WorkOS |
| `WORKOS_COOKIE_PASSWORD` | AuthKit session cookie sealing | Logs users out (re-login) |
| `DATABASE_URL` | Postgres (Neon) | Yes — Neon rotate + update env |
| `UPSTASH_REDIS_REST_TOKEN` | Rate-limit store (optional) | Yes — falls back to in-memory briefly |
| `ALERT_WEBHOOK_URL` | Abuse alerts (optional) | Yes — no user impact |

---

## 1. Rotate `PADI_MASTER_KEY` (the envelope KEK)

Envelope encryption means the master key only **wraps** each per-secret DEK; it
never encrypts the refresh token directly. Rotating it is therefore just
re-wrapping every stored DEK from the old key to the new one — ciphertext and
nonce are untouched and **no tenant has to re-login**.

1. Generate a new key:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Dry-run the re-wrap against production data (writes nothing):
   ```
   DATABASE_URL=<prod> \
   PADI_MASTER_KEY_OLD=<current key> \
   PADI_MASTER_KEY_NEW=<new key> \
   npm run rotate-master-key -w @padi-mcp/managed -- --dry-run
   ```
   Confirm it reports `N re-wrapped, 0 failed`.
3. Run for real (drop `--dry-run`). It updates only `wrapped_dek` per row and
   verifies each re-wrapped DEK unwraps under the new key before writing.
4. Set `PADI_MASTER_KEY=<new key>` in the Vercel project env and redeploy.
5. Verify: `padi_connection_status` then `padi_count_dives` for a test tenant
   (decrypt → mint → PADI call must still work). Keep the old key until verified;
   then remove `PADI_MASTER_KEY_OLD/NEW` from wherever you ran the script.

> The re-wrap is forward-safe even mid-deploy: old rows decrypt with the old
> key, re-wrapped rows decrypt with the new key, and the running app uses
> whichever `PADI_MASTER_KEY` is set. To be safe, run the script while the app
> still has the OLD key set, then flip the env.

## 2. Rotate `WORKOS_API_KEY`

Create a new API key in the WorkOS dashboard, set it in Vercel, redeploy, then
revoke the old key. WorkOS allows multiple active keys, so there is no outage.

## 3. Rotate `WORKOS_COOKIE_PASSWORD`

Generate a new ≥32-char value (`openssl rand -base64 32`), set it, redeploy.
Existing AuthKit sessions become invalid — users simply sign in again. No data
loss. (MCP connector OAuth tokens are separate and unaffected.)

## 4. Rotate `DATABASE_URL`

Rotate the Neon role password (or create a new role), update `DATABASE_URL`,
redeploy. Use a brief maintenance window (`SERVICE_DISABLED=1`) if you want to
avoid in-flight write errors during the cutover.

## 5. Rotate Upstash / alert webhook

Roll the token in the Upstash console (or regenerate the webhook), update the
env, redeploy. The rate limiter falls back to its in-memory window if Upstash is
briefly unreachable; alerts simply resume once the new URL is set.

---

## Future: migrating the KEK to a KMS

The envelope code is provider-agnostic (`lib/crypto/key-provider.ts`). To move
the KEK into a KMS:

1. Implement `KeyProvider` for the KMS (wrap/unwrap the DEK via the KMS
   Encrypt/Decrypt API). The methods are already async.
2. Migrate stored rows with the same `rewrapSecret` primitive the rotation
   script uses — from the env provider to the KMS provider — in a one-off script.
3. Point the envelope default at the KMS provider.

No change to the `SealedSecret` shape or the database schema is required.
