const LAST_UPDATED = 'May 27, 2026';
const CONTACT = 'nicolas.tobis@me.com';

export const metadata = {
  title: 'Privacy Policy — PADI MCP',
  description: 'How the PADI MCP connector handles your data.',
};

export default function PrivacyPage() {
  return (
    <main className="legal">
      <article className="legal-sheet">
        <a className="back" href="/">
          ← Back
        </a>
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated {LAST_UPDATED}</p>

        <div className="legal-banner">
          Draft — provided for transparency and pending legal review. Not legal advice.
        </div>

        <p>
          PADI MCP (&ldquo;the Service&rdquo;) is an independent connector between your PADI dive
          logbook and an MCP client such as Claude. This policy explains what we store and your
          rights over it. The Service is not affiliated with or operated by PADI.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Your identity</strong> — the user id and email from your sign-in provider
            (WorkOS AuthKit), used to key your data to you.
          </li>
          <li>
            <strong>PADI connection metadata</strong> — your PADI affiliate id, username, and
            connection status/timestamps.
          </li>
          <li>
            <strong>An encrypted PADI refresh token</strong> — envelope-encrypted (AES-256-GCM) at
            rest. We <strong>never store your PADI password</strong>; it is exchanged for the token
            on connect and discarded.
          </li>
          <li>
            <strong>An audit log</strong> — a record of connect/disconnect events and write actions
            (create/update/delete dives) for security and support.
          </li>
        </ul>
        <p>
          We do not store the contents of your dives; those live in your PADI logbook. We read them
          on demand to answer your requests.
        </p>

        <h2>How we use it</h2>
        <p>
          Your data is used solely to operate the Service: to authenticate you, mint short-lived
          access tokens, and perform the PADI actions you request. We do not sell your data or use
          it for advertising.
        </p>

        <h2>Who it is shared with</h2>
        <p>
          To run the Service your data is processed by PADI (to operate your logbook on your
          request) and our infrastructure providers — sign-in (WorkOS), hosting (Vercel), database
          (Neon), and optionally rate-limit storage (Upstash). We share only what is necessary to
          provide the Service.
        </p>

        <h2>Security</h2>
        <p>
          The refresh token is encrypted at rest with envelope encryption; data in transit is
          protected with TLS. Access is keyed to your authenticated identity and never to values you
          pass as tool arguments.
        </p>

        <h2>Your rights</h2>
        <p>You can exercise these at any time from your MCP client:</p>
        <ul>
          <li>
            <strong>Export</strong> everything we store — <code>padi_export_my_data</code> (the
            encrypted token and key material are never disclosed).
          </li>
          <li>
            <strong>Disconnect</strong> — <code>padi_disconnect</code> deletes the stored token so
            the Service can no longer access your logbook.
          </li>
          <li>
            <strong>Delete</strong> all your stored data — <code>padi_delete_my_data</code> erases
            your connection, audit log, and account record.
          </li>
        </ul>

        <h2>Retention</h2>
        <p>
          We keep your data until you disconnect or delete it. Deleting is immediate and leaves no
          tombstone record.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions or data-rights requests: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <p className="legal-foot">
          Independent connector · not affiliated with or endorsed by PADI.
        </p>
      </article>
    </main>
  );
}
