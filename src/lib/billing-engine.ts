/**
 * billing-engine.ts — 可配置計費引擎（純函式，無副作用）
 *
 * 取代 import-invoices.ts 的 calculate10Y()
 * 支援所有費率方案（A/B/C-850/C-900）
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

export interface BillingResult {
  canGenerate: boolean;         // true if settlement point reached (or force mode)
  records: BilledRecord[];      // itemized records for this invoice
  totalY: number;               // sum of yUsed
  totalFee: number;             // sum of fees
  yyCount: number;              // count of full YY sessions billed
  yCount: number;               // count of Y sessions billed (includes split halves)
  splitNote: string | null;     // note text if a split occurred
  sessionInfoText: string;      // e.g., "5次15H" for display
  leftoverEntries: AttendanceEntry[]; // unconsumed entries for next period
}

// ============================================================================
// Main billing calculation
// ============================================================================

export function calculateBilling(
  attendance: AttendanceEntry[],
  rateConfig: RateConfig,
  mode: 'normal' | 'force' = 'normal'
): BillingResult {
  const { fullSessionFee, halfSessionFee, settlementSessions, hoursPerSession } = rateConfig;
  const settlementY = settlementSessions * 2; // target Y count (e.g., 10)

  let yAccum = 0;
  const records: BilledRecord[] = [];
  let splitNote: string | null = null;
  let lastProcessedIdx = -1;

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

      // Generate the split note
      const dateParts = date.split('/');
      const shortDate = `${dateParts[1]}/${dateParts[2]}`;
      splitNote = `(註：${shortDate}上課${hoursPerSession}小時，計費${hoursPerSession / 2}hr，尚有${hoursPerSession / 2}hr未記入本次收費，下次收取)`;
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
    // If last processed entry was a split, add the remaining half
    const lastRecord = records[records.length - 1];
    if (lastRecord?.isSplit) {
      leftoverEntries.push({
        date: attendance[lastProcessedIdx].date,
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
  };
}
