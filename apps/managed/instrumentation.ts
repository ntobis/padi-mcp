/**
 * Next.js instrumentation hook — runs once at server start (Node runtime only).
 * Fails fast if required env vars are missing; logs the WorkOS pair so a
 * wrong-app/key mismatch is visible at boot.
 */
import { assertEnvOrThrow, bootSummary } from './lib/env-guard';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  assertEnvOrThrow();
  console.log(bootSummary());
}
