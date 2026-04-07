/**
 * invoice-generator.ts — 收費單生成協調層
 *
 * 讀 enrollment + rateConfig → 讀出席 → 計費引擎 → 寫 DB → 審計日誌
 */
import prisma from './prisma';
import { calculateBilling, type BillingResult, type RateConfig } from './billing-engine';
import { getBillableAttendance, getLastInvoiceEndDate } from './attendance-reader';
import { resolveRateConfig, resolveAllRateConfigs, type ResolvedRate } from './rate-resolver';
import { renderInvoicePdf } from './pdf-renderer';
import { createAuditLog } from './audit';
import { makeSerial as _makeSerial, makeHash } from './serial-utils';
import { pushBillingDates } from './sheets-push';
import { calendarYearToAcademicYear } from './year-config';
import { isExcluded, ACTIVE_STATUS_FILTER } from './enrollment-status';

interface GenerateInvoiceInput {
  enrollmentId: number;
  mode: 'normal' | 'force';
}

export interface GenerateInvoiceOutput {
  success: boolean;
  invoiceId?: number;
  serialNumber?: string;
  billing?: BillingResult;
  sheetPushed?: boolean;
  error?: string;
}

const YEAR_CODE = '26'; // 114 學年 = 2026

export async function generateInvoice(input: GenerateInvoiceInput): Promise<GenerateInvoiceOutput> {
  const { enrollmentId, mode } = input;

  // 1. Load enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      person: { select: { name: true } },
    },
  });
  if (!enrollment) return { success: false, error: 'Enrollment not found' };
  if (isExcluded(enrollment.status)) return { success: false, error: `Enrollment excluded (${enrollment.status})` };

  // 2. Resolve rate config (per-student, not per-class)
  const resolved = await resolveRateConfig(enrollment);
  const rateConfig = resolved.config;

  // 3. Get last invoice end date (the "FLAG")
  const lastEndDate = await getLastInvoiceEndDate(enrollmentId);

  // 4. Get billable attendance after that date
  const attendance = await getBillableAttendance(enrollmentId, lastEndDate);
  if (attendance.length === 0) return { success: false, error: 'No billable attendance found' };

  // 5. Run billing engine
  const billing = calculateBilling(attendance, rateConfig, mode);
  if (!billing.canGenerate) {
    return {
      success: false,
      error: `Insufficient Y: ${billing.totalY}/${rateConfig.settlementSessions * 2}`,
      billing,
    };
  }

  // Bug fix: 跳過金額為 0 的收費單
  if (billing.totalFee <= 0) {
    return { success: false, error: 'Calculated fee is $0, skipping' };
  }

  // 6. Compute serial number and hash
  const months = [...new Set(billing.records.map(r => r.date.split('/')[1]))].sort();
  const existingCount = await prisma.invoice.count({
    where: { enrollmentId, serialNumber: { startsWith: `${YEAR_CODE}-` } },
  });
  const serial = _makeSerial(YEAR_CODE, enrollment.sheetsId, parseInt(months[0]), enrollment.classCode, existingCount + 1);
  const hash = makeHash(serial, enrollment.sheetsId, billing.totalFee, enrollment.subject);

  // 7. Derive start/end dates from records
  //    使用 Date.UTC 確保 PostgreSQL @db.Date 存入正確日期（避免時區偏移）
  const parseUTCDate = (d: string) => {
    const [y, m, day] = d.replace(/\//g, '-').split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
  };
  const startDate = parseUTCDate(billing.records[0].date);
  const endDate = parseUTCDate(billing.records[billing.records.length - 1].date);

  // 8. Create invoice record
  const invoice = await prisma.invoice.create({
    data: {
      serialNumber: serial,
      hashCode: hash,
      enrollmentId,
      startDate,
      endDate,
      amount: billing.totalFee,
      yyCount: billing.yyCount,
      yCount: billing.yCount,
      totalY: billing.totalY,
      records: billing.records as unknown as object,
      note: billing.splitNote,
      status: 'draft',
    },
  });

  // 9. Audit log
  await createAuditLog({
    tableName: 'invoices',
    recordId: invoice.id,
    action: 'CREATE',
    afterData: { serialNumber: serial, hashCode: hash, amount: billing.totalFee, enrollmentId },
    changedBy: 'system',
    reason: mode === 'force' ? 'Force generated' : 'Auto settlement',
  });

  // 10. 不自動推 Sheets — 等老師校對 PDF 後透過 pushInvoiceToSheets() 推送

  return {
    success: true,
    invoiceId: invoice.id,
    serialNumber: serial,
    billing,
    sheetPushed: false,
  };
}

/**
 * 將 draft invoice 推送到 Sheets 計費日期表，成功後升級為 pending。
 *
 * 狀態轉換：draft → pending（只有這個路徑）
 */
export async function pushInvoiceToSheets(invoiceId: number): Promise<{
  success: boolean;
  verified: boolean;
  error?: string;
}> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { enrollment: { select: { sheetsId: true, classCode: true } } },
  });
  if (!inv) return { success: false, verified: false, error: 'Invoice not found' };
  if (inv.status !== 'draft') {
    return { success: false, verified: false, error: `只能推送 draft 狀態，目前: ${inv.status}` };
  }

  const calYear = inv.startDate.getUTCFullYear();
  const calMonth = inv.startDate.getUTCMonth() + 1;
  const academicYear = calendarYearToAcademicYear(calYear, calMonth);

  // 計算此 invoice 在同學年中的位置（1-based count）
  const yearCode = String(inv.startDate.getUTCFullYear()).slice(-2);
  const totalInvoiceCount = await prisma.invoice.count({
    where: { enrollmentId: inv.enrollmentId, serialNumber: { startsWith: `${yearCode}-` } },
  });

  try {
    const pushResult = await pushBillingDates({
      sheetsId: inv.enrollment.sheetsId,
      academicYear,
      startDate: inv.startDate,
      endDate: inv.endDate,
      invoiceCount: totalInvoiceCount,
    });

    if (pushResult.success && pushResult.verified) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'pending', sheetPushed: true },
      });
      await createAuditLog({
        tableName: 'invoices',
        recordId: invoiceId,
        action: 'UPDATE',
        beforeData: { status: 'draft', sheetPushed: false },
        afterData: { status: 'pending', sheetPushed: true },
        changedBy: 'system',
        reason: `推送至 Sheets 計費日期表: ${inv.serialNumber}`,
      });
      return { success: true, verified: true };
    }

    return { success: false, verified: false, error: pushResult.error || 'Push not verified' };
  } catch (e: any) {
    console.error(`[pushInvoiceToSheets] Failed for ${inv.enrollment.sheetsId}:`, e);
    return { success: false, verified: false, error: e.message };
  }
}

/**
 * Batch generate invoices for all active enrollments.
 * 前置步驟：先從 Sheets 同步計費歷史，確保 FLAG 最新，避免重複生成。
 * Keeps generating while settlements can be reached.
 */
export async function generateAllInvoices(): Promise<{
  generated: GenerateInvoiceOutput[];
  skipped: number;
  billingSync: import('./billing-history-importer').ImportResult | null;
}> {
  // 注意：不再自動 pullBillingHistory()。呼叫端應先 sync 再 generate。
  const billingSync: import('./billing-history-importer').ImportResult | null = null;

  const enrollments = await prisma.enrollment.findMany({
    where: ACTIVE_STATUS_FILTER,
    select: { id: true, sheetsId: true },
  });

  const generated: GenerateInvoiceOutput[] = [];
  let skipped = 0;

  for (const e of enrollments) {
    // Keep generating invoices for this enrollment until it can't generate more
    let keepGoing = true;
    while (keepGoing) {
      const result = await generateInvoice({ enrollmentId: e.id, mode: 'normal' });
      if (result.success) {
        generated.push(result);
      } else {
        keepGoing = false;
        skipped++;
      }
    }
  }

  return { generated, skipped, billingSync };
}

/**
 * Generate PDFs for pending (unpaid) invoices that don't have one yet.
 * Skips paid invoices and historical invoices with empty records.
 */
export async function generatePdfsForPending(): Promise<{
  rendered: number;
  skippedNoRecords: number;
  failed: { invoiceId: number; serial: string; error: string }[];
}> {
  const invoices = await prisma.invoice.findMany({
    where: { pdfPath: null, status: 'pending' },
    select: { id: true, serialNumber: true, records: true },
    orderBy: { id: 'asc' },
  });

  const failed: { invoiceId: number; serial: string; error: string }[] = [];
  let rendered = 0;
  let skippedNoRecords = 0;

  for (const inv of invoices) {
    const recs = inv.records as unknown[];
    if (!recs || !Array.isArray(recs) || recs.length === 0) {
      skippedNoRecords++;
      continue;
    }
    const result = await renderInvoicePdf(inv.id);
    if (result.success) {
      rendered++;
    } else {
      failed.push({ invoiceId: inv.id, serial: inv.serialNumber, error: result.error || 'Unknown' });
    }
  }

  return { rendered, skippedNoRecords, failed };
}
