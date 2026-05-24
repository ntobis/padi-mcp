import { describe, expect, it } from 'vitest';
import { isoToUsDate, normaliseDate, usToIsoDate, nowNaiveTimestamp } from '../src/transforms/dates.js';
import { toNumber, toNumericString } from '../src/transforms/numbers.js';

describe('date transforms', () => {
  it('ISO → US', () => {
    expect(isoToUsDate('2026-05-24')).toBe('05/24/2026');
    expect(isoToUsDate('1900-01-01')).toBe('01/01/1900');
  });
  it('US → ISO', () => {
    expect(usToIsoDate('05/24/2026')).toBe('2026-05-24');
  });
  it('normalise accepts both formats', () => {
    expect(normaliseDate('2026-05-24')).toBe('2026-05-24');
    expect(normaliseDate('05/24/2026')).toBe('2026-05-24');
  });
  it('rejects bad input', () => {
    expect(() => isoToUsDate('2026/05/24')).toThrow();
    expect(() => usToIsoDate('2026-05-24')).toThrow();
    expect(() => normaliseDate('May 24, 2026')).toThrow();
  });
  it('nowNaiveTimestamp returns matching shape', () => {
    const fixed = new Date('2026-05-24T07:42:39Z');
    expect(nowNaiveTimestamp(fixed)).toBe('2026-05-24T07:42:39');
  });
});

describe('number transforms', () => {
  it('toNumber handles all wire shapes', () => {
    expect(toNumber('25')).toBe(25);
    expect(toNumber('25.000')).toBe(25);
    expect(toNumber(25)).toBe(25);
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('not a number')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it('toNumericString round-trips', () => {
    expect(toNumericString(25)).toBe('25');
    expect(toNumericString('25.5')).toBe('25.5');
    expect(toNumericString(null)).toBeNull();
  });
});
