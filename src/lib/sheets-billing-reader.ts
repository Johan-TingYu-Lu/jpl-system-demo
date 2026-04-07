/**
 * sheets-billing-reader.ts — Google Sheets 收費紀錄讀取器（多學年支援）
 *
 * 讀取 4 張工作表，合併為結構化資料：
 *  1. 計費日期表 — 每筆收費的起止日期
 *  2. 繳費金額表 — 每筆收費的金額
 *  3. 繳費日期表 — 每筆收費的繳費日期
 *  4. 學費收支總表 — 費率門檻值
 *
 * v2: 透過 YearConfig 處理各學年欄位差異（106 無次數欄、門檻值欄等）
 */
import { readSheet } from './sheets';
import { type YearConfig, getYearConfig } from './year-config';
import { serialToDate, formatDate } from './attendance-utils';

// Re-export for backward compatibility (many files import from here)
export { serialToDate, formatDate };

// ============================================================================
// Types
// ============================================================================

export interface SheetInvoiceRecord {
  invoiceIndex: number;       // 0-based
  startDate: Date;
  endDate: Date;
  sheetAmount: number | null; // from 繳費金額表
  paymentDate: Date | null;   // from 繳費日期表
}

export interface StudentBillingData {
  sheetsId: string;
  name: string;
  classInfo: string;
  invoiceCount: number;
  invoices: SheetInvoiceRecord[];
  prepThreshold: number | null;   // 學費收支總表 col S (750 or 800)
  feeThreshold: number | null;    // 學費收支總表 col T (-3000 or -4000)
}

// ============================================================================
// Utility
// ============================================================================

// ============================================================================
// Main reader (多學年版)
// ============================================================================

/**
 * 讀取指定學年的收費歷史
 * @param config - 學年設定（來自 year-config.ts）
 */
export async function readBillingHistoryForYear(
  config: YearConfig
): Promise<StudentBillingData[]> {
  const sid = config.spreadsheetId;

  // Fetch all 4 sheets in parallel
  const [billingDateRows, feeAmountRows, paymentDateRows, summaryRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", sid),
    readSheet("'繳費金額表'!A:AZ", sid),
    readSheet("'繳費日期表'!A:AZ", sid),
    readSheet("'學費收支總表'!A:Z", sid),
  ]);

  const fmt = config.billingDate;
  const feeFmt = config.feeAmount;
  const payFmt = config.paymentDate;
  const sumFmt = config.summary;

  // ========================================
  // 繳費金額表: sheetsId → [amount1, amount2, ...]
  // ========================================
  const feeMap = new Map<string, number[]>();
  for (let r = 1; r < feeAmountRows.length; r++) {
    const row = feeAmountRows[r] as unknown[];
    const sid2 = String(row[feeFmt.idCol] || '').trim();
    if (!sid2 || !/^\d+$/.test(sid2)) continue;
    const count = parseInt(String(row[feeFmt.countCol] || '0'));
    const amounts: number[] = [];
    for (let i = 0; i < count; i++) {
      const val = row[feeFmt.amountsStartCol + i];
      amounts.push(typeof val === 'number' ? val : 0);
    }
    feeMap.set(sid2, amounts);
  }

  // ========================================
  // 繳費日期表: sheetsId → [date1, date2, ...]
  // ========================================
  const paymentMap = new Map<string, (Date | null)[]>();
  for (let r = 1; r < paymentDateRows.length; r++) {
    const row = paymentDateRows[r] as unknown[];
    const sid2 = String(row[payFmt.idCol] || '').trim();
    if (!sid2 || !/^\d+$/.test(sid2)) continue;
    const count = parseInt(String(row[payFmt.countCol] || '0'));
    const dates: (Date | null)[] = [];
    for (let i = 0; i < count; i++) {
      const val = row[payFmt.datesStartCol + i];
      if (typeof val === 'number' && val > 0) {
        dates.push(serialToDate(val));
      } else {
        dates.push(null);
      }
    }
    paymentMap.set(sid2, dates);
  }

  // ========================================
  // 學費收支總表: sheetsId → { prepThreshold, feeThreshold }
  // ========================================
  const thresholdMap = new Map<string, { prepThreshold: number | null; feeThreshold: number | null }>();
  for (let r = 1; r < summaryRows.length; r++) {
    const row = summaryRows[r] as unknown[];
    const sid2 = String(row[sumFmt.idCol] || '').trim();
    if (!sid2 || !/^\d+$/.test(sid2)) continue;
    thresholdMap.set(sid2, {
      prepThreshold: sumFmt.prepThresholdCol != null && typeof row[sumFmt.prepThresholdCol] === 'number'
        ? row[sumFmt.prepThresholdCol] as number : null,
      feeThreshold: sumFmt.feeThresholdCol != null && typeof row[sumFmt.feeThresholdCol] === 'number'
        ? row[sumFmt.feeThresholdCol] as number : null,
    });
  }

  // ========================================
  // 計費日期表 (primary source)
  // ========================================
  const results: StudentBillingData[] = [];

  for (let r = 1; r < billingDateRows.length; r++) {
    const row = billingDateRows[r] as unknown[];
    const sheetsId = String(row[fmt.idCol] || '').trim();
    const name = String(row[fmt.nameCol] || '').trim();
    const classInfo = String(row[fmt.classCol] || '').trim();

    if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

    // 取得 invoiceCount
    let invoiceCount: number;
    if (fmt.countCol != null) {
      // 107+: 有次數欄
      invoiceCount = parseInt(String(row[fmt.countCol] || '0'));
    } else {
      // 106: 無次數欄，掃描日期對數量
      invoiceCount = 0;
      for (let c = fmt.datePairsStartCol; c < row.length; c += 2) {
        if (typeof row[c] === 'number' && (row[c] as number) > 0 &&
            typeof row[c + 1] === 'number' && (row[c + 1] as number) > 0) {
          invoiceCount++;
        } else {
          break;
        }
      }
    }

    if (invoiceCount <= 0) continue;

    const fees = feeMap.get(sheetsId) || [];
    const payments = paymentMap.get(sheetsId) || [];
    const thresholds = thresholdMap.get(sheetsId);

    const invoices: SheetInvoiceRecord[] = [];
    for (let i = 0; i < invoiceCount; i++) {
      const startSerial = row[fmt.datePairsStartCol + i * 2];
      const endSerial = row[fmt.datePairsStartCol + i * 2 + 1];

      if (typeof startSerial !== 'number' || typeof endSerial !== 'number') continue;
      if (startSerial <= 0 || endSerial <= 0) continue;

      invoices.push({
        invoiceIndex: i,
        startDate: serialToDate(startSerial),
        endDate: serialToDate(endSerial),
        sheetAmount: fees[i] ?? null,
        paymentDate: payments[i] ?? null,
      });
    }

    if (invoices.length > 0) {
      results.push({
        sheetsId,
        name,
        classInfo,
        invoiceCount,
        invoices,
        prepThreshold: thresholds?.prepThreshold ?? null,
        feeThreshold: thresholds?.feeThreshold ?? null,
      });
    }
  }

  return results;
}

// ============================================================================
// 向後相容（預設 114 學年）
// ============================================================================

/**
 * 讀取收費歷史（預設 114 學年，向後相容）
 */
export async function readBillingHistory(): Promise<StudentBillingData[]> {
  const config = getYearConfig(114);
  if (!config) throw new Error('Config for year 114 not found');
  return readBillingHistoryForYear(config);
}
