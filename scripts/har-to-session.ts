#!/usr/bin/env tsx
/**
 * Extract auth + sample GraphQL operations from a HAR capture of the
 * PADI logbook flow.
 *
 * Emits:
 *   inputs/session.json          — most recent valid request's auth
 *   samples/<opName>.json        — first observed payload per operation
 *   docs/har-summary.md          — count + first-seen variable summary
 *
 * Usage:
 *   tsx scripts/har-to-session.ts inputs/foo.har
 *   tsx scripts/har-to-session.ts            # picks the only .har in inputs/
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const SESSION_OUT = resolve(ROOT, 'inputs/session.json');
const SAMPLES_DIR = resolve(ROOT, 'samples');
const SUMMARY_OUT = resolve(ROOT, 'docs/har-summary.md');
const ENDPOINT_RE = /logbook\.global-prod\.padi\.com\/api\/Logbook/i;

interface HarHeader {
  name: string;
  value: string;
}

interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    headers: HarHeader[];
    postData?: { text?: string };
  };
  response: {
    status: number;
  };
}

interface Har {
  log: { entries: HarEntry[] };
}

interface GraphQLBody {
  operationName?: string;
  query?: string;
  variables?: unknown;
}

function headerMap(headers: HarHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

function inferOpName(body: GraphQLBody): string {
  if (body.operationName) return body.operationName;
  const m = (body.query ?? '').match(/^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1] ?? 'anonymous';
}

function decodeJwtSub(authHeader: string): string {
  const m = authHeader.match(/Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
  if (!m) return '';
  const payload = m[1]!.split('.')[1]!;
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  const buf = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    return typeof parsed.sub === 'string' ? parsed.sub : '';
  } catch {
    return '';
  }
}

async function pickHarPath(): Promise<string> {
  const argPath = process.argv[2];
  if (argPath) return resolve(argPath);
  const inputsDir = resolve(ROOT, 'inputs');
  const files = await readdir(inputsDir);
  const hars = files.filter((f) => f.endsWith('.har'));
  if (hars.length === 0) throw new Error(`No .har file under ${inputsDir}`);
  if (hars.length > 1)
    throw new Error(`Multiple .har files; pass one explicitly: ${hars.join(', ')}`);
  return resolve(inputsDir, hars[0]!);
}

async function main(): Promise<void> {
  const harPath = await pickHarPath();
  const har = JSON.parse(await readFile(harPath, 'utf8')) as Har;
  const logbookEntries = har.log.entries.filter(
    (e) => ENDPOINT_RE.test(e.request.url) && e.request.method.toUpperCase() === 'POST',
  );
  if (logbookEntries.length === 0) {
    throw new Error('HAR contains no POST /api/Logbook entries');
  }

  // Latest successful entry wins for session.
  const successful = logbookEntries
    .filter((e) => e.response.status >= 200 && e.response.status < 300)
    .sort((a, b) => b.startedDateTime.localeCompare(a.startedDateTime));
  const latest = successful[0] ?? logbookEntries[logbookEntries.length - 1]!;
  const headers = headerMap(latest.request.headers);
  const authorization = headers['authorization'] ?? '';
  const session = {
    endpoint: latest.request.url,
    authorization,
    affiliate_id: headers['affiliate-id'] ?? '',
    x_platform: headers['x-platform'] ?? 'web',
    user_agent: headers['user-agent'] ?? '',
    cognito_sub: authorization ? decodeJwtSub(authorization) : '',
  };
  await mkdir(dirname(SESSION_OUT), { recursive: true });
  await writeFile(SESSION_OUT, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  if (!authorization) {
    console.error(
      'WARNING: HAR contained no Authorization header (Chrome strips it from exports).',
    );
    console.error('         session.json was written without `authorization`.');
    console.error('         Use scripts/curl-to-session.ts with a cURL to fill it in.');
  }

  // Sample collection — first payload per operation.
  await mkdir(SAMPLES_DIR, { recursive: true });
  const samples = new Map<string, GraphQLBody>();
  const counts = new Map<string, number>();
  for (const e of logbookEntries) {
    if (!e.request.postData?.text) continue;
    let body: GraphQLBody;
    try {
      body = JSON.parse(e.request.postData.text) as GraphQLBody;
    } catch {
      continue;
    }
    const name = inferOpName(body);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!samples.has(name)) samples.set(name, body);
  }
  for (const [name, body] of samples) {
    await writeFile(resolve(SAMPLES_DIR, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
  }

  const summary: string[] = ['# HAR summary', '', `Source: \`${harPath}\``, ''];
  summary.push(`Total logbook entries: ${logbookEntries.length}`, '');
  summary.push('| Operation | Count |', '|---|---|');
  for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    summary.push(`| ${name} | ${count} |`);
  }
  await writeFile(SUMMARY_OUT, `${summary.join('\n')}\n`);

  console.error(`Wrote ${SESSION_OUT}`);
  console.error(`  affiliate_id: ${session.affiliate_id}`);
  console.error(`  cognito_sub:  ${session.cognito_sub || '(not decoded)'}`);
  console.error(`Wrote ${samples.size} samples to ${SAMPLES_DIR}`);
  console.error(`Wrote ${SUMMARY_OUT}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain)
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
