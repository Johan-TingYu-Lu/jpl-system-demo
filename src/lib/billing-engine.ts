/**
 * billing-engine.ts — 可配置計費引擎（純函式，無副作用）
 *
 * 取代 import-invoices.ts 的 calculate10Y()
 * 支援所有費率方案（A/B/C-850/C-900）
 *
 * v3: 加 carriedFromPrev — 處理拆分鏈條（上期帶出 1Y → 本期 records 第一筆帶入）
 */

// ============================================================================
// Types
// ============================================================================

export interface RateConfig {
  fullSessionFee: number;     // YY fee (e.g., 800)
  halfSessionFee: number;     // Y fee (e.g., 400)
  settlementSessions: number; // sessions to trigger invoice (e.g., 5)
  hoursPerSession: number;    // hours per YY session (e.g., 3.0)
}

export interface AttendanceEntry {
  date: string;   // "YYYY/MM/DD"
  status: 2 | 3;  // 2=Y (half day), 3=YY (full day)
}

export interface BilledRecord {
  date: string;
  status: 2 | 3;
  yUsed: number;    // Y count consumed: 1 for Y, 2 for YY, or 1 if split
  fee: number;      // fee charged for this line
  isSplit: boolean;  // true if this YY was split (only 1Y charged here)
}

/**
 * 從上期帶入的 1Y（上期的最後一筆 YY 被拆分，剩 1.5hr 帶入本期）。
 * 給 calculateBilling 第三個參數使用，會在 records 開頭塞一筆 isSplit=true 帶入。
 */
export interface CarriedFromPrev {
  /** 上期帶出的那天 (YYYY/MM/DD) */
  date: string;
}

export interface BillingResult {
  canGenerate: boolean;         // true if settlement point reached (or force mode)
  records: BilledRecord[];      // itemized records for this invoice
  totalY: number;               // sum of yUsed
  totalFee: number;             // sum of fees
  yyCount: number;              // count of full YY sessions billed
  yCount: number;               // count of Y sessions billed (includes split halves)
  splitNote: string | null;     // note text if a split occurred (DB 用 "拆分：..." 格式)
  sessionInfoText: string;      // e.g., "5次15H" for display
  leftoverEntries: AttendanceEntry[]; // unconsumed entries for next period
  /** 本期帶出的那天（最後一筆 isSplit=true 的日期），下期應作為 carriedFromPrev 帶入 */
  carriedOut: string | null;
}

// ============================================================================
// Main billing calculation
// ============================================================================

export function calculateBilling(
  attendance: AttendanceEntry[],
  rateConfig: RateConfig,
  mode: 'normal' | 'force' = 'normal',
  carriedFromPrev?: CarriedFromPrev,
): BillingResult {
  const { fullSessionFee, halfSessionFee, settlementSessions, hoursPerSession } = rateConfig;
  const settlementY = settlementSessions * 2; // target Y count (e.g., 10)

  let yAccum = 0;
  const records: BilledRecord[] = [];
  let lastProcessedIdx = -1;

  // 帶入 1Y：上期最後一筆拆分的剩餘 1.5hr，本期視為 isSplit=true (1Y / halfFee)
  let carriedInDate: string | null = null;
  if (carriedFromPrev) {
    carriedInDate = carriedFromPrev.date;
    records.push({
      date: carriedFromPrev.date,
      status: 3,
      yUsed: 1,
      fee: halfSessionFee,
      isSplit: true,
    });
    yAccum = 1;
  }

  let carriedOutDate: string | null = null;

  for (let i = 0; i < attendance.length; i++) {
    const { date, status } = attendance[i];
    const yVal = status === 3 ? 2 : 1; // YY=2Y, Y=1Y

    if (mode === 'normal' && yAccum + yVal > settlementY) {
      // SPLIT CASE: adding this entry would exceed settlement
      const needed = settlementY - yAccum;
      records.push({
        date,
        status,
        yUsed: needed,
        fee: halfSessionFee,
        isSplit: true,
      });
      yAccum = settlementY;
      lastProcessedIdx = i;
      carriedOutDate = date;
      break;
    } else {
      const fee = status === 3 ? fullSessionFee : halfSessionFee;
      records.push({
        date,
        status,
        yUsed: yVal,
        fee,
        isSplit: false,
      });
      yAccum += yVal;
      lastProcessedIdx = i;
      if (mode === 'normal' && yAccum >= settlementY) break;
    }
  }

  const canGenerate = mode === 'force' ? records.length > 0 : yAccum >= settlementY;

  // Build leftover entries (unconsumed attendance)
  const leftoverEntries: AttendanceEntry[] = [];
  if (lastProcessedIdx >= 0) {
    // If last processed entry was a split (carried-out), add the remaining half
    if (carriedOutDate) {
      leftoverEntries.push({
        date: carriedOutDate,
        status: 2, // the remaining half is effectively a Y
      });
    }
    // Add all fully unconsumed entries
    for (let i = lastProcessedIdx + 1; i < attendance.length; i++) {
      leftoverEntries.push(attendance[i]);
    }
  }

  // Compute display values
  const totalFee = records.reduce((sum, r) => sum + r.fee, 0);
  const yyCount = records.filter(r => r.status === 3 && !r.isSplit).length;
  const yCount = records.filter(r => r.status === 2 || r.isSplit).length;
  const totalHours = records.reduce((sum, r) => {
    if (r.isSplit) return sum + hoursPerSession / 2;
    return sum + (r.status === 3 ? hoursPerSession : hoursPerSession / 2);
  }, 0);
  const sessionInfoText = `${records.length}次${totalHours}H`;

  // splitNote: DB 用 "拆分：..." 格式 (PDF 自己 buildSplitNote 不依賴此欄)
  let splitNote: string | null = null;
  if (carriedInDate || carriedOutDate) {
    const parts: string[] = [];
    if (carriedInDate) parts.push(`${carriedInDate} 帶入 1Y`);
    if (carriedOutDate) parts.push(`${carriedOutDate} 帶出 1Y`);
    splitNote = `拆分：${parts.join('；')}`;
  }

  return {
    canGenerate,
    records,
    totalY: yAccum,
    totalFee,
    yyCount,
    yCount,
    splitNote,
    sessionInfoText,
    leftoverEntries,
    carriedOut: carriedOutDate,
  };
}
