/**
 * invoice-resyncer.ts — 收費單重新同步
 *
 * 給定一張 invoice，從 DB monthly_attendance 重新抓取該區間的出勤資料，
 * 重算 records / amount / totalY / yyCount / yCount，更新 DB。
 *
 * 使用場景：老師在網頁修改上課紀錄後，按「重新生成」按鈕。
 */
import prisma from './prisma';
import { extractBillableDates, formatDateUTC } from './attendance-utils';
import { resolveRateConfig } from './rate-resolver';
import { createAuditLog } from './audit';
import type { BilledRecord } from './billing-engine';

// ============================================================================
// Types
// ============================================================================

export interface ResyncInput {
  invoiceId: number;
  /** 若為 true，只回傳差異不寫入 */
  dryRun?: boolean;
}

export interface ResyncDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ResyncResult {
  success: boolean;
  invoiceId: number;
  serialNumber: string;
  diffs: ResyncDiff[];
  /** dry-run 時不會實際寫入 */
  applied: boolean;
  error?: string;
}

// ============================================================================
// Main
// ============================================================================

export async function resyncInvoice(input: ResyncInput): Promise<ResyncResult> {
  const { invoiceId, dryRun = false } = input;

  // 1. Load invoice + enrollment
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
  });

  if (!invoice) {
    return { success: false, invoiceId, serialNumber: '', diffs: [], applied: false, error: 'Invoice not found' };
  }

  // 2. Load attendance for this enrollment
  const allMonths = await prisma.monthlyAttendance.findMany({
    where: { enrollmentId: invoice.enrollmentId },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const allBillable = extractBillableDates(allMonths, { useUTC: true, validateDate: true });

  // 3. Filter to invoice date range [startDate, endDate]
  const startStr = formatDateUTC(invoice.startDate);
  const endStr = formatDateUTC(invoice.endDate);

  const inRange = allBillable.filter(b => b.dateStr >= startStr && b.dateStr <= endStr);

  // 4. Resolve rate config
  const resolved = await resolveRateConfig(invoice.enrollment);
  const { fullSessionFee, halfSessionFee } = resolved.config;

  // 5. Build new records
  const newRecords: BilledRecord[] = inRange.map(b => ({
    date: b.dateStr,
    status: b.code as 2 | 3,
    yUsed: b.yValue,
    fee: b.code === 3 ? fullSessionFee : halfSessionFee,
    isSplit: false,
  }));

  const newTotalY = newRecords.reduce((sum, r) => sum + r.yUsed, 0);
  const newYYCount = newRecords.filter(r => r.status === 3).length;
  const newYCount = newRecords.filter(r => r.status === 2).length;
  const newAmount = newRecords.reduce((sum, r) => sum + r.fee, 0);

  // 6. Compute diffs
  const oldRecords = (invoice.records as unknown as BilledRecord[]) || [];
  const oldDates = oldRecords.map(r => r.date).join(', ');
  const newDates = newRecords.map(r => r.date).join(', ');

  const diffs: ResyncDiff[] = [];

  if (oldDates !== newDates) {
    diffs.push({ field: 'records', before: oldDates, after: newDates });
  }
  if (Number(invoice.amount) !== newAmount) {
    diffs.push({ field: 'amount', before: Number(invoice.amount), after: newAmount });
  }
  if (invoice.totalY !== newTotalY) {
    diffs.push({ field: 'totalY', before: invoice.totalY, after: newTotalY });
  }
  if (invoice.yyCount !== newYYCount) {
    diffs.push({ field: 'yyCount', before: invoice.yyCount, after: newYYCount });
  }
  if (invoice.yCount !== newYCount) {
    diffs.push({ field: 'yCount', before: invoice.yCount, after: newYCount });
  }

  // 7. If no changes, return early
  if (diffs.length === 0) {
    return {
      success: true,
      invoiceId,
      serialNumber: invoice.serialNumber,
      diffs: [],
      applied: false,
      error: '無差異，不需更新',
    };
  }

  // 8. Apply (unless dry-run)
  if (!dryRun) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        records: newRecords as unknown as object,
        amount: newAmount,
        totalY: newTotalY,
        yyCount: newYYCount,
        yCount: newYCount,
      },
    });

    await createAuditLog({
      tableName: 'invoices',
      recordId: invoiceId,
      action: 'UPDATE',
      beforeData: {
        records: oldDates,
        amount: Number(invoice.amount),
        totalY: invoice.totalY,
        yyCount: invoice.yyCount,
        yCount: invoice.yCount,
      },
      afterData: {
        records: newDates,
        amount: newAmount,
        totalY: newTotalY,
        yyCount: newYYCount,
        yCount: newYCount,
      },
      changedBy: 'resync',
      reason: `Resync from attendance (${diffs.map(d => d.field).join(', ')})`,
    });
  }

  return {
    success: true,
    invoiceId,
    serialNumber: invoice.serialNumber,
    diffs,
    applied: !dryRun,
  };
}
