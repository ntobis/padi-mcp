/**
 * Envelope encryption for secrets at rest (the PADI refresh token).
 *
 * - KEK (key-encryption key): 32 bytes, base64, in env PADI_MASTER_KEY.
 * - Per-secret DEK (data-encryption key): random 32 bytes, AES-256-GCM-encrypts
 *   the plaintext; the DEK is then wrapped (encrypted) with the KEK.
 * We store ciphertext + nonce + wrapped DEK (all base64). To decrypt we unwrap
 * the DEK with the KEK, then decrypt the ciphertext.
 *
 * Upgrade path (pre-public): replace kekFromEnv() with a KMS GenerateDataKey/
 * Decrypt so the KEK never leaves the HSM. The SealedSecret shape stays the same.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SealedSecret {
  ciphertext: string; // base64: AES-GCM(ct) || tag
  nonce: string; // base64: nonce for the ciphertext
  wrappedDek: string; // base64: nonce || AES-GCM(dek) || tag
}

export class EnvelopeKeyError extends Error {
  override readonly name = 'EnvelopeKeyError';
}

export function kekFromEnv(): Buffer {
  const b64 = process.env.PADI_MASTER_KEY;
  if (!b64) {
    throw new EnvelopeKeyError(
      'PADI_MASTER_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new EnvelopeKeyError(`PADI_MASTER_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key;
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): { nonce: Buffer; sealed: Buffer } {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, sealed: Buffer.concat([ct, cipher.getAuthTag()]) };
}

function gcmDecrypt(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer {
  const tag = sealed.subarray(sealed.length - GCM_TAG_BYTES);
  const ct = sealed.subarray(0, sealed.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function encryptSecret(plaintext: string, kek: Buffer = kekFromEnv()): SealedSecret {
  const dek = randomBytes(KEY_BYTES);
  const { nonce, sealed } = gcmEncrypt(dek, Buffer.from(plaintext, 'utf8'));
  const wrap = gcmEncrypt(kek, dek);
  return {
    ciphertext: sealed.toString('base64'),
    nonce: nonce.toString('base64'),
    wrappedDek: Buffer.concat([wrap.nonce, wrap.sealed]).toString('base64'),
  };
}

export function decryptSecret(secret: SealedSecret, kek: Buffer = kekFromEnv()): string {
  const wrapped = Buffer.from(secret.wrappedDek, 'base64');
  const dekNonce = wrapped.subarray(0, GCM_NONCE_BYTES);
  const dek = gcmDecrypt(kek, dekNonce, wrapped.subarray(GCM_NONCE_BYTES));
  const plaintext = gcmDecrypt(dek, Buffer.from(secret.nonce, 'base64'), Buffer.from(secret.ciphertext, 'base64'));
  return plaintext.toString('utf8');
}
