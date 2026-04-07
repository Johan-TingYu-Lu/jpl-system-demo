/**
 * billing-history-importer.ts — 歷史收費紀錄匯入器
 *
 * 從 Google Sheets 讀取 計費日期表 + 繳費金額表 + 繳費日期表，
 * 結合 DB 中的 monthly_attendance 向量，寫入 invoices + payments 表。
 *
 * 金額以 Sheet 為準（歷史 truth），同時用 billing-engine 計算交叉驗證。
 */
import prisma from './prisma';
import { calculateBilling, type AttendanceEntry, type RateConfig } from './billing-engine';
import { resolveRateConfig } from './rate-resolver';
import { readBillingHistory, readBillingHistoryForYear, type StudentBillingData } from './sheets-billing-reader';
import { extractBillableDatesInRange, formatDate } from './attendance-utils';
import { createAuditLog } from './audit';
import { makeSerial as _makeSerial114, makeHistoricalSerial, makeHash } from './serial-utils';
import { isExcluded } from './enrollment-status';
import { type YearConfig, getYearConfig } from './year-config';

// ============================================================================
// Types
// ============================================================================

export interface ImportWarning {
  sheetsId: string;
  name: string;
  invoiceIndex: number;
  sheetAmount: number;
  calculatedAmount: number;
  difference: number;
}

export interface ImportResult {
  invoicesCreated: number;
  paymentsCreated: number;
  skipped: number;
  noAttendance: number;
  warnings: ImportWarning[];
  errors: string[];
}

// ============================================================================
// Helpers
// ============================================================================

const YEAR_CODE = '26';

function makeSerial114(sheetsId: string, monthStr: string, classCode: string, seq: number): string {
  return _makeSerial114(YEAR_CODE, sheetsId, parseInt(monthStr), classCode, seq);
}

/**
 * 取得指定 enrollment 在日期區間內的可計費出席紀錄
 * v2: 核心遍歷邏輯移至 attendance-utils.extractBillableDatesInRange
 */
async function getAttendanceBetween(
  enrollmentId: number,
  startDate: Date,
  endDate: Date
): Promise<AttendanceEntry[]> {
  // serialToDate() returns UTC noon — safe to use local getters
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;

  // Build month conditions
  const conditions: { year: number; month: number }[] = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    conditions.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const months = await prisma.monthlyAttendance.findMany({
    where: { enrollmentId, OR: conditions },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const billable = extractBillableDatesInRange(months, startDate, endDate);
  return billable.map(b => ({ date: b.dateStr, status: b.code }));
}

// ============================================================================
// Main importer
// ============================================================================

export async function pullBillingHistory(options?: {
  dryRun?: boolean;
  sheetsIds?: string[];
}): Promise<ImportResult> {
  const dryRun = options?.dryRun ?? false;
  const filterIds = options?.sheetsIds ? new Set(options.sheetsIds) : null;

  const result: ImportResult = {
    invoicesCreated: 0,
    paymentsCreated: 0,
    skipped: 0,
    noAttendance: 0,
    warnings: [],
    errors: [],
  };

  // 1. Read all billing data from Sheets
  console.log('📥 讀取 Google Sheets 收費紀錄...');
  const allStudents = await readBillingHistory();
  console.log(`   找到 ${allStudents.length} 位學生的收費紀錄`);

  // 2. Filter if needed
  const students = filterIds
    ? allStudents.filter(s => filterIds.has(s.sheetsId))
    : allStudents;

  // 3. Process each student
  for (const student of students) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: student.sheetsId },
      include: { person: { select: { name: true } } },
    });

    if (!enrollment) {
      result.errors.push(`${student.sheetsId} ${student.name}: enrollment not found in DB`);
      continue;
    }

    if (isExcluded(enrollment.status)) {
      console.log(`  ⏭️ ${student.sheetsId} ${student.name}: ${enrollment.status}，跳過`);
      result.skipped++;
      continue;
    }

    // Resolve rate config for this student
    const resolved = await resolveRateConfig(enrollment, {
      prepThreshold: student.prepThreshold,
      feeThreshold: student.feeThreshold,
    });

    const classCode = enrollment.classCode;
    const subject = enrollment.subject;
    const logPrefix = `  ${student.sheetsId} ${enrollment.person.name} (${classCode}/${resolved.planName})`;

    console.log(`\n${logPrefix} — ${student.invoiceCount} 張`);

    for (const inv of student.invoices) {
      const i = inv.invoiceIndex;
      const dateRange = `${formatDate(inv.startDate)}~${formatDate(inv.endDate)}`;

      // Get attendance in range
      const attendance = await getAttendanceBetween(enrollment.id, inv.startDate, inv.endDate);

      // Calculate using billing engine (for JSONB records + validation)
      let billing = null;
      if (attendance.length > 0) {
        billing = calculateBilling(attendance, resolved.config, 'force');
      } else {
        result.noAttendance++;
        console.log(`    ⚠️ 第 ${i + 1} 張 ${dateRange} 無出席資料`);
      }

      // Determine amount (Sheet is truth)
      const amount = inv.sheetAmount ?? billing?.totalFee ?? 0;

      // Bug fix: 跳過金額為 0 的收費單
      if (amount <= 0) {
        console.log(`    ⏭️ 第 ${i + 1} 張 ${dateRange} 金額為 $${amount}，跳過`);
        result.skipped++;
        continue;
      }

      // Cross-validate
      if (billing && inv.sheetAmount != null && Math.abs(inv.sheetAmount - billing.totalFee) > 1) {
        result.warnings.push({
          sheetsId: student.sheetsId,
          name: enrollment.person.name,
          invoiceIndex: i,
          sheetAmount: inv.sheetAmount,
          calculatedAmount: billing.totalFee,
          difference: inv.sheetAmount - billing.totalFee,
        });
        console.log(`    ⚠️ 第 ${i + 1} 張金額不符: Sheet=$${inv.sheetAmount} vs 計算=$${billing.totalFee} (差 $${inv.sheetAmount - billing.totalFee})`);
      }

      // Generate serial and hash
      const month = String(inv.startDate.getMonth() + 1).padStart(2, '0');
      const serial = makeSerial114(student.sheetsId, month, classCode, i + 1);
      const hash = makeHash(serial, student.sheetsId, amount, subject);

      // Check for existing (by serial number)
      const existing = await prisma.invoice.findUnique({ where: { serialNumber: serial } });
      if (existing) {
        result.skipped++;
        console.log(`    ✓ 第 ${i + 1} 張已存在（serial），跳過`);
        continue;
      }

      // Bug fix: 日期區間重疊去重 — 避免同 enrollment 在重疊區間重複建單
      const overlapping = await prisma.invoice.findFirst({
        where: {
          enrollmentId: enrollment.id,
          startDate: { lte: inv.endDate },
          endDate: { gte: inv.startDate },
        },
      });
      if (overlapping) {
        result.skipped++;
        console.log(`    ✓ 第 ${i + 1} 張與 ${overlapping.serialNumber} 日期重疊，跳過`);
        continue;
      }

      if (dryRun) {
        console.log(`    [DRY] ${serial} | ${dateRange} | $${amount} | ${attendance.length} 日 | ${billing ? `${billing.totalY}Y` : 'N/A'}`);
        result.invoicesCreated++;
        if (inv.paymentDate) result.paymentsCreated++;
        continue;
      }

      // Create invoice
      const invoice = await prisma.invoice.create({
        data: {
          serialNumber: serial,
          hashCode: hash,
          enrollmentId: enrollment.id,
          startDate: inv.startDate,
          endDate: inv.endDate,
          amount,
          yyCount: billing?.yyCount ?? 0,
          yCount: billing?.yCount ?? 0,
          totalY: billing?.totalY ?? 0,
          records: billing ? (billing.records as unknown as object) : [],
          note: billing?.splitNote ?? null,
          status: inv.paymentDate ? 'paid' : 'pending',
        },
      });

      result.invoicesCreated++;

      // Create payment if paid
      if (inv.paymentDate) {
        await prisma.payment.create({
          data: {
            enrollmentId: enrollment.id,
            invoiceId: invoice.id,
            amount,
            paymentDate: inv.paymentDate,
            method: 'historical_import',
          },
        });
        result.paymentsCreated++;
      }

      // Audit log
      await createAuditLog({
        tableName: 'invoices',
        recordId: invoice.id,
        action: 'CREATE',
        afterData: { serialNumber: serial, amount, source: 'sheets_import' },
        changedBy: 'system',
        reason: 'Historical import from Google Sheets',
      });

      const payStatus = inv.paymentDate ? '✅ 已繳' : '⏳ 待繳';
      console.log(`    ${payStatus} ${serial} | ${dateRange} | $${amount} | ${attendance.length} 日`);
    }
  }

  return result;
}

// ============================================================================
// 繳費狀態同步（Sheets → DB）— 精確配對
// ============================================================================

export interface SyncPaymentResult {
  updated: number;
  alreadyPaid: number;
  noMatch: number;
  errors: string[];
}

/**
 * 從 Sheets 繳費日期表讀取繳費狀態，精確配對 DB invoice，
 * 將 pending → paid。
 *
 * 配對方式：enrollment.sheetsId + startDate + endDate（不用位置）
 * 只更新 pending → paid，不動 draft 或已 paid 的。
 */
export async function syncPaymentStatus(options?: {
  sheetsIds?: string[];
}): Promise<SyncPaymentResult> {
  const filterIds = options?.sheetsIds ? new Set(options.sheetsIds) : null;

  const result: SyncPaymentResult = {
    updated: 0,
    alreadyPaid: 0,
    noMatch: 0,
    errors: [],
  };

  // 1. 讀 Sheets 114 學年收費紀錄
  console.log('📥 syncPaymentStatus: 讀取 Sheets 繳費紀錄...');
  const allStudents = await readBillingHistory();

  const students = filterIds
    ? allStudents.filter(s => filterIds.has(s.sheetsId))
    : allStudents;

  for (const student of students) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: student.sheetsId },
      include: { person: { select: { name: true } } },
    });
    if (!enrollment) continue;
    if (isExcluded(enrollment.status)) continue;

    for (const inv of student.invoices) {
      // 只處理 Sheets 有繳費日期的
      if (!inv.paymentDate) continue;

      // 精確配對：用 startDate + endDate
      const dbInvoice = await prisma.invoice.findFirst({
        where: {
          enrollmentId: enrollment.id,
          startDate: inv.startDate,
          endDate: inv.endDate,
        },
      });

      if (!dbInvoice) {
        result.noMatch++;
        result.errors.push(
          `${student.sheetsId} ${enrollment.person.name}: Sheets 有 ${formatDate(inv.startDate)}~${formatDate(inv.endDate)} 但 DB 找不到匹配的 invoice`
        );
        continue;
      }

      // 已經 paid 就跳過
      if (dbInvoice.status === 'paid') {
        result.alreadyPaid++;
        continue;
      }

      // 只允許 pending → paid
      if (dbInvoice.status !== 'pending') {
        result.errors.push(
          `${student.sheetsId} ${enrollment.person.name}: ${dbInvoice.serialNumber} 狀態是 ${dbInvoice.status}，不是 pending，跳過`
        );
        continue;
      }

      // 更新 pending → paid
      await prisma.invoice.update({
        where: { id: dbInvoice.id },
        data: { status: 'paid', paidDate: inv.paymentDate },
      });

      // 建 payment 紀錄（如果還沒有）
      const existingPayment = await prisma.payment.findFirst({
        where: { invoiceId: dbInvoice.id },
      });
      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            enrollmentId: enrollment.id,
            invoiceId: dbInvoice.id,
            amount: dbInvoice.amount,
            paymentDate: inv.paymentDate,
            method: 'sheet_sync',
          },
        });
      }

      await createAuditLog({
        tableName: 'invoices',
        recordId: dbInvoice.id,
        action: 'UPDATE',
        beforeData: { status: 'pending' },
        afterData: { status: 'paid', method: 'sheet_sync', paymentDate: inv.paymentDate },
        changedBy: 'system',
        reason: `syncPaymentStatus: Sheets 繳費日期表已繳`,
      });

      result.updated++;
      console.log(`  ✅ ${student.sheetsId} ${enrollment.person.name} | ${dbInvoice.serialNumber} → paid`);
    }
  }

  console.log(`\nsyncPaymentStatus 完成: ${result.updated} 更新, ${result.alreadyPaid} 已paid, ${result.noMatch} 無匹配, ${result.errors.length} 錯誤`);
  return result;
}

// ============================================================================
// 多學年匯入
// ============================================================================

/**
 * 匯入指定學年的收費歷史
 * 使用學年專屬格式設定讀取 Sheets，用歷史流水號格式
 */
export async function pullBillingHistoryForYear(
  config: YearConfig,
  options?: { dryRun?: boolean; sheetsIds?: string[] }
): Promise<ImportResult> {
  const dryRun = options?.dryRun ?? false;
  const filterIds = options?.sheetsIds ? new Set(options.sheetsIds) : null;

  const result: ImportResult = {
    invoicesCreated: 0,
    paymentsCreated: 0,
    skipped: 0,
    noAttendance: 0,
    warnings: [],
    errors: [],
  };

  console.log(`📥 讀取 ${config.academicYear} 學年 Google Sheets 收費紀錄...`);
  let allStudents: StudentBillingData[];
  try {
    allStudents = await readBillingHistoryForYear(config);
  } catch (e: any) {
    result.errors.push(`Failed to read sheets for year ${config.academicYear}: ${e.message}`);
    return result;
  }
  console.log(`   找到 ${allStudents.length} 位學生的收費紀錄`);

  const students = filterIds
    ? allStudents.filter(s => filterIds.has(s.sheetsId))
    : allStudents;

  for (const student of students) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: student.sheetsId },
      include: { person: { select: { name: true } } },
    });

    if (!enrollment) {
      result.errors.push(`${student.sheetsId} ${student.name}: enrollment not found in DB`);
      continue;
    }

    if (isExcluded(enrollment.status)) {
      result.skipped++;
      continue;
    }

    const resolved = await resolveRateConfig(enrollment, {
      prepThreshold: student.prepThreshold,
      feeThreshold: student.feeThreshold,
    });

    const classCode = enrollment.classCode;
    const subject = enrollment.subject;

    for (const inv of student.invoices) {
      const i = inv.invoiceIndex;
      const dateRange = `${formatDate(inv.startDate)}~${formatDate(inv.endDate)}`;

      const attendance = await getAttendanceBetween(enrollment.id, inv.startDate, inv.endDate);

      let billing = null;
      if (attendance.length > 0) {
        billing = calculateBilling(attendance, resolved.config, 'force');
      } else {
        result.noAttendance++;
      }

      const amount = inv.sheetAmount ?? billing?.totalFee ?? 0;
      if (amount <= 0) {
        result.skipped++;
        continue;
      }

      // Cross-validate
      if (billing && inv.sheetAmount != null && Math.abs(inv.sheetAmount - billing.totalFee) > 1) {
        result.warnings.push({
          sheetsId: student.sheetsId,
          name: enrollment.person.name,
          invoiceIndex: i,
          sheetAmount: inv.sheetAmount,
          calculatedAmount: billing.totalFee,
          difference: inv.sheetAmount - billing.totalFee,
        });
      }

      // 用歷史流水號格式
      const serial = makeHistoricalSerial(config.academicYear, student.sheetsId, classCode, i + 1);
      const hash = makeHash(serial, student.sheetsId, amount, subject);

      // Check for existing
      const existing = await prisma.invoice.findUnique({ where: { serialNumber: serial } });
      if (existing) {
        result.skipped++;
        continue;
      }

      // 日期區間重疊去重
      const overlapping = await prisma.invoice.findFirst({
        where: {
          enrollmentId: enrollment.id,
          startDate: { lte: inv.endDate },
          endDate: { gte: inv.startDate },
        },
      });
      if (overlapping) {
        result.skipped++;
        continue;
      }

      if (dryRun) {
        result.invoicesCreated++;
        if (inv.paymentDate) result.paymentsCreated++;
        continue;
      }

      const invoice = await prisma.invoice.create({
        data: {
          serialNumber: serial,
          hashCode: hash,
          enrollmentId: enrollment.id,
          startDate: inv.startDate,
          endDate: inv.endDate,
          amount,
          yyCount: billing?.yyCount ?? 0,
          yCount: billing?.yCount ?? 0,
          totalY: billing?.totalY ?? 0,
          records: billing ? (billing.records as unknown as object) : [],
          note: billing?.splitNote ?? null,
          status: inv.paymentDate ? 'paid' : 'pending',
        },
      });

      result.invoicesCreated++;

      if (inv.paymentDate) {
        await prisma.payment.create({
          data: {
            enrollmentId: enrollment.id,
            invoiceId: invoice.id,
            amount,
            paymentDate: inv.paymentDate,
            method: 'historical_import',
          },
        });
        result.paymentsCreated++;
      }

      await createAuditLog({
        tableName: 'invoices',
        recordId: invoice.id,
        action: 'CREATE',
        afterData: { serialNumber: serial, amount, source: `sheets_import_${config.academicYear}` },
        changedBy: 'system',
        reason: `Historical import from ${config.academicYear} 學年 Google Sheets`,
      });
    }
  }

  return result;
}
