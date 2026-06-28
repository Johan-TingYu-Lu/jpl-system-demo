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

  test('carriedFromPrev: 帶入 1Y + 4 YY + 拆出 1Y = 標準拆分鏈條 (Plan B)', () => {
    // 上期帶出 02/25，本期實際出席 03/03~04/14 共 5 次 YY
    const attendance: AttendanceEntry[] = [
      { date: '2026/03/03', status: 3 },
      { date: '2026/03/10', status: 3 },
      { date: '2026/03/17', status: 3 },
      { date: '2026/03/24', status: 3 },
      { date: '2026/04/14', status: 3 },
    ];
    const result = calculateBilling(attendance, PLAN_B, 'normal', { date: '2026/02/25' });

    expect(result.canGenerate).toBe(true);
    expect(result.records).toHaveLength(6); // 帶入 + 4 YY + 帶出
    expect(result.records[0]).toEqual({
      date: '2026/02/25', status: 3, yUsed: 1, fee: 400, isSplit: true,
    });
    expect(result.records[5]).toEqual({
      date: '2026/04/14', status: 3, yUsed: 1, fee: 400, isSplit: true,
    });
    expect(result.totalY).toBe(10);
    expect(result.totalFee).toBe(4000);
    expect(result.yyCount).toBe(4);
    expect(result.yCount).toBe(2); // 帶入 + 帶出
    expect(result.splitNote).toBe('拆分：2026/02/25 帶入 1Y；2026/04/14 帶出 1Y');
    expect(result.carriedOut).toBe('2026/04/14');
  });

  test('carriedFromPrev only (帶入 + 5 YY 不拆出，理論不會發生但需正確)', () => {
    // 帶入 1Y 後，4 YY (8Y) 加帶入 = 9Y，第 5 個 YY (2Y) 會拆 → 結算
    // 所以這 case 實際必拆。為驗證「不拆出」需要 force mode + 短輸入。
    const result = calculateBilling(
      [{ date: '2026/03/03', status: 3 }],
      PLAN_B,
      'force',
      { date: '2026/02/25' },
    );
    expect(result.records).toHaveLength(2);
    expect(result.records[0].isSplit).toBe(true);  // 帶入
    expect(result.records[1].isSplit).toBe(false); // 1 YY
    expect(result.totalY).toBe(3);
    expect(result.totalFee).toBe(400 + 800);
    expect(result.splitNote).toBe('拆分：2026/02/25 帶入 1Y');
    expect(result.carriedOut).toBeNull();
  });

  test('carriedOut 為 null 當無拆分發生', () => {
    const result = calculateBilling(makeYY(5), PLAN_B);
    expect(result.carriedOut).toBeNull();
    expect(result.splitNote).toBeNull();
  });

  test('carriedOut 為帶出日期當本期最後一筆是拆分', () => {
    const attendance: AttendanceEntry[] = [
      ...makeYY(4),
      { date: '2026/01/15', status: 2 },   // 9Y
      { date: '2026/01/18', status: 3 },   // split
    ];
    const result = calculateBilling(attendance, PLAN_B);
    expect(result.carriedOut).toBe('2026/01/18');
    expect(result.splitNote).toBe('拆分：2026/01/18 帶出 1Y');
  });
});
