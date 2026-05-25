import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCredentialStore } from '../src/auth/credential-store.js';

describe('FileCredentialStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'padi-cred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips an encrypted password', async () => {
    const store = new FileCredentialStore(dir);
    await store.savePassword('me@x.com', 'hunter2');
    expect(await store.loadPassword('me@x.com')).toBe('hunter2');
  });

  it('returns null for an unknown user', async () => {
    const store = new FileCredentialStore(dir);
    expect(await store.loadPassword('nobody@x.com')).toBeNull();
  });

  it('clears a stored password', async () => {
    const store = new FileCredentialStore(dir);
    await store.savePassword('me@x.com', 'pw');
    await store.clear('me@x.com');
    expect(await store.loadPassword('me@x.com')).toBeNull();
  });

  it('does not store the password in plaintext on disk', async () => {
    const store = new FileCredentialStore(dir);
    await store.savePassword('me@x.com', 'super-secret-value');
    const { readFile, readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    for (const f of files) {
      const contents = await readFile(join(dir, f), 'utf8');
      expect(contents).not.toContain('super-secret-value');
    }
  });
});
