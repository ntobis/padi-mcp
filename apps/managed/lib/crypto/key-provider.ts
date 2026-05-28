/**
 * Key providers wrap/unwrap a per-secret data-encryption key (DEK).
 *
 * Today the only provider keeps the key-encryption key (KEK) in env
 * (PADI_MASTER_KEY). The interface is async and the wrapped output is opaque, so
 * a future KMS-backed provider (AWS KMS Encrypt/Decrypt, GCP KMS, etc.) drops in
 * without touching the envelope code or the stored SealedSecret shape: implement
 * KeyProvider, point the default at it, and migrate stored rows with
 * `rewrapSecret` (see envelope.ts) + scripts/rotate-master-key.ts.
 *
 * The env provider's wrapped format is `base64(nonce || AES-256-GCM(dek) || tag)`
 * — byte-compatible with what was stored before this abstraction existed, so no
 * data migration is needed to adopt it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class EnvelopeKeyError extends Error {
  override readonly name = 'EnvelopeKeyError';
}

export interface KeyProvider {
  /** Stable id for logs/diagnostics, e.g. "env". */
  readonly id: string;
  /** Wrap (encrypt) a DEK, returning an opaque base64 blob. */
  wrapDek(dek: Buffer): Promise<string>;
  /** Unwrap (decrypt) a blob produced by wrapDek. */
  unwrapDek(wrapped: string): Promise<Buffer>;
}

/** Decode + validate a 32-byte base64 KEK from env. */
export function parseKek(b64: string | undefined, label = 'PADI_MASTER_KEY'): Buffer {
  if (!b64) {
    throw new EnvelopeKeyError(
      `${label} is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`,
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new EnvelopeKeyError(`${label} must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
  }
  return key;
}

/** AES-256-GCM DEK wrapping with a raw 32-byte KEK held in process env. */
export class EnvKeyProvider implements KeyProvider {
  readonly id = 'env';
  private readonly kek: Buffer;

  constructor(kek: Buffer) {
    if (kek.length !== KEY_BYTES) {
      throw new EnvelopeKeyError(`KEK must be ${KEY_BYTES} bytes, got ${kek.length}.`);
    }
    this.kek = kek;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): EnvKeyProvider {
    return new EnvKeyProvider(parseKek(env.PADI_MASTER_KEY));
  }

  async wrapDek(dek: Buffer): Promise<string> {
    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, nonce);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
  }

  async unwrapDek(wrapped: string): Promise<Buffer> {
    const buf = Buffer.from(wrapped, 'base64');
    const nonce = buf.subarray(0, GCM_NONCE_BYTES);
    const body = buf.subarray(GCM_NONCE_BYTES);
    const tag = body.subarray(body.length - GCM_TAG_BYTES);
    const ct = body.subarray(0, body.length - GCM_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
