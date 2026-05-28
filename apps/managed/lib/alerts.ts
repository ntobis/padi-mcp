/**
 * Abuse / operational alerting.
 *
 * When a tenant trips a rate limit (the first signal of abuse, useful even in
 * the log-only phase) we emit a structured log line and — if ALERT_WEBHOOK_URL
 * is set — fire-and-forget a JSON POST to it (a Slack/Discord incoming webhook
 * or any collector). Alerts are throttled per dedup key so a hammering client
 * yields one alert per window, not thousands. The webhook never blocks or fails
 * the request: it is not awaited and all errors are swallowed.
 */

const DEFAULT_THROTTLE_SECONDS = 300;

export interface AbuseAlert {
  type: 'rate_limit';
  userId: string;
  kind: string;
  limit: number;
  windowSeconds: number;
  enforced: boolean;
}

function throttleSeconds(env: Record<string, string | undefined>): number {
  const raw = env.ALERT_THROTTLE_S;
  if (raw === undefined || raw === '') return DEFAULT_THROTTLE_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_THROTTLE_SECONDS;
}

const lastSent = new Map<string, number>();

/** Test-only: clear throttle state. */
export function resetAlertState(): void {
  lastSent.clear();
}

/**
 * Throttle decision: returns true (and records the send) at most once per
 * throttle window per key. Exported for tests.
 */
export function shouldSend(key: string, nowMs: number, throttleMs: number): boolean {
  const prev = lastSent.get(key);
  if (prev !== undefined && nowMs - prev < throttleMs) return false;
  lastSent.set(key, nowMs);
  return true;
}

export function notifyAbuse(
  alert: AbuseAlert,
  env: Record<string, string | undefined> = process.env,
): void {
  const key = `${alert.type}:${alert.kind}:${alert.userId}`;
  if (!shouldSend(key, Date.now(), throttleSeconds(env) * 1000)) return;

  const summary =
    `[alert] ${alert.type} user=${alert.userId} kind=${alert.kind} ` +
    `limit=${alert.limit}/${alert.windowSeconds}s enforced=${alert.enforced}`;
  console.warn(summary);

  const url = env.ALERT_WEBHOOK_URL;
  if (url) void postWebhook(url, alert, summary);
}

async function postWebhook(url: string, alert: AbuseAlert, summary: string): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: summary, ...alert, at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error(`[alert] webhook POST failed: ${e instanceof Error ? e.message : e}`);
  }
}
