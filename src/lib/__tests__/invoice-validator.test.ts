import { describe, test, expect } from 'vitest';
import {
  classifyShape,
  validateChainLink,
  validateSingle,
  parseNoteDates,
  uiFlags,
  type InvoiceLite,
} from '../invoice-validator';
import type { BilledRecord, RateConfig } from '../billing-engine';

const PLAN_B: RateConfig = {
  fullSessionFee: 800, halfSessionFee: 400,
  settlementSessions: 5, hoursPerSession: 3.0,
};

function rec(date: string, status: 2 | 3, fee: number, yUsed: number, isSplit = false): BilledRecord {
  return { date, status, yUsed, fee, isSplit };
}

function inv(serial: string, records: BilledRecord[], note: string | null = null): InvoiceLite {
  const totalY = records.reduce((s, r) => s + r.yUsed, 0);
  const yyCount = records.filter(r => r.status === 3 && !r.isSplit).length;
  const yCount = records.filter(r => r.status === 2 || r.isSplit).length;
  const amount = records.reduce((s, r) => s + r.fee, 0);
  return { id: 1, serialNumber: serial, amount, totalY, yyCount, yCount, records, note, status: 'pending' };
}

describe('classifyShape', () => {
  test('STANDARD_5YY', () => {
    const result = classifyShape([
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 800, 2),
    ]);
    expect(result.shape).toBe('STANDARD_5YY');
    expect(result.fullYYCount).toBe(5);
    expect(result.splitCount).toBe(0);
    expect(result.hasCarriedIn).toBe(false);
    expect(result.hasCarriedOut).toBe(false);
  });

  test('SPLIT_BRIDGE (Y+4×YY+Y)', () => {
    const result = classifyShape([
      rec('2026/02/25', 3, 400, 1, true),  // 帶入
      rec('2026/03/03', 3, 800, 2),
      rec('2026/03/10', 3, 800, 2),
      rec('2026/03/17', 3, 800, 2),
      rec('2026/03/24', 3, 800, 2),
      rec('2026/04/14', 3, 400, 1, true),  // 帶出
    ]);
    expect(result.shape).toBe('SPLIT_BRIDGE');
    expect(result.fullYYCount).toBe(4);
    expect(result.splitCount).toBe(2);
    expect(result.hasCarriedIn).toBe(true);
    expect(result.hasCarriedOut).toBe(true);
  });

  test('SPLIT_HEAD (4×YY+Y, 帶出)', () => {
    const result = classifyShape([
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 400, 1, true),  // 帶出
    ]);
    expect(result.shape).toBe('SPLIT_HEAD');
    expect(result.hasCarriedOut).toBe(true);
    expect(result.hasCarriedIn).toBe(false);
  });

  test('SPLIT_TAIL (Y+4×YY, 帶入)', () => {
    const result = classifyShape([
      rec('2026/02/25', 3, 400, 1, true),  // 帶入
      rec('2026/03/03', 3, 800, 2),
      rec('2026/03/10', 3, 800, 2),
      rec('2026/03/17', 3, 800, 2),
      rec('2026/03/24', 3, 800, 2),
    ]);
    expect(result.shape).toBe('SPLIT_TAIL');
    expect(result.hasCarriedIn).toBe(true);
    expect(result.hasCarriedOut).toBe(false);
  });

  test('IRREGULAR: 1 record only', () => {
    const result = classifyShape([rec('2026/01/04', 3, 800, 2)]);
    expect(result.shape).toBe('IRREGULAR');
  });

  test('IRREGULAR: 6 full YY (overshoot)', () => {
    const result = classifyShape([
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 800, 2),
      rec('2026/02/08', 3, 800, 2),
    ]);
    expect(result.shape).toBe('IRREGULAR');
    expect(result.fullYYCount).toBe(6);
  });

  test('WITH_HALF: 含老師標 Y', () => {
    const result = classifyShape([
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/12', 2, 400, 1),  // 老師標 Y
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 800, 2),
    ]);
    expect(result.shape).toBe('WITH_HALF');
  });
});

describe('validateChainLink', () => {
  test('CHAIN_BROKEN: 上張帶出但本張沒帶入', () => {
    const prev = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 400, 1, true),  // 帶出
    ]);
    const curr = inv('B', [
      rec('2026/02/08', 3, 800, 2),
      rec('2026/02/15', 3, 800, 2),
      rec('2026/02/22', 3, 800, 2),
      rec('2026/03/01', 3, 800, 2),
      rec('2026/03/08', 3, 800, 2),
    ]);
    const issues = validateChainLink(prev, curr);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('CHAIN_BROKEN');
  });

  test('OK: 鏈條完整 (帶出 → 帶入)', () => {
    const prev = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 400, 1, true),
    ]);
    const curr = inv('B', [
      rec('2026/02/01', 3, 400, 1, true),  // 帶入
      rec('2026/02/08', 3, 800, 2),
      rec('2026/02/15', 3, 800, 2),
      rec('2026/02/22', 3, 800, 2),
      rec('2026/03/01', 3, 800, 2),
    ]);
    const issues = validateChainLink(prev, curr);
    expect(issues).toHaveLength(0);
  });

  test('ORPHAN_BROUGHT_IN: 本張帶入但上張沒帶出', () => {
    const prev = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 800, 2),  // 沒拆
    ]);
    const curr = inv('B', [
      rec('2026/02/08', 3, 400, 1, true),  // 帶入但無對應
      rec('2026/02/15', 3, 800, 2),
      rec('2026/02/22', 3, 800, 2),
      rec('2026/03/01', 3, 800, 2),
      rec('2026/03/08', 3, 800, 2),
    ]);
    const issues = validateChainLink(prev, curr);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ORPHAN_BROUGHT_IN');
  });

  test('DATE_MISMATCH', () => {
    const prev = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 400, 1, true),  // 帶出 02/01
    ]);
    const curr = inv('B', [
      rec('2026/02/08', 3, 400, 1, true),  // 帶入 02/08（不是 02/01）
      rec('2026/02/15', 3, 800, 2),
      rec('2026/02/22', 3, 800, 2),
      rec('2026/03/01', 3, 800, 2),
      rec('2026/03/08', 3, 800, 2),
    ]);
    const issues = validateChainLink(prev, curr);
    expect(issues.some(i => i.type === 'DATE_MISMATCH')).toBe(true);
  });
});

describe('validateSingle', () => {
  test('amount mismatch', () => {
    const i = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
    ]);
    i.amount = 9999;
    const issues = validateSingle(i, PLAN_B);
    expect(issues.some(x => x.field === 'amount')).toBe(true);
  });

  test('totalY overshoot', () => {
    const i = inv('A', Array.from({ length: 6 }, (_, k) =>
      rec(`2026/01/${String(k * 4 + 1).padStart(2, '0')}`, 3, 800, 2),
    ));
    i.totalY = 12;
    const issues = validateSingle(i, PLAN_B);
    expect(issues.some(x => x.field === 'totalY')).toBe(true);
  });
});

describe('parseNoteDates', () => {
  test('帶入帶出', () => {
    const r = parseNoteDates('拆分：2026/02/25 帶入 1Y；2026/04/14 帶出 1Y');
    expect(r.broughtIn).toBe('2026/02/25');
    expect(r.broughtOut).toBe('2026/04/14');
  });
  test('只帶出', () => {
    const r = parseNoteDates('拆分：2026/04/14 帶出 1Y');
    expect(r.broughtOut).toBe('2026/04/14');
    expect(r.broughtIn).toBeUndefined();
  });
  test('null', () => {
    expect(parseNoteDates(null)).toEqual({});
  });
});

describe('uiFlags', () => {
  test('SPLIT_BRIDGE → isSplit=true', () => {
    const i = inv('A', [
      rec('2026/02/25', 3, 400, 1, true),
      rec('2026/03/03', 3, 800, 2),
      rec('2026/03/10', 3, 800, 2),
      rec('2026/03/17', 3, 800, 2),
      rec('2026/03/24', 3, 800, 2),
      rec('2026/04/14', 3, 400, 1, true),
    ]);
    const flags = uiFlags(i);
    expect(flags.isSplit).toBe(true);
    expect(flags.isIrregular).toBe(false);
  });

  test('STANDARD_5YY → isSplit=false', () => {
    const i = inv('A', [
      rec('2026/01/04', 3, 800, 2),
      rec('2026/01/11', 3, 800, 2),
      rec('2026/01/18', 3, 800, 2),
      rec('2026/01/25', 3, 800, 2),
      rec('2026/02/01', 3, 800, 2),
    ]);
    const flags = uiFlags(i);
    expect(flags.isSplit).toBe(false);
    expect(flags.isIrregular).toBe(false);
  });

  test('IRREGULAR → isIrregular=true', () => {
    const i = inv('A', [rec('2026/01/04', 3, 800, 2)]);
    const flags = uiFlags(i);
    expect(flags.isIrregular).toBe(true);
  });
});
