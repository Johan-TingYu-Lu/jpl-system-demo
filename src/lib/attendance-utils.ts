/**
 * attendance-utils.ts — 出勤日期工具（統一提取）
 *
 * 消除 7+ 份重複的 days[] 遍歷邏輯：
 *   - attendance-reader.ts
 *   - billing-history-importer.ts
 *   - audit-engine.ts
 *   - scripts/check-db.ts, audit-detail.ts, fix_invoices.ts, check-583.ts
 *
 * 同時統一 serialToDate / formatDate（原散落 3+ 檔案）。
 */

// ============================================================================
// Date utilities（從 sheets-billing-reader.ts 提取的標準版本）
// ============================================================================

/** Excel serial number → Date (UTC noon, 避免時區邊界問題) */
export function serialToDate(serial: number): Date {
  // 用 UTC noon (12:00) 而非 midnight (00:00)
  // 這樣無論 local timezone 是 UTC+N 或 UTC-N，getDate() 都不會跳日
  return new Date((serial - 25569) * 86400 * 1000 + 12 * 3600 * 1000);
}

/** Date → "YYYY/MM/DD" */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/** Date → "YYYY/MM/DD" (UTC version，用於 serialToDate 產生的 UTC Date) */
export function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

// ============================================================================
// Attendance code constants
// ============================================================================

/** 出勤狀態碼 */
export const ATTENDANCE_CODE = {
  ABSENT: 0,
  PRESENT: 1,       // 出席但非計費
  Y: 2,             // 計費出席（Y = 1 個 Y 值）
  YY: 3,            // 計費出席（YY = 2 個 Y 值）
} as const;

/** 判斷是否為可計費出勤 */
export function isBillable(code: number): code is 2 | 3 {
  return code === ATTENDANCE_CODE.Y || code === ATTENDANCE_CODE.YY;
}

/** 單一 code 的 Y 值（Y=1, YY=2, 其他=0） */
export function codeToYValue(code: number): number {
  if (code === ATTENDANCE_CODE.YY) return 2;
  if (code === ATTENDANCE_CODE.Y) return 1;
  return 0;
}

// ============================================================================
// Types
// ============================================================================

export interface BillableDate {
  /** "YYYY/MM/DD" */
  dateStr: string;
  /** UTC Date object */
  date: Date;
  /** 2=Y, 3=YY */
  code: 2 | 3;
  /** Y 值（1 或 2） */
  yValue: number;
}

export interface MonthlyDaysInput {
  year: number;
  month: number;
  days: number[];
}

// ============================================================================
// Core extraction functions
// ============================================================================

/**
 * 從單月 days[] 提取可計費日期（通用版本）
 *
 * @param input - { year, month, days[] }
 * @param options.useUTC - true 時用 UTC Date，false 用 local Date（serialToDate 已改為 local midnight）
 * @param options.validateDate - true 時跳過不合法日期（如 2/30）
 */
export function extractBillableDatesFromMonth(
  input: MonthlyDaysInput,
  options?: { useUTC?: boolean; validateDate?: boolean }
): BillableDate[] {
  const useUTC = options?.useUTC ?? false;
  const validate = options?.validateDate ?? true;
  const results: BillableDate[] = [];

  for (let day = 0; day < 31; day++) {
    const code = input.days[day];
    if (!isBillable(code)) continue;

    const d = useUTC
      ? new Date(Date.UTC(input.year, input.month - 1, day + 1))
      : new Date(input.year, input.month - 1, day + 1);

    // Validate: e.g., Feb 30 → skips because month would be March
    if (validate) {
      const actualMonth = useUTC ? d.getUTCMonth() : d.getMonth();
      if (actualMonth !== input.month - 1) continue;
    }

    const dateStr = useUTC ? formatDateUTC(d) : formatDate(d);

    results.push({
      dateStr,
      date: d,
      code: code as 2 | 3,
      yValue: codeToYValue(code),
    });
  }

  return results;
}

/**
 * 從多月 days[] 提取可計費日期（合併 + 排序）
 */
export function extractBillableDates(
  months: MonthlyDaysInput[],
  options?: { useUTC?: boolean; validateDate?: boolean }
): BillableDate[] {
  const all: BillableDate[] = [];
  for (const m of months) {
    all.push(...extractBillableDatesFromMonth(m, options));
  }
  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  return all;
}

/**
 * 從多月 days[] 計算總 Y 值
 * （替代 audit-engine.ts 中的重複邏輯）
 */
export function countTotalY(months: MonthlyDaysInput[]): number {
  let total = 0;
  for (const m of months) {
    for (let d = 0; d < 31; d++) {
      total += codeToYValue(m.days[d]);
    }
  }
  return total;
}

/**
 * 從多月 days[] 提取指定日期範圍內的出勤
 * （替代 billing-history-importer.ts 中 getAttendanceBetween 的核心邏輯）
 *
 * @param months - 月份資料
 * @param startDate - 起始日期（inclusive）
 * @param endDate - 結束日期（inclusive）
 */
export function extractBillableDatesInRange(
  months: MonthlyDaysInput[],
  startDate: Date,
  endDate: Date,
): BillableDate[] {
  const startDay = Math.floor(startDate.getTime() / 86400000);
  const endDay = Math.floor(endDate.getTime() / 86400000);

  const results: BillableDate[] = [];
  for (const m of months) {
    for (let day = 0; day < 31; day++) {
      const code = m.days[day];
      if (!isBillable(code)) continue;

      const d = new Date(Date.UTC(m.year, m.month - 1, day + 1));
      const dDay = Math.floor(d.getTime() / 86400000);
      if (dDay >= startDay && dDay <= endDay) {
        results.push({
          dateStr: formatDateUTC(d),
          date: d,
          code: code as 2 | 3,
          yValue: codeToYValue(code),
        });
      }
    }
  }

  return results;
}
