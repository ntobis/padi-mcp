# Runbook: taking the managed service public

For operators of `apps/managed`. New tenants are provisioned automatically on
first connect (`connectPadiAccount` upserts the `users` row), so there's no
per-user setup — whether signup is open is governed by your WorkOS settings.

## Pre-launch checklist

- [ ] **You have the right to operate** against your data source under its terms
      of use.
- [ ] **Rate limiting enforced** — set `RATELIMIT_ENFORCE=1` (the limiter is wired
      but log-only until then). Provision Upstash (`UPSTASH_REDIS_REST_URL/TOKEN`)
      so limits are durable across serverless instances rather than per-instance.
- [ ] **Abuse alerting on** — set `ALERT_WEBHOOK_URL` so over-limit events notify
      you.
- [ ] **Kill-switch understood** — confirm `SERVICE_DISABLED=1` puts the tools
      into maintenance, and how to set `BANNED_USER_IDS`.
- [ ] **Legal pages reviewed** — `/terms` and `/privacy` content + contact
      confirmed.
- [ ] **Secret rotation** — you've read [`secret-rotation.md`](secret-rotation.md)
      and can rotate `PADI_MASTER_KEY`.

## Go live

1. In WorkOS, set the AuthKit sign-up flow as open or restricted to taste, and
   enable the sign-in methods you want.
2. Confirm production env: `RATELIMIT_ENFORCE=1`, `ALERT_WEBHOOK_URL` set,
   `SERVICE_DISABLED` **unset**.
3. Redeploy.

## Smoke test as a brand-new user

1. Add the connector (`https://<your-deployment>/api/mcp`) and, at the AuthKit
   screen, **sign up with a fresh email** — this creates a new tenant.
2. Before linking, a tool call should return `not_connected` with the correct
   `connect_url` (your production domain).
3. Visit `/connect`, sign in with that email, enter the account credentials.
4. `padi_count_dives` works. Then `padi_delete_my_data` to clean up the test
   tenant.

## Rollback

Set `SERVICE_DISABLED=1` (maintenance) or tighten the WorkOS signup setting. The
kill-switch is the fastest lever if something goes wrong post-launch.
