import { describe, test, expect } from 'vitest';
import { calculateBilling, type AttendanceEntry, type RateConfig } from '../billing-engine';

const PLAN_B: RateConfig = {
  fullSessionFee: 800, halfSessionFee: 400,
  settlementSessions: 5, hoursPerSession: 3.0,
};

const PLAN_A: RateConfig = {
  fullSessionFee: 750, halfSessionFee: 375,
  settlementSessions: 4, hoursPerSession: 3.0,
};

const PLAN_C850: RateConfig = {
  fullSessionFee: 850, halfSessionFee: 425,
  settlementSessions: 4, hoursPerSession: 3.0,
};

function makeYY(count: number, startDay = 1): AttendanceEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026/01/${String(startDay + i * 3).padStart(2, '0')}`,
    status: 3 as const,
  }));
}

describe('calculateBilling', () => {
  test('5 YY sessions = settlement (Plan B)', () => {
    const result = calculateBilling(makeYY(5), PLAN_B);
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(10);
    expect(result.totalFee).toBe(4000);
    expect(result.yyCount).toBe(5);
    expect(result.yCount).toBe(0);
    expect(result.splitNote).toBeNull();
    expect(result.leftoverEntries).toHaveLength(0);
    expect(result.sessionInfoText).toBe('5次15H');
  });

  test('4 YY + 1 Y + 1 YY = split at 10Y (Plan B)', () => {
    const attendance: AttendanceEntry[] = [
      ...makeYY(4),
      { date: '2026/01/15', status: 2 },  // Y = 1Y → total 9Y
      { date: '2026/01/18', status: 3 },  // YY would be 11Y → split
    ];
    const result = calculateBilling(attendance, PLAN_B);
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(10);
    expect(result.totalFee).toBe(3600 + 400); // 4 × 800 + 1 × 400 (Y) + 1 × 400 (split)
    expect(result.splitNote).not.toBeNull();
    expect(result.splitNote).toContain('01/18');
    expect(result.leftoverEntries).toHaveLength(1); // remaining 1Y from split
  });

  test('force mode generates even if under settlement', () => {
    const attendance: AttendanceEntry[] = [
      { date: '2026/01/01', status: 3 },
      { date: '2026/01/05', status: 2 },
    ];
    const result = calculateBilling(attendance, PLAN_B, 'force');
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(3);
    expect(result.totalFee).toBe(1200); // 800 + 400
  });

  test('Plan A: 4 YY sessions = settlement at 8Y/$3000', () => {
    const result = calculateBilling(makeYY(4), PLAN_A);
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(8);
    expect(result.totalFee).toBe(3000);
  });

  test('Plan C-850: 4 YY sessions = $3400', () => {
    const result = calculateBilling(makeYY(4), PLAN_C850);
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(8);
    expect(result.totalFee).toBe(3400);
  });

  test('insufficient attendance returns canGenerate=false', () => {
    const result = calculateBilling(makeYY(2), PLAN_B);
    expect(result.canGenerate).toBe(false);
    expect(result.totalY).toBe(4);
  });

  test('empty attendance', () => {
    const result = calculateBilling([], PLAN_B);
    expect(result.canGenerate).toBe(false);
    expect(result.records).toHaveLength(0);
  });

  test('mixed Y and YY sessions', () => {
    const attendance: AttendanceEntry[] = [
      { date: '2026/01/01', status: 3 },  // 2Y
      { date: '2026/01/05', status: 2 },  // 1Y → 3Y
      { date: '2026/01/08', status: 3 },  // 2Y → 5Y
      { date: '2026/01/12', status: 2 },  // 1Y → 6Y
      { date: '2026/01/15', status: 3 },  // 2Y → 8Y
      { date: '2026/01/19', status: 3 },  // 2Y → 10Y
    ];
    const result = calculateBilling(attendance, PLAN_B);
    expect(result.canGenerate).toBe(true);
    expect(result.totalY).toBe(10);
    expect(result.totalFee).toBe(800 + 400 + 800 + 400 + 800 + 800); // 4000
    expect(result.yyCount).toBe(4);
    expect(result.yCount).toBe(2);
  });

  test('leftover entries after split', () => {
    const attendance: AttendanceEntry[] = [
      ...makeYY(4),
      { date: '2026/01/15', status: 2 },  // 9Y
      { date: '2026/01/18', status: 3 },  // split → 10Y
      { date: '2026/01/21', status: 3 },  // leftover
      { date: '2026/01/24', status: 2 },  // leftover
    ];
    const result = calculateBilling(attendance, PLAN_B);
    expect(result.canGenerate).toBe(true);
    expect(result.leftoverEntries).toHaveLength(3); // split remainder + 2 unconsumed
  });
});
