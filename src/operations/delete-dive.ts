/**
 * Delete a dive. No mutation was captured on the wire — the brief lists
 * three strategies to probe, in order. We expose them all as named
 * functions; `deleteDive` runs them in sequence until one succeeds.
 *
 * Strategy A — soft delete via `update_logbook_logs _set: {status: ...}`
 * Strategy B — hard delete via `delete_logbook_logs` (assumes FK cascade)
 * Strategy C — per-table deletes (mirror of the update mutation)
 *
 * Whichever wins for this account is recorded in docs/discovered-schema.md
 * and used as the default on subsequent calls. We persist the winning
 * strategy in-memory only — restart and we'll re-probe (idempotent).
 */
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { graphql, GraphQLError } from '../padi-client.js';
import { getDive } from './get-dive.js';

const SOFT_DELETE_MUTATION = `mutation SoftDelete($id: Int!, $status: String!) {
  update_logbook_logs(where: {id: {_eq: $id}}, _set: {status: $status}) {
    affected_rows
  }
}`;

const HARD_DELETE_MUTATION = `mutation HardDelete($id: Int!) {
  delete_logbook_logs(where: {id: {_eq: $id}}) {
    affected_rows
  }
}`;

const PER_TABLE_DELETE_MUTATION = `mutation PerTableDelete($id: Int!) {
  delete_logbook_depth_time(where: {logs_id: {_eq: $id}}) { affected_rows }
  delete_logbook_conditions(where: {logs_id: {_eq: $id}}) { affected_rows }
  delete_logbook_equipment(where: {logs_id: {_eq: $id}}) { affected_rows }
  delete_logbook_experience(where: {logs_id: {_eq: $id}}) { affected_rows }
  delete_logbook_skills(where: {logs_id: {_eq: $id}}) { affected_rows }
  delete_logbook_logs(where: {id: {_eq: $id}}) { affected_rows }
}`;

export type DeleteStrategy = 'soft' | 'hard' | 'per-table';

let cachedStrategy: DeleteStrategy | null = null;

export async function softDelete(diveId: number, status = 'Trash'): Promise<boolean> {
  await graphql({
    operationName: 'SoftDelete',
    query: SOFT_DELETE_MUTATION,
    variables: { id: diveId, status },
  });
  // Verify the dive no longer appears as a normal status
  const after = await getDive(diveId);
  // If we can still read it AND it shows as the soft-delete status, that's a successful soft delete.
  return after !== null && after.status === status;
}

export async function hardDelete(diveId: number): Promise<boolean> {
  const data = await graphql<{ delete_logbook_logs: { affected_rows: number } }>({
    operationName: 'HardDelete',
    query: HARD_DELETE_MUTATION,
    variables: { id: diveId },
  });
  if (data.delete_logbook_logs.affected_rows < 1) return false;
  const after = await getDive(diveId);
  return after === null;
}

export async function perTableDelete(diveId: number): Promise<boolean> {
  await graphql({
    operationName: 'PerTableDelete',
    query: PER_TABLE_DELETE_MUTATION,
    variables: { id: diveId },
  });
  const after = await getDive(diveId);
  return after === null;
}

/**
 * Try the strategies in order and remember which one worked.
 *
 * Order rationale: hard delete first because it's the cleanest outcome
 * (no orphan rows). If FKs reject it we fall through to per-table, which
 * mirrors the captured update mutation's table layout. Soft-delete last —
 * leaves rows behind, so only used if both hard paths fail.
 */
export async function deleteDive(diveId: number): Promise<DeleteStrategy> {
  if (cachedStrategy) {
    const ok = await runStrategy(cachedStrategy, diveId);
    if (ok) return cachedStrategy;
    cachedStrategy = null;
  }
  const order: DeleteStrategy[] = ['hard', 'per-table', 'soft'];
  let lastError: unknown = null;
  for (const strategy of order) {
    try {
      const ok = await runStrategy(strategy, diveId);
      if (ok) {
        cachedStrategy = strategy;
        return strategy;
      }
    } catch (e) {
      lastError = e;
      if (e instanceof GraphQLError) {
        // Try the next strategy.
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    `All delete strategies failed for dive ${diveId}` +
      (lastError instanceof Error ? `: ${lastError.message}` : ''),
  );
}

async function runStrategy(strategy: DeleteStrategy, diveId: number): Promise<boolean> {
  switch (strategy) {
    case 'soft':
      return softDelete(diveId);
    case 'hard':
      return hardDelete(diveId);
    case 'per-table':
      return perTableDelete(diveId);
  }
}

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
  await appendFile(resolve(process.cwd(), 'docs/deletions.log'), line, 'utf8');
}
