#!/usr/bin/env tsx
/**
 * Live verification of the auto-refresh path. Forces a REFRESH_TOKEN_AUTH
 * (ignoring the still-valid cached ID token), then makes a real read against
 * PADI with the freshly-minted token. Proves: refresh token works + PADI
 * accepts the minted ID token. Read-only — does not touch your logbook.
 *
 *   npm run verify-refresh
 */
import { countDives } from '../src/operations/count-dives.js';
import { authStatus, loadSession, refreshIdTokenNow } from '../src/session.js';

async function main(): Promise<void> {
  await loadSession();
  const before = authStatus();
  console.error(
    `loaded session: refresh_token=${before.has_refresh_token} ` +
      `id_token_expires_in=${before.id_token_expires_in_seconds}s`,
  );
  if (!before.has_refresh_token) {
    console.error('No refresh token in the session — run `npm run login` first.');
    process.exit(2);
  }

  console.error('forcing REFRESH_TOKEN_AUTH (bypassing the valid cached token)…');
  const token = await refreshIdTokenNow();
  const after = authStatus();
  console.error(
    `minted a new ID token (${token.length} chars), now valid ${after.id_token_expires_in_seconds}s.`,
  );

  console.error('calling PADI with the freshly-minted token…');
  const count = await countDives();
  console.error(`PADI accepted it. Total dives: ${count}.`);
  console.error('Auto-refresh verified end-to-end.');
}

main().catch((e) => {
  console.error('verify-refresh FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
