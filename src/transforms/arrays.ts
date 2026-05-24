/**
 * `additional_equipment` is a Postgres `text[]` column exposed through
 * Hasura. Asymmetric on the wire:
 *   - Reads: JSON array of strings  (e.g. ["Camera","Light"])
 *   - Writes: Postgres array literal STRING (e.g. '{"Camera","Light"}')
 *
 * Sending a JSON array on write yields `parse-failed: A string is expected
 * for type: _text`. Sending a bare string yields `malformed array literal`.
 * Confirmed empirically against the live API (see docs/enums.md → "Extra
 * probe run" + scripts/probe-array.ts).
 *
 * These helpers convert between the canonical `string[]` shape and the
 * pg-literal-string shape, plus a tolerant reader for backwards-safety in
 * case the column ever returns a literal string instead of a parsed array.
 */

const PG_ARRAY_RE = /^\{(.*)\}$/s;

/**
 * Serialise a TS string[] into a Postgres-array literal accepted by the
 * Hasura `_text` scalar. Each item is double-quoted and embedded quotes /
 * backslashes are escaped. Empty array → "{}". null/undefined → null.
 */
export function toPgTextArray(input: string[] | null | undefined): string | null {
  if (input == null) return null;
  if (input.length === 0) return '{}';
  const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `{${input.map(quote).join(',')}}`;
}

/**
 * Normalise whatever the read path returns into `string[] | null`.
 * The live API returns a JSON array; we keep the literal-string fallback so a
 * cached or older payload doesn't crash callers.
 */
export function fromAdditionalEquipment(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === 'string') {
    if (value === '' || value === '{}') return [];
    const m = PG_ARRAY_RE.exec(value);
    if (!m) return [value]; // tolerate bare string as 1-item list
    const inner = m[1] ?? '';
    return splitPgArray(inner);
  }
  return null;
}

/**
 * Split the inside of a Postgres array literal into items, respecting
 * double-quoted elements that may themselves contain commas / escaped quotes.
 */
function splitPgArray(inner: string): string[] {
  if (inner === '') return [];
  const out: string[] = [];
  let buf = '';
  let inQuotes = false;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (inQuotes) {
      if (c === '\\' && i + 1 < inner.length) {
        buf += inner[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  out.push(buf);
  return out;
}

/**
 * Accept either canonical (string[]) or a pre-formatted pg literal string
 * and normalise to a pg literal string for the write path. Strings that look
 * like pg literals already (start with `{`) pass through unchanged.
 */
export function coerceAdditionalEquipmentWrite(
  value: string | string[] | null | undefined,
): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return toPgTextArray(value);
  if (value.startsWith('{') && value.endsWith('}')) return value;
  // Single bare string from a relaxed caller — wrap it.
  return toPgTextArray([value]);
}
