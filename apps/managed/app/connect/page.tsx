'use client';

import { useActionState } from 'react';
import { type ConnectState, connectAction } from './actions';

const wrap = { fontFamily: 'system-ui, sans-serif', maxWidth: 460, margin: '4rem auto', padding: '0 1rem' } as const;
const field = { display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem', marginBottom: '1rem' } as const;

export default function ConnectPage() {
  const [state, action, pending] = useActionState<ConnectState | null, FormData>(connectAction, null);

  return (
    <main style={wrap}>
      <h1>Connect your PADI account</h1>
      <p>
        Enter your PADI credentials once. We exchange them for a refresh token, store it encrypted,
        and never keep your password.
      </p>
      <form action={action}>
        <label>
          PADI email
          <input style={field} type="email" name="email" autoComplete="off" required />
        </label>
        <label>
          PADI password
          <input style={field} type="password" name="password" autoComplete="off" required />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {state && (
        <p style={{ marginTop: '1rem', color: state.ok ? 'green' : 'crimson' }}>{state.message}</p>
      )}
    </main>
  );
}
