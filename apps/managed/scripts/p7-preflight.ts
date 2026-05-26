#!/usr/bin/env tsx
/**
 * Phase-7 pre-flight: verify the DEPLOYED managed endpoint's unauthenticated
 * Layer-1 (WorkOS AuthKit) contract before the real on-device connector test.
 *
 * No secrets, no OAuth handshake — this only exercises the PUBLIC discovery
 * surface that Claude relies on to (a) learn it must authenticate, (b) find the
 * authorization server, and (c) dynamically register itself. Catching a broken
 * deploy here saves you from debugging on a phone.
 *
 * Usage:
 *   tsx scripts/p7-preflight.ts https://your-deployment.example.com
 *   MCP_BASE_URL=https://... tsx scripts/p7-preflight.ts
 *
 * Checks:
 *   1. POST /api/mcp with no token            -> 401 + WWW-Authenticate w/ resource_metadata
 *   2. GET  <resource_metadata>               -> PRM JSON {resource, authorization_servers:[…]}
 *   3. GET  <AS>/.well-known/oauth-authorization-server
 *                                             -> issuer/jwks_uri/authorization_endpoint/
 *                                                token_endpoint + registration_endpoint (DCR)
 *   4. GET  /connect                          -> not a 5xx (200 or an auth redirect are both fine)
 */

const base = (process.argv[2] ?? process.env.MCP_BASE_URL ?? '').trim().replace(/\/$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Usage: tsx scripts/p7-preflight.ts <https://deployed-base-url>');
  console.error('   (or set MCP_BASE_URL). Pass the site root, not the /api/mcp path.');
  process.exit(2);
}

let failures = 0;
let skips = 0;
const pass = (msg: string) => console.log(`  PASS  ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const skip = (msg: string) => {
  skips++;
  console.log(`  SKIP  ${msg}`);
};
const info = (msg: string) => console.log(`        ${msg}`);

async function step1(): Promise<string | null> {
  console.log('1. Unauthenticated POST /api/mcp must be rejected with discovery hint');
  const url = `${base}/api/mcp`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      redirect: 'manual',
    });
  } catch (e) {
    fail(`could not reach ${url}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (res.status !== 401) {
    fail(`expected 401, got ${res.status}. Layer-1 auth may not be enforced.`);
  } else {
    pass('401 Unauthorized');
  }
  const wwwAuth = res.headers.get('www-authenticate') ?? '';
  if (!/bearer/i.test(wwwAuth)) {
    fail(`WWW-Authenticate missing/!Bearer: "${wwwAuth}"`);
    return null;
  }
  const m = wwwAuth.match(/resource_metadata="?([^",\s]+)"?/i);
  if (!m) {
    fail(`WWW-Authenticate has no resource_metadata: "${wwwAuth}"`);
    return null;
  }
  pass('WWW-Authenticate advertises resource_metadata');
  info(m[1]!);
  return m[1]!;
}

async function step2(prmUrl: string): Promise<string | null> {
  console.log('2. Protected Resource Metadata (PRM) document');
  let res: Response;
  try {
    res = await fetch(prmUrl, { headers: { accept: 'application/json' } });
  } catch (e) {
    fail(`could not fetch PRM: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!res.ok) {
    fail(`PRM returned ${res.status}`);
    return null;
  }
  let json: { resource?: string; authorization_servers?: string[] };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    fail('PRM is not valid JSON');
    return null;
  }
  if (!json.resource) fail('PRM missing `resource`');
  else pass(`PRM resource = ${json.resource}`);
  const as = json.authorization_servers?.[0];
  if (!as) {
    fail('PRM missing `authorization_servers`');
    return null;
  }
  pass(`PRM authorization_servers[0] = ${as}`);
  return as.replace(/\/$/, '');
}

async function step3(as: string): Promise<void> {
  console.log('3. Authorization Server metadata (DCR + endpoints)');
  const url = `${as}/.well-known/oauth-authorization-server`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    fail(`could not fetch AS metadata (${url}): ${e instanceof Error ? e.message : e}`);
    return;
  }
  // The AS lives on a different host than the deploy (e.g. *.authkit.app), so a
  // sandbox allowlist may permit the deploy host but not this one. Treat that as
  // a SKIP, not a FAIL — it's an environment limit, not a broken deploy.
  const deny = res.headers.get('x-deny-reason');
  if (deny) {
    skip(`AS host not reachable from this environment (x-deny-reason: ${deny}): ${url}`);
    info('Allowlist the AuthKit domain too, or run this pre-flight from an unrestricted machine.');
    return;
  }
  if (!res.ok) {
    fail(`AS metadata returned ${res.status} from ${url}`);
    return;
  }
  let meta: Record<string, unknown>;
  try {
    meta = (await res.json()) as Record<string, unknown>;
  } catch {
    fail('AS metadata is not valid JSON');
    return;
  }
  for (const field of ['issuer', 'jwks_uri', 'authorization_endpoint', 'token_endpoint']) {
    if (meta[field]) pass(`${field} present`);
    else fail(`AS metadata missing ${field}`);
  }
  if (meta.registration_endpoint) {
    pass('registration_endpoint present (Dynamic Client Registration enabled)');
  } else {
    fail('registration_endpoint MISSING — Claude cannot self-register (enable DCR in AuthKit)');
  }
}

async function step4(): Promise<void> {
  console.log('4. /connect page reachable (not a 5xx)');
  const url = `${base}/connect`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    fail(`could not reach ${url}: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (res.status >= 500) {
    fail(`/connect returned ${res.status} (server error — check env vars on the deploy)`);
  } else {
    pass(
      `/connect responded ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirect to login — expected when signed out)' : ''}`,
    );
  }
}

/**
 * Detect a sandbox/proxy denial (e.g. Claude Code's network allowlist returns
 * 403 + `x-deny-reason: host_not_allowed`). Such a block makes every check a
 * false negative, so we bail with clear guidance instead of reporting bogus
 * "auth not enforced" failures.
 */
async function ensureReachable(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}/connect`, { redirect: 'manual' });
  } catch {
    return; // genuine network errors are surfaced per-step below
  }
  const deny = res.headers.get('x-deny-reason');
  if (deny) {
    console.error(`This environment cannot reach ${base} (x-deny-reason: ${deny}).`);
    console.error('That blocks every check below, so they would be false negatives.');
    console.error('Run this pre-flight from a machine that can reach the deployment:');
    console.error(`  npm run p7-preflight -w @padi-mcp/managed -- ${base}`);
    process.exit(3);
  }
}

async function main(): Promise<void> {
  console.log(`Pre-flight against ${base}\n`);
  await ensureReachable();
  const prmUrl = await step1();
  let as: string | null = null;
  if (prmUrl) as = await step2(prmUrl);
  if (as) await step3(as);
  await step4();
  console.log('');
  if (failures > 0) {
    console.log(`Pre-flight: ${failures} check(s) FAILED. Fix before the on-device test.`);
    process.exit(1);
  }
  if (skips > 0) {
    console.log(
      `Pre-flight: no failures, but ${skips} check(s) SKIPPED (host not reachable here). ` +
        'Re-run from an unrestricted machine to cover them before the on-device test.',
    );
    return;
  }
  console.log(
    'Pre-flight: all checks passed. The deploy is ready for the on-device connector test.',
  );
}

main().catch((e) => {
  console.error('preflight crashed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
