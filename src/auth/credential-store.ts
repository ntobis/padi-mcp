/**
 * Optional PADI password storage for fully-hands-off re-login when the refresh
 * token eventually expires. OFF by default — only used if the user passes
 * `remember_password` to padi_login.
 *
 * Two backends:
 *  - KeychainCredentialStore: macOS Keychain via the `security` CLI (no native
 *    dependency). Preferred when available.
 *  - FileCredentialStore: AES-256-GCM file in inputs/, keyed by a machine-local
 *    key generated on first use (chmod 600). Plaintext-equivalent if the
 *    machine is compromised — used only when Keychain is unavailable.
 */
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CredentialStore {
  savePassword(username: string, password: string): Promise<void>;
  loadPassword(username: string): Promise<string | null>;
  clear(username: string): Promise<void>;
}

const KEYCHAIN_SERVICE = 'padi-mcp';

export class KeychainCredentialStore implements CredentialStore {
  static async isAvailable(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    try {
      await execFileAsync('security', ['help']);
      return true;
    } catch {
      return false;
    }
  }

  async savePassword(username: string, password: string): Promise<void> {
    // -U updates the item if it already exists.
    await execFileAsync('security', [
      'add-generic-password',
      '-U',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      username,
      '-w',
      password,
    ]);
  }

  async loadPassword(username: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        username,
        '-w',
      ]);
      return stdout.replace(/\n$/, '');
    } catch {
      return null;
    }
  }

  async clear(username: string): Promise<void> {
    try {
      await execFileAsync('security', [
        'delete-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        username,
      ]);
    } catch {
      // Not present — nothing to clear.
    }
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(MODULE_DIR, '../../inputs');

interface EncryptedRecord {
  iv: string;
  ct: string;
  tag: string;
}

export class FileCredentialStore implements CredentialStore {
  private readonly keyPath: string;
  private readonly dataPath: string;

  constructor(baseDir: string = DEFAULT_DIR) {
    this.keyPath = resolve(baseDir, '.cred-key');
    this.dataPath = resolve(baseDir, 'credentials.enc.json');
  }

  private async getKey(): Promise<Buffer> {
    try {
      const hex = await readFile(this.keyPath, 'utf8');
      return Buffer.from(hex.trim(), 'hex');
    } catch {
      const key = randomBytes(32);
      await mkdir(dirname(this.keyPath), { recursive: true });
      await writeFile(this.keyPath, key.toString('hex'), 'utf8');
      await chmod(this.keyPath, 0o600).catch(() => {});
      return key;
    }
  }

  private async readAll(): Promise<Record<string, EncryptedRecord>> {
    try {
      return JSON.parse(await readFile(this.dataPath, 'utf8')) as Record<string, EncryptedRecord>;
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, EncryptedRecord>): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    await writeFile(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
    await chmod(this.dataPath, 0o600).catch(() => {});
  }

  async savePassword(username: string, password: string): Promise<void> {
    const key = await this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const data = await this.readAll();
    data[username] = { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') };
    await this.writeAll(data);
  }

  async loadPassword(username: string): Promise<string | null> {
    const data = await this.readAll();
    const rec = data[username];
    if (!rec) return null;
    try {
      const key = await this.getKey();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(rec.tag, 'hex'));
      const pt = Buffer.concat([decipher.update(Buffer.from(rec.ct, 'hex')), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      return null;
    }
  }

  async clear(username: string): Promise<void> {
    const data = await this.readAll();
    if (data[username]) {
      delete data[username];
      await this.writeAll(data);
    }
  }
}

let cached: CredentialStore | null = null;

/** Pick the best available backend: Keychain on macOS, else the encrypted file. */
export async function getCredentialStore(): Promise<CredentialStore> {
  if (cached) return cached;
  cached = (await KeychainCredentialStore.isAvailable())
    ? new KeychainCredentialStore()
    : new FileCredentialStore();
  return cached;
}
