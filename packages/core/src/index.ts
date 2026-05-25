/**
 * @padi-mcp/core — the shared PADI logbook engine.
 *
 * Transport-agnostic: Cognito auth, a context-injected GraphQL client, the
 * dive operations, zod schemas, and field transforms. Consumed by both the
 * local stdio server and the managed multi-tenant service. No filesystem, no
 * global session state — callers pass a PadiContext per request.
 */
export * from './padi-client.js';
export * from './auth/cognito.js';
export * from './auth/jwt.js';
export * from './types.js';
export * from './transforms/dates.js';
export * from './transforms/numbers.js';
export * from './transforms/arrays.js';
export * from './operations/count-dives.js';
export * from './operations/list-dives.js';
export * from './operations/get-dive.js';
export * from './operations/search-dive-sites.js';
export * from './operations/create-dive.js';
export * from './operations/update-dive.js';
export * from './operations/delete-dive.js';
