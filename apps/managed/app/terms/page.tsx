const LAST_UPDATED = 'May 27, 2026';
const CONTACT = 'nicolas.tobis@me.com';

export const metadata = {
  title: 'Terms of Service — PADI MCP',
  description: 'Terms of Service for the PADI MCP connector.',
};

export default function TermsPage() {
  return (
    <main className="legal">
      <article className="legal-sheet">
        <a className="back" href="/">
          ← Back
        </a>
        <h1>Terms of Service</h1>
        <p className="legal-meta">Last updated {LAST_UPDATED}</p>

        <div className="legal-banner">
          Draft — provided for transparency and pending legal review. Not legal advice.
        </div>

        <h2>1. What this service is</h2>
        <p>
          PADI MCP (&ldquo;the Service&rdquo;) is an independent, third-party tool that connects
          your PADI dive logbook to a Model Context Protocol (MCP) client such as Claude, ChatGPT,
          or Cursor, so you can read and manage your own dives in plain language. The Service is{' '}
          <strong>not affiliated with, endorsed, sponsored by, or operated by PADI</strong> or its
          affiliates. &ldquo;PADI&rdquo; is a trademark of its respective owner, used here only to
          describe interoperability.
        </p>

        <h2>2. Eligibility &amp; your account</h2>
        <p>
          You must have your own valid PADI account and the right to access it. By connecting, you
          authorize the Service to access your PADI logbook on your behalf to perform the actions
          you request through your MCP client.
        </p>

        <h2>3. Credentials &amp; access</h2>
        <p>
          You provide your PADI credentials once on the connect page. We exchange them for a refresh
          token and <strong>never store your password</strong>. The refresh token is stored
          encrypted and used only to mint short-lived access tokens when you make a request. See the{' '}
          <a href="/privacy">Privacy Policy</a> for details.
        </p>

        <h2>4. Acceptable use</h2>
        <ul>
          <li>
            You will comply with PADI&rsquo;s own terms of use for your PADI account and data.
          </li>
          <li>
            You are responsible for actions taken through the Service, including creating, editing,
            or deleting dives in your logbook.
          </li>
          <li>
            You will not abuse, overload, reverse-engineer, or attempt to circumvent the
            Service&rsquo;s rate limits or security controls, or use it to access data that is not
            your own.
          </li>
        </ul>

        <h2>5. Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
          warranties of any kind. We do not guarantee the accuracy, completeness, or availability of
          dive data, and the Service must not be relied upon for dive planning, safety, or any
          life-critical decision. Always rely on your certified training, instruments, and
          professional judgment.
        </p>

        <h2>6. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, the operator of the Service is not liable for any
          indirect, incidental, or consequential damages, or for any loss of data, arising from your
          use of the Service.
        </p>

        <h2>7. Suspension &amp; termination</h2>
        <p>
          We may suspend or discontinue the Service, or a particular account, to protect the Service
          or its users. You can end your use at any time: disconnect your PADI account or delete
          your stored data using the in-client tools (<code>padi_disconnect</code>,{' '}
          <code>padi_delete_my_data</code>).
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these terms; the &ldquo;last updated&rdquo; date will change accordingly.
          Continued use after an update constitutes acceptance.
        </p>

        <h2>9. Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <p className="legal-foot">
          Independent connector · not affiliated with or endorsed by PADI.
        </p>
      </article>
    </main>
  );
}
