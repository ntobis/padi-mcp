/**
 * Hasura accepts numeric columns as either strings or numbers. The web
 * client sends strings on insert and numbers on update. We always read
 * as strings (the API returns them that way) and coerce to numbers in
 * the canonical TypeScript shape.
 */

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce a number (or numeric-looking string) to the string form Hasura
 * happily accepts on insert. Returns `null` for null/empty input.
 */
export function toNumericString(value: unknown): string | null {
  const n = toNumber(value);
  return n === null ? null : String(n);
}
