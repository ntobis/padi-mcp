/**
 * Minimal `fetch`-based GraphQL client for the PADI logbook endpoint.
 *
 * Transport-agnostic and multi-tenant safe: every call takes an explicit
 * `PadiContext` (endpoint + headers + a token provider) instead of reading a
 * global session. The local server builds the context from a file-based
 * session; the managed service builds one per request from the authenticated
 * tenant. No module-global auth state.
 *
 * Failure modes surfaced explicitly:
 *  - NetworkPolicyError when a sandbox/proxy blocks the request
 *  - UnauthorizedError on a 401/403 that survives a forced token refresh
 *  - GraphQLError when the response body contains an `errors` array
 *  - HttpError on any other non-2xx
 */

export class GraphQLError extends Error {
  override readonly name = 'GraphQLError';
  constructor(
    message: string,
    readonly errors: unknown[],
    readonly operationName: string,
  ) {
    super(message);
  }
}

export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class NetworkPolicyError extends Error {
  override readonly name = 'NetworkPolicyError';
  constructor(
    message: string,
    readonly denyReason: string,
  ) {
    super(message);
  }
}

export class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Supplies a PADI ID token. `forceRefresh` is passed on a 401 retry so the
 * provider mints a brand-new token (covers a token revoked mid-life). The
 * provider may throw its own error (e.g. "please log in") which propagates.
 */
export type TokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export interface PadiContext {
  endpoint: string;
  affiliateId: string;
  xPlatform: string;
  userAgent: string;
  getToken: TokenProvider;
}

export interface GraphQLRequest<V> {
  operationName: string;
  query: string;
  variables: V;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: unknown[];
}

export async function graphql<T, V = Record<string, unknown>>(
  ctx: PadiContext,
  req: GraphQLRequest<V>,
): Promise<T> {
  return graphqlOnce(ctx, req, false);
}

async function graphqlOnce<T, V>(
  ctx: PadiContext,
  req: GraphQLRequest<V>,
  isRetry: boolean,
): Promise<T> {
  const idToken = await ctx.getToken(isRetry ? { forceRefresh: true } : undefined);
  const body = JSON.stringify({
    operationName: req.operationName,
    query: req.query,
    variables: req.variables,
  });
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(ctx.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${idToken}`,
        'affiliate-id': ctx.affiliateId,
        'x-platform': ctx.xPlatform,
        Origin: 'https://learning.padi.com',
        Referer: 'https://learning.padi.com/',
        'User-Agent': ctx.userAgent || 'padi-mcp/0.1',
      },
      body,
    });
  } catch (e) {
    const duration = Date.now() - start;
    console.error(`graphql ${req.operationName} network-error ${duration}ms`);
    throw e;
  }

  const duration = Date.now() - start;
  const text = await res.text();

  // Distinguish a sandbox/proxy block from a real PADI 401/403.
  const denyReason = res.headers.get('x-deny-reason');
  if (denyReason) {
    console.error(
      `graphql ${req.operationName} blocked-by-proxy ${duration}ms reason=${denyReason}`,
    );
    throw new NetworkPolicyError(
      `Request to ${ctx.endpoint} was blocked by the network policy (x-deny-reason: ${denyReason}). Run from a host that can reach PADI, or add logbook.global-prod.padi.com to the environment allowlist.`,
      denyReason,
    );
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`graphql ${req.operationName} ${res.status} ${duration}ms`);
    // Token may have been revoked mid-life. Force one fresh token and retry.
    if (!isRetry) return graphqlOnce(ctx, req, true);
    throw new UnauthorizedError(
      `PADI returned ${res.status} even after refreshing the token.`,
      res.status,
    );
  }
  if (!res.ok) {
    console.error(`graphql ${req.operationName} ${res.status} ${duration}ms`);
    throw new HttpError(
      `PADI returned HTTP ${res.status} for ${req.operationName}`,
      res.status,
      text,
    );
  }

  let json: GraphQLResponse<T>;
  try {
    json = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new HttpError(`Non-JSON response for ${req.operationName}`, res.status, text);
  }

  if (json.errors && json.errors.length > 0) {
    console.error(
      `graphql ${req.operationName} graphql-error ${duration}ms ${JSON.stringify(json.errors)}`,
    );
    throw new GraphQLError(
      `GraphQL error on ${req.operationName}: ${JSON.stringify(json.errors)}`,
      json.errors,
      req.operationName,
    );
  }

  if (json.data === undefined) {
    throw new HttpError(`No data in response for ${req.operationName}`, res.status, text);
  }

  console.error(`graphql ${req.operationName} ok ${duration}ms`);
  return json.data;
}
