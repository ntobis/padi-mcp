import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type SealedSecret, decryptSecret, encryptSecret, kekFromEnv } from '../lib/crypto/envelope';

const KEK = randomBytes(32);

describe('envelope encryption', () => {
  it('round-trips a secret', () => {
    const sealed = encryptSecret('my-refresh-token', KEK);
    expect(decryptSecret(sealed, KEK)).toBe('my-refresh-token');
  });

  it('produces a fresh DEK + nonces each time (no deterministic output)', () => {
    const a = encryptSecret('same', KEK);
    const b = encryptSecret('same', KEK);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('never exposes the plaintext in the sealed output', () => {
    const sealed = encryptSecret('super-secret-refresh-token', KEK);
    const blob = JSON.stringify(sealed);
    expect(blob).not.toContain('super-secret-refresh-token');
  });

  it('fails to decrypt with the wrong KEK', () => {
    const sealed = encryptSecret('x', KEK);
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
  });

  it('detects tampering with the ciphertext (GCM auth tag)', () => {
    const sealed = encryptSecret('x', KEK);
    const buf = Buffer.from(sealed.ciphertext, 'base64');
    buf[0] = buf[0]! ^ 0xff;
    const tampered: SealedSecret = { ...sealed, ciphertext: buf.toString('base64') };
    expect(() => decryptSecret(tampered, KEK)).toThrow();
  });

  it('kekFromEnv validates the master key length', () => {
    const prev = process.env.PADI_MASTER_KEY;
    process.env.PADI_MASTER_KEY = Buffer.from('too-short').toString('base64');
    expect(() => kekFromEnv()).toThrow(/32 bytes/);
    process.env.PADI_MASTER_KEY = randomBytes(32).toString('base64');
    expect(kekFromEnv()).toHaveLength(32);
    if (prev === undefined) delete process.env.PADI_MASTER_KEY;
    else process.env.PADI_MASTER_KEY = prev;
  });
});
