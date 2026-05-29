#!/usr/bin/env tsx
/**
 * Terminal login for the open-source local server — lets a user authenticate
 * without going through an MCP host app.
 *
 * Usage:
 *   npm run login                 # prompts for email + password
 *   npm run login -- you@x.com    # prompts for password only
 *   npm run login -- you@x.com --remember   # also store password (Keychain/file)
 */
import { createInterface } from 'node:readline';
import { login } from '../src/session.js';

function ask(query: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(query: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const rlx = rl as unknown as {
    _writeToOutput: (s: string) => void;
    output?: NodeJS.WritableStream;
  };
  let muted = false;
  rlx._writeToOutput = (stringToWrite: string) => {
    if (!muted) rlx.output?.write(stringToWrite);
  };
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const remember = args.includes('--remember');
  const emailArg = args.find((a) => !a.startsWith('--'));

  const email = emailArg ?? (await ask('PADI email: '));
  const password = await askHidden('PADI password (hidden): ');
  if (!email || !password) {
    console.error('Email and password are required.');
    process.exit(2);
  }

  const session = await login(email, password, remember);
  console.error('Logged in.');
  console.error(`  affiliate_id: ${session.affiliate_id}`);
  console.error(`  refresh token stored: ${Boolean(session.refresh_token)}`);
  console.error(`  password stored: ${remember}`);
  console.error('The server will now keep itself signed in automatically.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
