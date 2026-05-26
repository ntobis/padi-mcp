import { afterEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  createInMemoryLimiter,
  enforcementEnabled,
  limitConfig,
  resetRateLimitState,
} from '../lib/ratelimit';

afterEach(() => resetRateLimitState());

describe('limitConfig', () => {
  it('uses sane defaults', () => {
    expect(limitConfig('tool', {})).toEqual({ max: 120, windowSeconds: 60 });
    expect(limitConfig('write', {})).toEqual({ max: 20, windowSeconds: 60 });
  });
  it('honours env overrides', () => {
    const env = { RATELIMIT_TOOL_MAX: '5', RATELIMIT_TOOL_WINDOW_S: '10' };
    expect(limitConfig('tool', env)).toEqual({ max: 5, windowSeconds: 10 });
  });
  it('ignores invalid env values', () => {
    expect(limitConfig('write', { RATELIMIT_WRITE_MAX: 'nonsense' })).toEqual({
      max: 20,
      windowSeconds: 60,
    });
  });
});

describe('enforcementEnabled', () => {
  it('is off by default and parses truthy values', () => {
    expect(enforcementEnabled({})).toBe(false);
    expect(enforcementEnabled({ RATELIMIT_ENFORCE: '1' })).toBe(true);
    expect(enforcementEnabled({ RATELIMIT_ENFORCE: 'true' })).toBe(true);
    expect(enforcementEnabled({ RATELIMIT_ENFORCE: '0' })).toBe(false);
  });
});

describe('in-memory sliding window', () => {
  it('counts hits within the window and drops expired ones', () => {
    const limiter = createInMemoryLimiter();
    const cfg = { max: 3, windowSeconds: 10 };
    expect(limiter.hit('u1', cfg, 1_000)).toBe(1);
    expect(limiter.hit('u1', cfg, 2_000)).toBe(2);
    expect(limiter.hit('u1', cfg, 3_000)).toBe(3);
    // At 11.5s the 1s hit has aged out of the 10s window; 2s + 3s remain, +1.
    expect(limiter.hit('u1', cfg, 11_500)).toBe(3);
    // At 14s the 2s + 3s hits have also aged out; only the 11.5s hit remains, +1.
    expect(limiter.hit('u1', cfg, 14_000)).toBe(2);
  });
  it('keeps separate keys independent', () => {
    const limiter = createInMemoryLimiter();
    const cfg = { max: 3, windowSeconds: 10 };
    expect(limiter.hit('a', cfg, 1_000)).toBe(1);
    expect(limiter.hit('b', cfg, 1_000)).toBe(1);
  });
});

describe('checkRateLimit (in-memory backend, no Upstash env)', () => {
  it('log-only mode allows even when over limit', async () => {
    const env = { RATELIMIT_TOOL_MAX: '2', RATELIMIT_TOOL_WINDOW_S: '60' };
    const u = 'user-logonly';
    expect((await checkRateLimit(u, 'tool', env)).overLimit).toBe(false);
    expect((await checkRateLimit(u, 'tool', env)).overLimit).toBe(false);
    const third = await checkRateLimit(u, 'tool', env);
    expect(third.overLimit).toBe(true);
    expect(third.allowed).toBe(true); // log-only: still allowed
    expect(third.enforced).toBe(false);
  });

  it('enforcing mode rejects over-limit calls', async () => {
    const env = {
      RATELIMIT_TOOL_MAX: '2',
      RATELIMIT_TOOL_WINDOW_S: '60',
      RATELIMIT_ENFORCE: '1',
    };
    const u = 'user-enforced';
    await checkRateLimit(u, 'tool', env);
    await checkRateLimit(u, 'tool', env);
    const third = await checkRateLimit(u, 'tool', env);
    expect(third.overLimit).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.enforced).toBe(true);
  });

  it('tool and write buckets are independent', async () => {
    const env = { RATELIMIT_WRITE_MAX: '1', RATELIMIT_ENFORCE: '1' };
    const u = 'user-buckets';
    expect((await checkRateLimit(u, 'write', env)).allowed).toBe(true);
    expect((await checkRateLimit(u, 'write', env)).allowed).toBe(false);
    // tool bucket untouched
    expect((await checkRateLimit(u, 'tool', env)).allowed).toBe(true);
  });
});
