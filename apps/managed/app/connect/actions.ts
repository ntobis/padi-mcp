'use server';

import { CognitoAuthError } from '@padi-mcp/core';
import { connectPadiAccount } from '@/lib/connect';
import { getCurrentUserId } from '@/lib/current-user';
import { getDb } from '@/lib/db/client';

export interface ConnectState {
  ok: boolean;
  message: string;
}

export async function connectAction(_prev: ConnectState | null, formData: FormData): Promise<ConnectState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { ok: false, message: 'Email and password are required.' };
  }
  try {
    const userId = await getCurrentUserId();
    const { affiliateId } = await connectPadiAccount(getDb(), userId, email, password);
    return {
      ok: true,
      message: `PADI account connected (affiliate ${affiliateId}). Go back to Claude and try "count my dives".`,
    };
  } catch (e) {
    if (e instanceof CognitoAuthError) {
      return { ok: false, message: `Login failed (${e.code}): ${e.message}` };
    }
    return { ok: false, message: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
