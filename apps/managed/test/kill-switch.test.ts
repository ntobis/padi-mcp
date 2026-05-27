import { describe, expect, it } from 'vitest';

import { checkServiceGate, serviceDisabled, userBanned } from '../lib/kill-switch';

describe('serviceDisabled', () => {
  it('reads truthy flag values', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes']) {
      expect(serviceDisabled({ SERVICE_DISABLED: v })).toBe(true);
    }
  });
  it('is false when unset or falsy', () => {
    expect(serviceDisabled({})).toBe(false);
    expect(serviceDisabled({ SERVICE_DISABLED: '0' })).toBe(false);
    expect(serviceDisabled({ SERVICE_DISABLED: '' })).toBe(false);
  });
});

describe('userBanned', () => {
  it('matches trimmed, comma-separated ids', () => {
    const env = { BANNED_USER_IDS: ' user_a , user_b ,, user_c ' };
    expect(userBanned('user_a', env)).toBe(true);
    expect(userBanned('user_b', env)).toBe(true);
    expect(userBanned('user_c', env)).toBe(true);
    expect(userBanned('user_d', env)).toBe(false);
  });
  it('is false with no list', () => {
    expect(userBanned('user_a', {})).toBe(false);
  });
});

describe('checkServiceGate', () => {
  it('passes when nothing is configured', () => {
    expect(checkServiceGate('user_a', {}, {})).toEqual({ blocked: false });
  });

  it('blocks everyone during global maintenance (with message)', () => {
    const env = { SERVICE_DISABLED: '1', SERVICE_DISABLED_MESSAGE: 'brb' };
    expect(checkServiceGate('user_a', {}, env)).toEqual({
      blocked: true,
      error: 'service_unavailable',
      message: 'brb',
    });
    // even account tools are blocked during hard maintenance
    expect(checkServiceGate('user_a', { allowAccountTools: true }, env).blocked).toBe(true);
  });

  it('blocks a banned user from PADI tools', () => {
    const env = { BANNED_USER_IDS: 'user_bad' };
    const r = checkServiceGate('user_bad', {}, env);
    expect(r.blocked).toBe(true);
    expect(r.error).toBe('account_suspended');
  });

  it('lets a banned user still reach account tools (data-subject rights)', () => {
    const env = { BANNED_USER_IDS: 'user_bad' };
    expect(checkServiceGate('user_bad', { allowAccountTools: true }, env)).toEqual({
      blocked: false,
    });
  });

  it('maintenance takes precedence over the ban allowance', () => {
    const env = { SERVICE_DISABLED: '1', BANNED_USER_IDS: 'user_bad' };
    expect(checkServiceGate('user_bad', { allowAccountTools: true }, env).error).toBe(
      'service_unavailable',
    );
  });
});
