import { describe, expect, it } from 'vitest';
import {
  coerceAdditionalEquipmentWrite,
  fromAdditionalEquipment,
  toPgTextArray,
} from '../src/transforms/arrays.js';
import {
  isoToUsDate,
  naiveDatetimeToIsoDate,
  normaliseDate,
  nowNaiveTimestamp,
  usToIsoDate,
} from '../src/transforms/dates.js';
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
  it('naiveDatetimeToIsoDate strips time portion', () => {
    expect(naiveDatetimeToIsoDate('2026-05-24T00:00:00')).toBe('2026-05-24');
    expect(naiveDatetimeToIsoDate('1900-01-01T00:00:00')).toBe('1900-01-01');
    expect(naiveDatetimeToIsoDate('2026-05-24')).toBe('2026-05-24');
    expect(naiveDatetimeToIsoDate(null)).toBeNull();
    expect(naiveDatetimeToIsoDate(undefined)).toBeNull();
    expect(naiveDatetimeToIsoDate('')).toBeNull();
    expect(() => naiveDatetimeToIsoDate('garbage')).toThrow();
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

describe('additional_equipment pg-array transform', () => {
  it('toPgTextArray emits the literal accepted by Hasura _text', () => {
    expect(toPgTextArray(null)).toBeNull();
    expect(toPgTextArray([])).toBe('{}');
    expect(toPgTextArray(['Camera'])).toBe('{"Camera"}');
    expect(toPgTextArray(['Camera', 'Light'])).toBe('{"Camera","Light"}');
    expect(toPgTextArray(['Dive Knife', 'Surface Marker'])).toBe('{"Dive Knife","Surface Marker"}');
    expect(toPgTextArray(['has "quote"', 'has \\back'])).toBe('{"has \\"quote\\"","has \\\\back"}');
  });
  it('fromAdditionalEquipment accepts what the API actually returns', () => {
    expect(fromAdditionalEquipment(null)).toBeNull();
    expect(fromAdditionalEquipment(['Camera', 'Light'])).toEqual(['Camera', 'Light']);
    expect(fromAdditionalEquipment('{}')).toEqual([]);
    expect(fromAdditionalEquipment('{Camera,Light}')).toEqual(['Camera', 'Light']);
    expect(fromAdditionalEquipment('{"Dive Knife","Light"}')).toEqual(['Dive Knife', 'Light']);
  });
  it('coerceAdditionalEquipmentWrite forgives a bare string', () => {
    expect(coerceAdditionalEquipmentWrite(['Camera'])).toBe('{"Camera"}');
    expect(coerceAdditionalEquipmentWrite('{Camera,Light}')).toBe('{Camera,Light}');
    expect(coerceAdditionalEquipmentWrite('Camera')).toBe('{"Camera"}');
    expect(coerceAdditionalEquipmentWrite(null)).toBeNull();
  });
});
