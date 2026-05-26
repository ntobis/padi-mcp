/**
 * Boot-time env validation for the managed MCP service.
 *
 * Fails fast on missing required vars and logs the WorkOS app pair (full
 * client_id + last 4 of API key) so a wrong-app mismatch is visible at a
 * glance. Never log full secrets.
 */

export const REQUIRED_ENV_VARS = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_AUTHKIT_DOMAIN',
  'PADI_MASTER_KEY',
  'DATABASE_URL',
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export interface ValidateEnvResult {
  ok: boolean;
  missing: RequiredEnvVar[];
}

export function validateEnv(env: Partial<NodeJS.ProcessEnv> = process.env): ValidateEnvResult {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const v = env[name];
    return v === undefined || v === '';
  });
  return { ok: missing.length === 0, missing };
}

export function bootSummary(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const clientId = env.WORKOS_CLIENT_ID ?? '<unset>';
  const apiKey = env.WORKOS_API_KEY ?? '';
  const apiKeyTail = apiKey ? `…${apiKey.slice(-4)}` : '<unset>';
  return `[env-guard] boot ok — WORKOS_CLIENT_ID=${clientId} WORKOS_API_KEY=${apiKeyTail}`;
}

export function assertEnvOrThrow(env: Partial<NodeJS.ProcessEnv> = process.env): void {
  const result = validateEnv(env);
  if (!result.ok) {
    throw new Error(
      `[env-guard] Missing required env vars: ${result.missing.join(', ')}. Set them in apps/managed/.env.local (or your deploy env) and restart.`,
    );
  }
}
