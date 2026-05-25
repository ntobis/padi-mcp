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
import { GraphQLError, type PadiContext, graphql } from '../padi-client.js';
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

/**
 * Soft-delete by flipping `status`. The `status` enum is narrow — empirical
 * probe (see docs/enums.md → Probe run 2026-05-24T09:05:33Z) confirmed only
 * `Publish` and `Draft` are accepted; `Trash` / `Deleted` / `Archived` are
 * rejected with `data-exception: invalid input value for enum status`.
 * `Draft` is the closest "hide from listings" semantic the API allows.
 */
export async function softDelete(
  ctx: PadiContext,
  diveId: number,
  status = 'Draft',
): Promise<boolean> {
  await graphql(ctx, {
    operationName: 'SoftDelete',
    query: SOFT_DELETE_MUTATION,
    variables: { id: diveId, status },
  });
  // Verify the dive no longer appears as a normal status
  const after = await getDive(ctx, diveId);
  // If we can still read it AND it shows as the soft-delete status, that's a successful soft delete.
  return after !== null && after.status === status;
}

export async function hardDelete(ctx: PadiContext, diveId: number): Promise<boolean> {
  const data = await graphql<{ delete_logbook_logs: { affected_rows: number } }>(ctx, {
    operationName: 'HardDelete',
    query: HARD_DELETE_MUTATION,
    variables: { id: diveId },
  });
  if (data.delete_logbook_logs.affected_rows < 1) return false;
  const after = await getDive(ctx, diveId);
  return after === null;
}

export async function perTableDelete(ctx: PadiContext, diveId: number): Promise<boolean> {
  await graphql(ctx, {
    operationName: 'PerTableDelete',
    query: PER_TABLE_DELETE_MUTATION,
    variables: { id: diveId },
  });
  const after = await getDive(ctx, diveId);
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
export async function deleteDive(ctx: PadiContext, diveId: number): Promise<DeleteStrategy> {
  if (cachedStrategy) {
    const ok = await runStrategy(ctx, cachedStrategy, diveId);
    if (ok) return cachedStrategy;
    cachedStrategy = null;
  }
  const order: DeleteStrategy[] = ['hard', 'per-table', 'soft'];
  let lastError: unknown = null;
  for (const strategy of order) {
    try {
      const ok = await runStrategy(ctx, strategy, diveId);
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

async function runStrategy(
  ctx: PadiContext,
  strategy: DeleteStrategy,
  diveId: number,
): Promise<boolean> {
  switch (strategy) {
    case 'soft':
      return softDelete(ctx, diveId);
    case 'hard':
      return hardDelete(ctx, diveId);
    case 'per-table':
      return perTableDelete(ctx, diveId);
  }
}
