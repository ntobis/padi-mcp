/**
 * Minimal `fetch`-based GraphQL client for the PADI logbook endpoint.
 *
 * All requests share the same shape (POST JSON, the seven required headers).
 * The client surfaces three failure modes explicitly:
 *  - SessionExpiredError on 401/403
 *  - GraphQLError when the response body contains an `errors` array
 *  - HttpError on any other non-2xx
 *
 * Request/response logging goes to stderr (stdout is reserved for the MCP
 * stdio transport).
 */
import { getSession, SessionExpiredError } from './session.js';

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
  constructor(message: string, readonly denyReason: string) {
    super(message);
  }
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
  req: GraphQLRequest<V>,
): Promise<T> {
  const session = getSession();
  const body = JSON.stringify({
    operationName: req.operationName,
    query: req.query,
    variables: req.variables,
  });
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(session.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: session.authorization,
        'affiliate-id': session.affiliate_id,
        'x-platform': session.x_platform,
        Origin: 'https://learning.padi.com',
        Referer: 'https://learning.padi.com/',
        'User-Agent': session.user_agent || 'padi-mcp/0.1',
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
      `Request to ${session.endpoint} was blocked by the network policy ` +
        `(x-deny-reason: ${denyReason}). Run from a host that can reach PADI, or add ` +
        'logbook.global-prod.padi.com to the environment allowlist.',
      denyReason,
    );
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`graphql ${req.operationName} ${res.status} ${duration}ms`);
    throw new SessionExpiredError(
      `PADI returned ${res.status}. JWT likely expired (1h TTL). ` +
        'Re-capture cURL from DevTools and run padi_refresh_session.',
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
