/**
 * attendance-reader.ts — DB 出席查詢（從 monthly_attendance 向量讀取）
 *
 * v2: 核心日期提取邏輯已移至 attendance-utils.ts
 */
import prisma from './prisma';
import type { AttendanceEntry } from './billing-engine';
import { extractBillableDates, formatDateUTC } from './attendance-utils';

/**
 * Get all billable attendance entries (Y or YY) for an enrollment,
 * ordered chronologically, starting AFTER the given date.
 *
 * 比較使用日期字串（"YYYY/MM/DD"）避免 Date 物件的時區問題：
 *   - afterDate 來自 DB @db.Date，Prisma 回傳 UTC midnight
 *   - billable dates 來自 extractBillableDates，可能是 local time
 *   - 直接比較 Date 物件會因時區差異導致 off-by-one
 */
export async function getBillableAttendance(
  enrollmentId: number,
  afterDate: Date | null = null,
): Promise<AttendanceEntry[]> {
  const allMonths = await prisma.monthlyAttendance.findMany({
    where: { enrollmentId },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const billable = extractBillableDates(allMonths, { useUTC: true, validateDate: true });

  // 用日期字串比較，避免時區導致的 off-by-one
  const afterStr = afterDate ? formatDateUTC(afterDate) : null;

  return billable
    .filter(b => !afterStr || b.dateStr > afterStr)
    .map(b => ({ date: b.dateStr, status: b.code }));
}

/**
 * Get the last billed date for an enrollment (FLAG),
 * to determine where billing should resume.
 *
 * 優先用 records 裡的最後一天（實際上課日），
 * 因為 Sheets endDate 可能比最後上課日早一天。
 * 若 records 為空（SYNC invoice），fallback 用 endDate。
 */
export async function getLastInvoiceEndDate(enrollmentId: number): Promise<Date | null> {
  const lastInvoice = await prisma.invoice.findFirst({
    where: { enrollmentId },
    orderBy: { endDate: 'desc' },
    select: { endDate: true, records: true },
  });
  if (!lastInvoice) return null;

  // 從 records 取最後一天
  const records = lastInvoice.records as { date: string }[] | null;
  if (records && Array.isArray(records) && records.length > 0) {
    const lastRecordDate = records[records.length - 1].date; // "2026/03/10"
    const [y, m, d] = lastRecordDate.split('/').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  // fallback: 用 endDate
  return lastInvoice.endDate;
}
