import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyAbuse, resetAlertState, shouldSend } from '../lib/alerts';

beforeEach(() => resetAlertState());
afterEach(() => vi.restoreAllMocks());

describe('shouldSend (throttle)', () => {
  it('sends the first hit, suppresses within the window, sends again after it', () => {
    const t0 = 1_000_000;
    expect(shouldSend('k', t0, 5000)).toBe(true);
    expect(shouldSend('k', t0 + 1000, 5000)).toBe(false);
    expect(shouldSend('k', t0 + 4999, 5000)).toBe(false);
    expect(shouldSend('k', t0 + 5000, 5000)).toBe(true);
  });

  it('throttles per key independently', () => {
    const t0 = 0;
    expect(shouldSend('a', t0, 5000)).toBe(true);
    expect(shouldSend('b', t0, 5000)).toBe(true);
    expect(shouldSend('a', t0 + 1, 5000)).toBe(false);
  });
});

describe('notifyAbuse', () => {
  const alert = {
    type: 'rate_limit' as const,
    userId: 'user_a',
    kind: 'write',
    limit: 20,
    windowSeconds: 60,
    enforced: true,
  };

  it('logs once per throttle window and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notifyAbuse(alert, {});
    notifyAbuse(alert, {}); // throttled
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not POST when no webhook is configured', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
    notifyAbuse(alert, {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires a fire-and-forget webhook POST when configured', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
    notifyAbuse(alert, { ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/x');
    expect(init?.method).toBe('POST');
  });
});
