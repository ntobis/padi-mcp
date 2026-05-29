/**
 * Local audit trail for deletions, appended to docs/deletions.log. Best-effort:
 * a write failure (e.g. when the server is launched from a foreign cwd) must
 * never turn a successful delete into a reported failure. The managed service
 * uses a database audit table instead.
 */
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeleteStrategy } from '@padi-mcp/core';

export async function logDeletion(
  diveId: number,
  title: string | null,
  date: string | null,
  strategy: DeleteStrategy,
  result: 'success' | 'failed',
  actor: string,
): Promise<void> {
  const line =
    `${new Date().toISOString()} dive_id=${diveId} title=${JSON.stringify(title)} ` +
    `date=${date} strategy=${strategy} result=${result} actor=${actor}\n`;
  try {
    await appendFile(resolve(process.cwd(), 'docs/deletions.log'), line, 'utf8');
  } catch (e) {
    console.error(
      `deletion-log: could not write audit line: ${e instanceof Error ? e.message : e}`,
    );
  }
}
