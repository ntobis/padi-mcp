import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { EnvKeyProvider, EnvelopeKeyError, parseKek } from '../lib/crypto/key-provider';

describe('EnvKeyProvider', () => {
  it('wraps and unwraps a DEK', async () => {
    const p = new EnvKeyProvider(randomBytes(32));
    const dek = randomBytes(32);
    const wrapped = await p.wrapDek(dek);
    expect(wrapped).not.toContain(dek.toString('base64'));
    expect(Buffer.compare(await p.unwrapDek(wrapped), dek)).toBe(0);
    expect(p.id).toBe('env');
  });

  it('produces a fresh wrap each time', async () => {
    const p = new EnvKeyProvider(randomBytes(32));
    const dek = randomBytes(32);
    expect(await p.wrapDek(dek)).not.toBe(await p.wrapDek(dek));
  });

  it('cannot unwrap a blob wrapped under a different KEK', async () => {
    const a = new EnvKeyProvider(randomBytes(32));
    const b = new EnvKeyProvider(randomBytes(32));
    const wrapped = await a.wrapDek(randomBytes(32));
    await expect(b.unwrapDek(wrapped)).rejects.toThrow();
  });

  it('rejects a KEK of the wrong length', () => {
    expect(() => new EnvKeyProvider(randomBytes(16))).toThrow(EnvelopeKeyError);
  });

  it('fromEnv reads + validates PADI_MASTER_KEY', () => {
    expect(() => EnvKeyProvider.fromEnv({})).toThrow(/not set/);
    expect(() => EnvKeyProvider.fromEnv({ PADI_MASTER_KEY: 'AAA' })).toThrow(/32 bytes/);
    const ok = randomBytes(32).toString('base64');
    expect(EnvKeyProvider.fromEnv({ PADI_MASTER_KEY: ok }).id).toBe('env');
  });
});

describe('parseKek', () => {
  it('uses the label in error messages', () => {
    expect(() => parseKek(undefined, 'PADI_MASTER_KEY_NEW')).toThrow(/PADI_MASTER_KEY_NEW/);
  });
});
