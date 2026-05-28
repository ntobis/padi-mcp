'use server';

import { connectPadiAccount } from '@/lib/connect';
import { getDb } from '@/lib/db/client';
import { CognitoAuthError } from '@padi-mcp/core';
import { withAuth } from '@workos-inc/authkit-nextjs';

export interface ConnectState {
  ok: boolean;
  message: string;
}

export async function connectAction(
  _prev: ConnectState | null,
  formData: FormData,
): Promise<ConnectState> {
  const { user } = await withAuth();
  if (!user) {
    return { ok: false, message: 'Please sign in first, then try again.' };
  }
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { ok: false, message: 'Email and password are required.' };
  }
  try {
    const { affiliateId } = await connectPadiAccount(getDb(), user.id, email, password);
    return {
      ok: true,
      message: `Your PADI account is connected — affiliate ${affiliateId}.`,
    };
  } catch (e) {
    if (e instanceof CognitoAuthError) {
      return { ok: false, message: `Login failed (${e.code}): ${e.message}` };
    }
    return { ok: false, message: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
