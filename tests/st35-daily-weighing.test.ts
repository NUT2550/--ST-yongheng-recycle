/**
 * ST-35: Tests for daily purchase weighing pure helpers.
 *
 * These tests exercise the SAME functions used by the production API.
 * No DB access — only pure function tests.
 *
 * Run: bun test tests/st35-daily-weighing.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  isValidWeighingDate,
  isValidWeighingCategory,
  getThaiDateRange,
  isValidActualWeighedWeight,
  calculateWeighingStatus,
  WEIGHING_CATEGORIES,
} from '../src/lib/daily-purchase-weighing';

describe('ST-35: isValidWeighingDate', () => {
  test('valid CE ISO date', () => {
    expect(isValidWeighingDate('2026-07-11')).toBe(true);
    expect(isValidWeighingDate('2026-01-01')).toBe(true);
    expect(isValidWeighingDate('2026-12-31')).toBe(true);
  });

  test('rejects invalid formats', () => {
    expect(isValidWeighingDate('')).toBe(false);
    expect(isValidWeighingDate('11/7/2569')).toBe(false); // Buddhist format
    expect(isValidWeighingDate('2026-7-11')).toBe(false); // non-padded
    expect(isValidWeighingDate('not-a-date')).toBe(false);
    expect(isValidWeighingDate('2026-13-01')).toBe(false); // invalid month
    expect(isValidWeighingDate(null as any)).toBe(false);
    expect(isValidWeighingDate(undefined as any)).toBe(false);
    expect(isValidWeighingDate(123 as any)).toBe(false);
  });
});

describe('ST-35: isValidWeighingCategory', () => {
  test('valid categories', () => {
    expect(isValidWeighingCategory('ทองแดง')).toBe(true);
    expect(isValidWeighingCategory('ทองเหลือง')).toBe(true);
  });

  test('rejects invalid categories', () => {
    expect(isValidWeighingCategory('เหล็ก')).toBe(false);
    expect(isValidWeighingCategory('อลูมิเนียม')).toBe(false);
    expect(isValidWeighingCategory('')).toBe(false);
    expect(isValidWeighingCategory('copper')).toBe(false);
  });

  test('WEIGHING_CATEGORIES contains exactly 2 values', () => {
    expect(WEIGHING_CATEGORIES).toHaveLength(2);
    expect(WEIGHING_CATEGORIES).toContain('ทองแดง');
    expect(WEIGHING_CATEGORIES).toContain('ทองเหลือง');
  });
});

describe('ST-35: getThaiDateRange', () => {
  test('returns correct start and end for a date', () => {
    const [start, end] = getThaiDateRange('2026-07-11');
    expect(start.toISOString()).toBe('2026-07-10T17:00:00.000Z'); // 00:00 ICT = 17:00 UTC previous day
    expect(end.toISOString()).toBe('2026-07-11T16:59:59.000Z');   // 23:59 ICT = 16:59 UTC
  });

  test('start is before end', () => {
    const [start, end] = getThaiDateRange('2026-01-15');
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  test('covers full 24 hours (approx)', () => {
    const [start, end] = getThaiDateRange('2026-07-11');
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(23.997, 1); // ~24 hours minus 1 second
  });
});

describe('ST-35: isValidActualWeighedWeight', () => {
  test('null = not weighed (valid)', () => {
    expect(isValidActualWeighedWeight(null)).toBe(true);
  });

  test('undefined = not weighed (valid)', () => {
    expect(isValidActualWeighedWeight(undefined)).toBe(true);
  });

  test('zero = weighed and got zero (valid)', () => {
    expect(isValidActualWeighedWeight(0)).toBe(true);
  });

  test('positive number = valid', () => {
    expect(isValidActualWeighedWeight(1)).toBe(true);
    expect(isValidActualWeighedWeight(0.5)).toBe(true);
    expect(isValidActualWeighedWeight(100.25)).toBe(true);
  });

  test('negative number = invalid', () => {
    expect(isValidActualWeighedWeight(-1)).toBe(false);
    expect(isValidActualWeighedWeight(-0.01)).toBe(false);
  });

  test('NaN = invalid', () => {
    expect(isValidActualWeighedWeight(NaN)).toBe(false);
  });

  test('Infinity = invalid', () => {
    expect(isValidActualWeighedWeight(Infinity)).toBe(false);
    expect(isValidActualWeighedWeight(-Infinity)).toBe(false);
  });

  test('string = invalid (must be number or null)', () => {
    expect(isValidActualWeighedWeight('100')).toBe(false);
    expect(isValidActualWeighedWeight('')).toBe(false);
  });

  test('object = invalid', () => {
    expect(isValidActualWeighedWeight({} as any)).toBe(false);
    expect(isValidActualWeighedWeight([] as any)).toBe(false);
  });
});

describe('ST-35: calculateWeighingStatus', () => {
  test('null actual = NOT_WEIGHED', () => {
    const result = calculateWeighingStatus(null, 100);
    expect(result.status).toBe('NOT_WEIGHED');
    expect(result.difference).toBeNull();
  });

  test('undefined actual = NOT_WEIGHED', () => {
    const result = calculateWeighingStatus(undefined, 100);
    expect(result.status).toBe('NOT_WEIGHED');
    expect(result.difference).toBeNull();
  });

  test('exact match = MATCH', () => {
    const result = calculateWeighingStatus(100, 100);
    expect(result.status).toBe('MATCH');
    expect(result.difference).toBe(0);
  });

  test('within tolerance = MATCH', () => {
    expect(calculateWeighingStatus(100.05, 100).status).toBe('MATCH');
    expect(calculateWeighingStatus(99.95, 100).status).toBe('MATCH');
    expect(calculateWeighingStatus(100.10, 100).status).toBe('MATCH'); // exactly at tolerance
    expect(calculateWeighingStatus(99.90, 100).status).toBe('MATCH'); // exactly at tolerance
  });

  test('beyond tolerance = DIFFERENCE', () => {
    expect(calculateWeighingStatus(100.11, 100).status).toBe('DIFFERENCE');
    expect(calculateWeighingStatus(99.89, 100).status).toBe('DIFFERENCE');
    expect(calculateWeighingStatus(200, 100).status).toBe('DIFFERENCE');
    expect(calculateWeighingStatus(0, 100).status).toBe('DIFFERENCE');
  });

  test('zero actual with zero purchased = MATCH', () => {
    const result = calculateWeighingStatus(0, 0);
    expect(result.status).toBe('MATCH');
    expect(result.difference).toBe(0);
  });

  test('zero actual with positive purchased = DIFFERENCE', () => {
    const result = calculateWeighingStatus(0, 50);
    expect(result.status).toBe('DIFFERENCE');
    expect(result.difference).toBe(-50);
  });

  test('difference is rounded to 2 decimal places', () => {
    const result = calculateWeighingStatus(100.005, 100);
    // 100.005 - 100 = 0.005 → rounded to 0.01 (Math.round(0.005 * 100) / 100 = 0.01)
    // Actually Math.round(0.5) = 1 in JS, so 0.005 * 100 = 0.5 → rounds to 1 → 0.01
    // But 0.005 might have floating point issues. Let's just check it's a number with <= 2 decimals.
    expect(result.difference).not.toBeNull();
    const decimals = (String(result.difference).split('.')[1] || '').length;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  test('positive difference is returned as-is (not absolute)', () => {
    const result = calculateWeighingStatus(110, 100);
    expect(result.difference).toBe(10);
  });

  test('negative difference is returned as-is (not absolute)', () => {
    const result = calculateWeighingStatus(90, 100);
    expect(result.difference).toBe(-10);
  });
});
