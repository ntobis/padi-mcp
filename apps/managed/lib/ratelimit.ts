/**
 * Per-tenant rate limiting for the managed MCP endpoint (design 02, Phase 5).
 *
 * Two buckets, keyed by the authenticated WorkOS user id (never by anything
 * the caller controls):
 *   - 'tool'  — every PADI tool call (generous).
 *   - 'write' — create/update/delete only (tighter).
 *
 * Backend: Upstash Redis sliding-window when UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN are set (durable across Vercel's stateless
 * invocations). Otherwise an in-memory sliding-window fallback — per-instance
 * only, which is fine for local dev and the log-only private phase.
 *
 * Mode: LOG-ONLY by default. Over-limit calls are logged to stderr but still
 * allowed (allowed=true). Set RATELIMIT_ENFORCE=1 to actually reject over-limit
 * calls — the "public phase" flip, no code change required.
 */

export type LimitKind = 'tool' | 'write';

export interface LimitConfig {
  max: number;
  windowSeconds: number;
}

export interface LimitDecision {
  kind: LimitKind;
  /** false only when the call is over-limit AND enforcement is on. */
  allowed: boolean;
  /** the window count exceeded `max` (independent of enforcement). */
  overLimit: boolean;
  limit: number;
  remaining: number;
  enforced: boolean;
}

const DEFAULTS: Record<LimitKind, LimitConfig> = {
  tool: { max: 120, windowSeconds: 60 },
  write: { max: 20, windowSeconds: 60 },
};

function intFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function limitConfig(
  kind: LimitKind,
  env: Record<string, string | undefined> = process.env,
): LimitConfig {
  const prefix = kind === 'tool' ? 'RATELIMIT_TOOL' : 'RATELIMIT_WRITE';
  return {
    max: intFromEnv(env, `${prefix}_MAX`, DEFAULTS[kind].max),
    windowSeconds: intFromEnv(env, `${prefix}_WINDOW_S`, DEFAULTS[kind].windowSeconds),
  };
}

export function enforcementEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.RATELIMIT_ENFORCE ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// ---------- In-memory sliding-window-log (fallback + unit-testable) ----------

export interface SlidingWindowLimiter {
  /** Record a hit and return the number of hits in the current window. */
  hit(key: string, cfg: LimitConfig, nowMs?: number): number;
  reset(): void;
}

export function createInMemoryLimiter(): SlidingWindowLimiter {
  const log = new Map<string, number[]>();
  return {
    hit(key, cfg, nowMs = Date.now()) {
      const windowMs = cfg.windowSeconds * 1000;
      const cutoff = nowMs - windowMs;
      const arr = (log.get(key) ?? []).filter((t) => t > cutoff);
      arr.push(nowMs);
      log.set(key, arr);
      return arr.length;
    },
    reset() {
      log.clear();
    },
  };
}

// ---------- Upstash backend (lazy, only when configured) ----------

interface UpstashLimiter {
  limit(key: string): Promise<{ success: boolean; limit: number; remaining: number }>;
}

const upstashCache = new Map<LimitKind, UpstashLimiter | null>();
let inMemory: SlidingWindowLimiter | null = null;

function upstashConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

async function getUpstashLimiter(
  kind: LimitKind,
  cfg: LimitConfig,
): Promise<UpstashLimiter | null> {
  if (upstashCache.has(kind)) return upstashCache.get(kind) ?? null;
  try {
    const { Ratelimit } = await import('@upstash/ratelimit');
    const { Redis } = await import('@upstash/redis');
    const limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(cfg.max, `${cfg.windowSeconds} s`),
      prefix: `padi:rl:${kind}`,
    }) as unknown as UpstashLimiter;
    upstashCache.set(kind, limiter);
    return limiter;
  } catch (e) {
    console.error(
      `[ratelimit] Upstash configured but failed to initialise (${e instanceof Error ? e.message : e}); falling back to in-memory.`,
    );
    upstashCache.set(kind, null);
    return null;
  }
}

/** Test-only: clear cached backends + in-memory state. */
export function resetRateLimitState(): void {
  upstashCache.clear();
  inMemory?.reset();
  inMemory = null;
}

export async function checkRateLimit(
  userId: string,
  kind: LimitKind,
  env: Record<string, string | undefined> = process.env,
): Promise<LimitDecision> {
  const cfg = limitConfig(kind, env);
  const enforced = enforcementEnabled(env);

  let overLimit: boolean;
  let remaining: number;

  if (upstashConfigured(env)) {
    const limiter = await getUpstashLimiter(kind, cfg);
    if (limiter) {
      const res = await limiter.limit(userId);
      overLimit = !res.success;
      remaining = Math.max(0, res.remaining);
    } else {
      ({ overLimit, remaining } = inMemoryDecision(userId, kind, cfg));
    }
  } else {
    ({ overLimit, remaining } = inMemoryDecision(userId, kind, cfg));
  }

  if (overLimit) {
    console.error(
      `[ratelimit] over-limit user=${userId} kind=${kind} limit=${cfg.max}/${cfg.windowSeconds}s enforced=${enforced}`,
    );
  }

  return {
    kind,
    allowed: !(overLimit && enforced),
    overLimit,
    limit: cfg.max,
    remaining,
    enforced,
  };
}

function inMemoryDecision(
  userId: string,
  kind: LimitKind,
  cfg: LimitConfig,
): { overLimit: boolean; remaining: number } {
  if (!inMemory) inMemory = createInMemoryLimiter();
  const count = inMemory.hit(`${kind}:${userId}`, cfg);
  return { overLimit: count > cfg.max, remaining: Math.max(0, cfg.max - count) };
}
