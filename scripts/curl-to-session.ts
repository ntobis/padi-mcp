#!/usr/bin/env tsx
/**
 * Parse a `curl 'https://logbook.global-prod.padi.com/api/Logbook' ...`
 * command (copied from Chrome DevTools → Network → Copy as cURL) and emit
 * inputs/session.json.
 *
 * Usage:
 *   tsx scripts/curl-to-session.ts < scratch.txt
 *   tsx scripts/curl-to-session.ts path/to/scratch.txt
 *   echo "curl '...' -H '...' ..." | tsx scripts/curl-to-session.ts
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdin } from 'node:process';
import { buildSessionFromCurl } from '../src/curl-parser.js';

const DEFAULT_OUT = resolve(process.cwd(), 'inputs/session.json');

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const argPath = argv[2];
  const raw = argPath ? await readFile(argPath, 'utf8') : await readAllStdin();
  if (!raw.trim()) {
    console.error('No input. Pipe a curl command in or pass a file path.');
    process.exit(2);
  }
  const session = buildSessionFromCurl(raw);
  await mkdir(dirname(DEFAULT_OUT), { recursive: true });
  await writeFile(DEFAULT_OUT, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  console.error(`Wrote ${DEFAULT_OUT}`);
  console.error(`  affiliate_id: ${session.affiliate_id}`);
  console.error(`  cognito_sub:  ${session.cognito_sub || '(not decoded)'}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
