/**
 * Envelope encryption for secrets at rest (the PADI refresh token).
 *
 * - A per-secret DEK (data-encryption key): random 32 bytes, AES-256-GCM-encrypts
 *   the plaintext.
 * - The DEK is wrapped (encrypted) by a KeyProvider (see key-provider.ts). The
 *   default provider keeps the KEK in env (PADI_MASTER_KEY); a KMS provider can
 *   be swapped in without changing this file or the SealedSecret shape.
 *
 * We store ciphertext + nonce + wrapped DEK (all base64). To decrypt we unwrap
 * the DEK via the provider, then AES-GCM-decrypt the ciphertext. Rotating the
 * KEK (or migrating to KMS) only re-wraps the DEK — see `rewrapSecret`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EnvKeyProvider, type KeyProvider, parseKek } from './key-provider';

export { EnvelopeKeyError, EnvKeyProvider, type KeyProvider, parseKek } from './key-provider';

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SealedSecret {
  ciphertext: string; // base64: AES-GCM(ct) || tag
  nonce: string; // base64: nonce for the ciphertext
  wrappedDek: string; // base64: provider-wrapped DEK
}

/** Backward-compatible helper: the env KEK, validated. */
export function kekFromEnv(env: Record<string, string | undefined> = process.env): Buffer {
  return parseKek(env.PADI_MASTER_KEY);
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

export async function encryptSecret(
  plaintext: string,
  provider: KeyProvider = EnvKeyProvider.fromEnv(),
): Promise<SealedSecret> {
  const dek = randomBytes(KEY_BYTES);
  const { nonce, sealed } = gcmEncrypt(dek, Buffer.from(plaintext, 'utf8'));
  const wrappedDek = await provider.wrapDek(dek);
  return {
    ciphertext: sealed.toString('base64'),
    nonce: nonce.toString('base64'),
    wrappedDek,
  };
}

export async function decryptSecret(
  secret: SealedSecret,
  provider: KeyProvider = EnvKeyProvider.fromEnv(),
): Promise<string> {
  const dek = await provider.unwrapDek(secret.wrappedDek);
  const plaintext = gcmDecrypt(
    dek,
    Buffer.from(secret.nonce, 'base64'),
    Buffer.from(secret.ciphertext, 'base64'),
  );
  return plaintext.toString('utf8');
}

/**
 * Re-wrap a sealed secret's DEK from one provider to another WITHOUT touching
 * the ciphertext. This is the rotation/migration primitive: rotate the env KEK
 * (env -> env with a new key) or migrate to KMS (env -> kms). The returned
 * SealedSecret keeps the same ciphertext + nonce, only wrappedDek changes.
 */
export async function rewrapSecret(
  secret: SealedSecret,
  from: KeyProvider,
  to: KeyProvider,
): Promise<SealedSecret> {
  const dek = await from.unwrapDek(secret.wrappedDek);
  const wrappedDek = await to.wrapDek(dek);
  return { ...secret, wrappedDek };
}
