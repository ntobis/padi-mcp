import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EnvKeyProvider,
  type SealedSecret,
  decryptSecret,
  encryptSecret,
  kekFromEnv,
  rewrapSecret,
} from '../lib/crypto/envelope';

const provider = new EnvKeyProvider(randomBytes(32));

describe('envelope encryption', () => {
  it('round-trips a secret', async () => {
    const sealed = await encryptSecret('my-refresh-token', provider);
    expect(await decryptSecret(sealed, provider)).toBe('my-refresh-token');
  });

  it('produces a fresh DEK + nonces each time (no deterministic output)', async () => {
    const a = await encryptSecret('same', provider);
    const b = await encryptSecret('same', provider);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('never exposes the plaintext in the sealed output', async () => {
    const sealed = await encryptSecret('super-secret-refresh-token', provider);
    expect(JSON.stringify(sealed)).not.toContain('super-secret-refresh-token');
  });

  it('fails to decrypt with the wrong KEK', async () => {
    const sealed = await encryptSecret('x', provider);
    await expect(decryptSecret(sealed, new EnvKeyProvider(randomBytes(32)))).rejects.toThrow();
  });

  it('detects tampering with the ciphertext (GCM auth tag)', async () => {
    const sealed = await encryptSecret('x', provider);
    const buf = Buffer.from(sealed.ciphertext, 'base64');
    buf[0] = buf[0]! ^ 0xff;
    const tampered: SealedSecret = { ...sealed, ciphertext: buf.toString('base64') };
    await expect(decryptSecret(tampered, provider)).rejects.toThrow();
  });

  it('rewraps to a new KEK without changing the ciphertext (rotation)', async () => {
    const oldP = new EnvKeyProvider(randomBytes(32));
    const newP = new EnvKeyProvider(randomBytes(32));
    const sealed = await encryptSecret('rotate-me', oldP);

    const rotated = await rewrapSecret(sealed, oldP, newP);
    expect(rotated.ciphertext).toBe(sealed.ciphertext);
    expect(rotated.nonce).toBe(sealed.nonce);
    expect(rotated.wrappedDek).not.toBe(sealed.wrappedDek);

    // decrypts under the new key, no longer under the old one
    expect(await decryptSecret(rotated, newP)).toBe('rotate-me');
    await expect(decryptSecret(rotated, oldP)).rejects.toThrow();
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
