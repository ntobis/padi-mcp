/**
 * Launch kill-switch + per-tenant ban list. Two independent env-driven controls
 * (a Vercel env change + redeploy applies in well under a minute):
 *
 *   SERVICE_DISABLED=1            -> global maintenance: every PADI/account tool
 *                                   returns service_unavailable. `ping` stays up.
 *   SERVICE_DISABLED_MESSAGE=...  -> optional custom maintenance message.
 *   BANNED_USER_IDS=a,b,c         -> these WorkOS user ids are blocked from the
 *                                   PADI tools. They may STILL disconnect/export/
 *                                   delete their own data (data-subject rights).
 */

function flag(env: Record<string, string | undefined>, name: string): boolean {
  const v = (env[name] ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function serviceDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return flag(env, 'SERVICE_DISABLED');
}

export function serviceDisabledMessage(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.SERVICE_DISABLED_MESSAGE?.trim() ||
    'The PADI MCP service is temporarily unavailable for maintenance. Please try again later.'
  );
}

export function bannedUserIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.BANNED_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function userBanned(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return bannedUserIds(env).has(userId);
}

export interface GateResult {
  blocked: boolean;
  error?: 'service_unavailable' | 'account_suspended';
  message?: string;
}

/**
 * @param allowAccountTools when true (account-management tools), a per-user ban
 *   does NOT block — a banned user can still exercise data-subject rights.
 *   Global maintenance still blocks everything.
 */
export function checkServiceGate(
  userId: string,
  opts: { allowAccountTools?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
): GateResult {
  if (serviceDisabled(env)) {
    return { blocked: true, error: 'service_unavailable', message: serviceDisabledMessage(env) };
  }
  if (!opts.allowAccountTools && userBanned(userId, env)) {
    return {
      blocked: true,
      error: 'account_suspended',
      message: 'Your account is suspended. Contact support if you believe this is in error.',
    };
  }
  return { blocked: false };
}
