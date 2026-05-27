# Runbook: opening signup to the public

Decision (2026-05): launch **fully open** — anyone who can authenticate via
WorkOS AuthKit can connect their PADI account. There is no email allowlist gate.
New tenants are provisioned automatically on first connect (`connectPadiAccount`
upserts the `users` row), so no per-user setup is needed.

## Pre-flip checklist (all must be true)

- [ ] **PADI ToS review complete** — `docs/padi-tos-review.md` filled in with the
      decision. This is the real launch blocker.
- [ ] **Rate limiting enforced** — set `RATELIMIT_ENFORCE=1` in Vercel (the
      limiter is built + wired; it is log-only until this flag is set). Consider
      provisioning Upstash (`UPSTASH_REDIS_REST_URL/TOKEN`) so limits are durable
      across serverless instances rather than per-instance in-memory.
- [ ] **Abuse alerting on** — set `ALERT_WEBHOOK_URL` so over-limit events page
      you (Slack/Discord/collector).
- [ ] **Kill-switch verified** — confirm `SERVICE_DISABLED=1` takes the tools
      into maintenance, and you know how to set `BANNED_USER_IDS`.
- [ ] **Legal pages reviewed** — `/terms` and `/privacy` content + contact/entity
      confirmed (remove the DRAFT banner once signed off).
- [ ] **Secret-rotation runbook** read; you can rotate `PADI_MASTER_KEY` if needed.

## Flip

1. In the WorkOS dashboard, ensure the AuthKit sign-in/sign-up flow is open (no
   invite-only / domain restriction) and Email+Password (and any social
   providers you want) are enabled.
2. Confirm production env: `RATELIMIT_ENFORCE=1`, `ALERT_WEBHOOK_URL` set,
   `SERVICE_DISABLED` **unset**.
3. Redeploy.

## Smoke test as a brand-new user

1. Add the connector (`https://padi-mcp-managed.vercel.app/api/mcp`) and at the
   AuthKit screen **sign up with a fresh email** — this creates a new tenant.
2. Before linking, a tool call should return `not_connected` with the correct
   `connect_url` (the production domain, not localhost).
3. Visit `/connect`, sign in with that email, enter PADI credentials.
4. `padi_count_dives` works. Then `padi_delete_my_data` to clean up the test
   tenant.

## Rollback

Set `SERVICE_DISABLED=1` (maintenance) or revert the WorkOS signup setting. The
kill-switch is the fastest lever if something goes wrong post-launch.
