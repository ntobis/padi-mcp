import { describe, expect, it } from 'vitest';
import { REQUIRED_ENV_VARS, assertEnvOrThrow, bootSummary, validateEnv } from '../lib/env-guard';

function fullEnv(): Partial<NodeJS.ProcessEnv> {
  return {
    WORKOS_API_KEY: 'sk_test_abcdefghijklmnop1234',
    WORKOS_CLIENT_ID: 'client_01ABCDEFG',
    WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
    WORKOS_AUTHKIT_DOMAIN: 'https://example.authkit.app',
    PADI_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
    DATABASE_URL: 'postgres://localhost/padi_mcp',
  };
}

describe('validateEnv', () => {
  it('returns ok when all required vars are set', () => {
    expect(validateEnv(fullEnv())).toEqual({ ok: true, missing: [] });
  });

  it('flags every missing var (no early exit)', () => {
    expect(validateEnv({})).toEqual({ ok: false, missing: [...REQUIRED_ENV_VARS] });
  });

  it('treats empty string as missing (silent dotenv gotcha)', () => {
    const env = fullEnv();
    env.WORKOS_API_KEY = '';
    expect(validateEnv(env)).toEqual({ ok: false, missing: ['WORKOS_API_KEY'] });
  });

  it('reports only the missing ones when most are set', () => {
    const env = fullEnv();
    env.WORKOS_API_KEY = undefined;
    env.DATABASE_URL = undefined;
    const r = validateEnv(env);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['WORKOS_API_KEY', 'DATABASE_URL']);
  });
});

describe('assertEnvOrThrow', () => {
  it('does not throw when env is complete', () => {
    expect(() => assertEnvOrThrow(fullEnv())).not.toThrow();
  });

  it('throws with a message listing missing vars', () => {
    const env = fullEnv();
    env.WORKOS_CLIENT_ID = undefined;
    env.PADI_MASTER_KEY = undefined;
    expect(() => assertEnvOrThrow(env)).toThrow(/WORKOS_CLIENT_ID.*PADI_MASTER_KEY/);
  });
});

describe('bootSummary', () => {
  it('logs full client_id and only last 4 of API key', () => {
    const line = bootSummary(fullEnv());
    expect(line).toContain('WORKOS_CLIENT_ID=client_01ABCDEFG');
    expect(line).toContain('WORKOS_API_KEY=…1234');
    expect(line).not.toContain('sk_test_abcdefghijklmnop');
  });

  it('marks unset values explicitly without crashing', () => {
    const line = bootSummary({});
    expect(line).toContain('WORKOS_CLIENT_ID=<unset>');
    expect(line).toContain('WORKOS_API_KEY=<unset>');
  });
});
