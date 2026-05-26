function WaveMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 9c2.2 0 2.2 2 4.4 2S7.6 9 9.8 9 12 11 14.2 11 16.4 9 18.6 9 20.8 11 23 11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1 14c2.2 0 2.2 2 4.4 2S7.6 14 9.8 14 12 16 14.2 16 16.4 14 18.6 14 20.8 16 23 16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <circle cx="15.5" cy="5" r="1.6" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="home">
      <div className="home-inner">
        <div className="brand-badge">
          <WaveMark />
        </div>
        <h1>Your dive logbook, in Claude.</h1>
        <p>
          A managed MCP service that connects your PADI dive logbook to Claude — count, search,
          read, and log dives in plain language.
        </p>
        <div className="endpoint">
          <span>MCP endpoint</span>
          /api/mcp
        </div>
        <div>
          <a className="home-cta" href="/connect">
            Connect your account →
          </a>
        </div>
      </div>
    </main>
  );
}
