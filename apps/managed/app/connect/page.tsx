'use client';

import { useActionState, useState } from 'react';
import { type ConnectState, connectAction } from './actions';

const BUBBLES = [
  { x: '12%', s: '14px', d: '15s', delay: '0s', drift: '24px' },
  { x: '26%', s: '8px', d: '12s', delay: '3s', drift: '-18px' },
  { x: '44%', s: '20px', d: '19s', delay: '6s', drift: '30px' },
  { x: '63%', s: '10px', d: '13s', delay: '1.5s', drift: '-26px' },
  { x: '78%', s: '16px', d: '17s', delay: '4.5s', drift: '20px' },
  { x: '90%', s: '7px', d: '11s', delay: '8s', drift: '-14px' },
];

function Bubbles() {
  return (
    <div className="bubbles" aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <i
          key={i}
          style={
            {
              '--x': b.x,
              '--s': b.s,
              '--d': b.d,
              '--delay': b.delay,
              '--drift': b.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function WaveMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 9c2.2 0 2.2 2 4.4 2S8.6 9 10.8 9 13 11 15.2 11 17.4 9 19.6 9 21.8 11 24 11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-1 0)"
      />
      <path
        d="M2 14c2.2 0 2.2 2 4.4 2S8.6 14 10.8 14 13 16 15.2 16 17.4 14 19.6 14 21.8 16 24 16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
        transform="translate(-1 0)"
      />
      <circle cx="16.5" cy="5" r="1.6" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4l16 16M9.9 5.2A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.3 16.3 0 0 1-3 3.6M6.4 7.6A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5a9.2 9.2 0 0 0 3.3-.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
    </svg>
  );
}

export default function ConnectPage() {
  const [state, action, pending] = useActionState<ConnectState | null, FormData>(
    connectAction,
    null,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <Bubbles />
      <main className="auth-wrap">
        <div className="auth-card">
          {state?.ok ? (
            <div className="success">
              <div className="success-badge">
                <CheckIcon />
              </div>
              <h2>You&apos;re all set</h2>
              <p>{state.message}</p>
              <div className="hint">
                Head back to Claude and try <code>count my dives</code>.
              </div>
            </div>
          ) : (
            <>
              <div className="brand">
                <div className="brand-badge">
                  <WaveMark />
                </div>
                <div className="brand-name">PADI MCP</div>
              </div>

              <h1 className="auth-title">Connect your dive logbook</h1>
              <p className="auth-sub">
                Sign in with your PADI credentials once. We exchange them for a secure token, store
                it encrypted, and never keep your password.
              </p>

              <form action={action}>
                <div className="field">
                  <label className="field-label" htmlFor="email">
                    PADI email
                  </label>
                  <div className="field-control">
                    <input
                      id="email"
                      className="field-input"
                      type="email"
                      name="email"
                      placeholder="you@example.com"
                      autoComplete="username"
                      inputMode="email"
                      required
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="password">
                    PADI password
                  </label>
                  <div className="field-control">
                    <input
                      id="password"
                      className="field-input has-toggle"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="toggle"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <button className="cta" type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <span className="spinner" /> Connecting…
                    </>
                  ) : (
                    'Connect securely'
                  )}
                </button>
              </form>

              <div className="reassure">
                <LockIcon />
                Password never stored · encrypted token only
              </div>

              {state && !state.ok && (
                <div className="alert alert-err" role="alert">
                  <AlertIcon />
                  <span>{state.message}</span>
                </div>
              )}
            </>
          )}

          <div className="card-foot">
            Independent connector · not affiliated with or endorsed by PADI
          </div>
        </div>
      </main>
    </>
  );
}
