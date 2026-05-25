/**
 * Local-app facade over @padi-mcp/core. Binds each context-injected core
 * operation to the local file-session context, preserving the original
 * single-argument signatures so the MCP server and scripts call them exactly
 * as before. The managed service skips this facade and passes its own
 * per-tenant context to the core operations directly.
 */
import * as core from '@padi-mcp/core';
import { localContext } from './context.js';

export const countDives = (): Promise<number> => core.countDives(localContext());

export const listDives = (args: { limit?: number; offset?: number } = {}) =>
  core.listDives(localContext(), args);

export const getDive = (id: number) => core.getDive(localContext(), id);

export const searchDiveSites = (query: string) => core.searchDiveSites(localContext(), query);

export const createDive = (input: core.DiveInput) => core.createDive(localContext(), input);

export const buildInsertGeneral = (input: core.DiveInput) =>
  core.buildInsertGeneral(localContext(), input);

export const updateDive = (update: core.DiveUpdate) => core.updateDive(localContext(), update);

export const buildUpdateVariables = (update: core.DiveUpdate) =>
  core.buildUpdateVariables(localContext(), update);

export const deleteDive = (id: number) => core.deleteDive(localContext(), id);

export const graphql = <T, V = Record<string, unknown>>(req: core.GraphQLRequest<V>): Promise<T> =>
  core.graphql<T, V>(localContext(), req);

export { GraphQLError, HttpError, NetworkPolicyError, UnauthorizedError } from '@padi-mcp/core';
export type { DeleteStrategy, DiveSiteHit } from '@padi-mcp/core';
