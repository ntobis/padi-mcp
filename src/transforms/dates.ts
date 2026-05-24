/**
 * PADI date format quirks:
 *  - Reads return ISO date `YYYY-MM-DD`.
 *  - Writes require US-style `MM/DD/YYYY`.
 *  - `created_date` / `update_date` use naive ISO-8601 with no timezone:
 *    `YYYY-MM-DDTHH:MM:SS`.
 *
 * These helpers convert between the formats and never lift to the platform
 * timezone — PADI's backend appears to treat everything as wall-clock.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function isoToUsDate(iso: string): string {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${iso}"`);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function usToIsoDate(us: string): string {
  const m = US_DATE_RE.exec(us);
  if (!m) throw new Error(`Expected MM/DD/YYYY, got "${us}"`);
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Accept either format and normalise to YYYY-MM-DD (canonical TS shape).
 */
export function normaliseDate(input: string): string {
  if (ISO_DATE_RE.test(input)) return input;
  if (US_DATE_RE.test(input)) return usToIsoDate(input);
  throw new Error(`Unrecognised date format "${input}" (want YYYY-MM-DD or MM/DD/YYYY)`);
}

/**
 * Produce a PADI-style naive timestamp for the current moment.
 * Returns `YYYY-MM-DDTHH:MM:SS` in local wall-clock terms.
 *
 * The web client uses local time without a timezone suffix. The captured
 * payloads show `2026-05-24T07:42:39` for a request fired at 07:42 UTC —
 * the user's machine was in UTC; this is just wall-clock. We mirror that.
 */
export function nowNaiveTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`
  );
}
