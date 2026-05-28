# PADI Terms-of-Service review (pre-public-launch)

**Status:** advisory risk review for the maintainer. **Not legal advice.** Before
opening signup publicly, have someone read PADI's current terms in full and, if
in doubt, get qualified legal counsel.

**Why this matters:** PADI MCP is an *unofficial* connector. It authenticates as
the end user (their own PADI credentials → refresh token) and calls PADI's
private logbook GraphQL API (`logbook.global-prod.padi.com`) on their behalf.
That is materially different from scraping a public site, but it still touches
PADI's systems through an interface PADI did not publish for third parties.

## Documents to review (could not be fetched from the build sandbox — 403)

- PADI Consumer Privacy Policy — https://www.padi.com/privacy
- PADI site terms / terms & conditions — https://www.padi.com (look for "Terms of
  Use" / "Terms & Conditions" in the footer; PADI maintains several, per product)
- PADI Club Terms of Service — https://www.padi.com/club/terms
- PADI Travel terms — https://travel.padi.com/terms/

The maintainer must open these directly (the sandbox network blocks padi.com).

## Risk areas to check against the live terms

1. **Automated / programmatic access.** Look for clauses prohibiting access by
   "automated means," bots, scrapers, or use of the site/app other than through
   the provided interface. The logbook API is an internal API; using it
   programmatically may be restricted even though the user is acting on their own
   account.
2. **Account & credential handling.** Confirm there is no prohibition on a third
   party handling credentials or acting on the user's behalf. We mitigate by
   never storing the password and storing only an encrypted refresh token, but
   the terms may still restrict delegated access.
3. **Reverse engineering.** The connector was built from observed web traffic
   (HAR/cURL). Check for anti-reverse-engineering / no-derivation clauses.
4. **Trademark / branding.** We must not imply affiliation or endorsement. We
   currently: (a) label the service "independent · not affiliated with or
   endorsed by PADI" in the UI footer, ToS, and Privacy Policy; (b) use the word
   "PADI" only descriptively (nominative use) and do not use PADI logos. Keep it
   that way.
5. **Data ownership / redistribution.** We do not store dive contents or
   redistribute PADI data — we read it on demand for the authenticated owner and
   write only what the user asks. Confirm this is acceptable.
6. **Rate / load.** Check for limits on request volume. Our per-tenant rate
   limiter (tool + write buckets) is the technical control; enforce it
   (`RATELIMIT_ENFORCE=1`) before public exposure.
7. **Termination / kill-switch.** If PADI objects, we can stop fast: set
   `SERVICE_DISABLED=1` (global maintenance) — see the kill-switch. Have a plan
   to notify users and offer export/delete first.

## Current mitigations already in place

- Password never stored; refresh token envelope-encrypted at rest.
- Per-tenant rate limiting + abuse alerting; global + per-user kill-switch.
- Clear "unofficial / not affiliated" disclaimers in UI + ToS + Privacy.
- Self-service disconnect + GDPR export/delete tools.
- Acting only as the authenticated account owner; no cross-tenant access.

## Recommendation

Treat the live-terms read as a **launch blocker**: complete it (item-by-item
against the list above) and record the outcome here before flipping signup to
public. If any clause clearly prohibits this kind of access, reconsider public
launch and keep the tool private/personal. Keep the kill-switch ready regardless.

> Reviewed: _pending_ — fill in date, which documents were read, and the
> decision once the maintainer completes the live review.
