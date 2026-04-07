/**
 * multi-year-importer.ts — 多學年匯入協調層
 *
 * 依序匯入 106→113 學年的學生、出席、收費歷史資料。
 * 每學年執行：
 *   1. pullStudentsForYear → persons + enrollments
 *   2. pullAttendanceForYear → monthly_attendance
 *   3. pullBillingHistoryForYear → invoices + payments
 *
 * 使用方式：
 *   import { importAllHistoricalYears } from './multi-year-importer';
 *   await importAllHistoricalYears();           // 匯入 106~113
 *   await importAllHistoricalYears([108, 109]);  // 只匯入指定學年
 *   await importAllHistoricalYears(undefined, { dryRun: true }); // 模擬
 */
import { pullStudentsForYear, pullAttendanceForYear } from './sync-engine';
import { pullBillingHistoryForYear, type ImportResult } from './billing-history-importer';
import { getYearConfig, getAllAcademicYears, type YearConfig } from './year-config';

// ============================================================================
// Types
// ============================================================================

export interface YearImportResult {
  academicYear: number;
  students: { persons: number; enrollments: number };
  attendanceVectors: number;
  billing: ImportResult;
  errors: string[];
  durationMs: number;
}

export interface MultiYearImportResult {
  years: YearImportResult[];
  totalDurationMs: number;
  summary: {
    totalPersons: number;
    totalEnrollments: number;
    totalAttendance: number;
    totalInvoices: number;
    totalPayments: number;
    totalSkipped: number;
    totalWarnings: number;
    totalErrors: number;
  };
}

// ============================================================================
// Main
// ============================================================================

/**
 * 匯入多學年歷史資料
 *
 * @param academicYears - 要匯入的學年列表（預設 106~113）
 * @param options.dryRun - 模擬模式，不寫入 DB
 * @param options.skipStudents - 跳過學生同步（已同步過時使用）
 * @param options.skipAttendance - 跳過出席同步
 * @param options.skipBilling - 跳過收費匯入
 * @param options.onYearComplete - 每學年完成後的回調
 */
export async function importAllHistoricalYears(
  academicYears?: number[],
  options?: {
    dryRun?: boolean;
    skipStudents?: boolean;
    skipAttendance?: boolean;
    skipBilling?: boolean;
    onYearComplete?: (result: YearImportResult) => void;
  }
): Promise<MultiYearImportResult> {
  const years = academicYears ?? getAllAcademicYears().filter(y => y < 114); // 106~113
  const sorted = [...years].sort((a, b) => a - b);
  const dryRun = options?.dryRun ?? false;

  const startTime = Date.now();
  const results: YearImportResult[] = [];

  console.log('');
  console.log('═'.repeat(80));
  console.log(`  多學年歷史資料匯入${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`  學年: ${sorted.join(', ')}`);
  console.log('═'.repeat(80));

  for (const year of sorted) {
    const config = getYearConfig(year);
    if (!config) {
      results.push({
        academicYear: year,
        students: { persons: 0, enrollments: 0 },
        attendanceVectors: 0,
        billing: emptyImportResult(),
        errors: [`No config for year ${year}`],
        durationMs: 0,
      });
      continue;
    }

    const yearStart = Date.now();
    const errors: string[] = [];
    let students = { persons: 0, enrollments: 0 };
    let vectors = 0;
    let billing = emptyImportResult();

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  📋 ${year} 學年 (${config.startCalendarYear}~${config.endCalendarYear})`);
    console.log(`${'─'.repeat(80)}`);

    // Step 1: Students
    if (!options?.skipStudents) {
      try {
        console.log(`  [1/3] 同步學生資料 (${config.studentSheetName})...`);
        students = await pullStudentsForYear(config);
        console.log(`        → +${students.persons} persons, +${students.enrollments} enrollments`);
      } catch (e: any) {
        const msg = `Students: ${e.message || e}`;
        errors.push(msg);
        console.log(`        ❌ ${msg}`);
      }
    } else {
      console.log('  [1/3] 學生同步：已跳過');
    }

    // Step 2: Attendance
    if (!options?.skipAttendance) {
      try {
        console.log(`  [2/3] 同步出席紀錄...`);
        vectors = await pullAttendanceForYear(config);
        console.log(`        → ${vectors} attendance vectors`);
      } catch (e: any) {
        const msg = `Attendance: ${e.message || e}`;
        errors.push(msg);
        console.log(`        ❌ ${msg}`);
      }
    } else {
      console.log('  [2/3] 出席同步：已跳過');
    }

    // Step 3: Billing history
    if (!options?.skipBilling) {
      try {
        console.log(`  [3/3] 匯入收費歷史...`);
        billing = await pullBillingHistoryForYear(config, { dryRun });
        console.log(`        → +${billing.invoicesCreated} invoices, +${billing.paymentsCreated} payments, ${billing.skipped} skipped`);
        if (billing.warnings.length > 0) {
          console.log(`        ⚠️ ${billing.warnings.length} 筆金額不符警告`);
        }
        if (billing.noAttendance > 0) {
          console.log(`        ⚠️ ${billing.noAttendance} 筆無出席資料`);
        }
        errors.push(...billing.errors);
      } catch (e: any) {
        const msg = `Billing: ${e.message || e}`;
        errors.push(msg);
        console.log(`        ❌ ${msg}`);
      }
    } else {
      console.log('  [3/3] 收費匯入：已跳過');
    }

    const yearResult: YearImportResult = {
      academicYear: year,
      students,
      attendanceVectors: vectors,
      billing,
      errors,
      durationMs: Date.now() - yearStart,
    };
    results.push(yearResult);
    options?.onYearComplete?.(yearResult);
  }

  const totalDurationMs = Date.now() - startTime;

  // Summary
  const summary = {
    totalPersons: results.reduce((s, r) => s + r.students.persons, 0),
    totalEnrollments: results.reduce((s, r) => s + r.students.enrollments, 0),
    totalAttendance: results.reduce((s, r) => s + r.attendanceVectors, 0),
    totalInvoices: results.reduce((s, r) => s + r.billing.invoicesCreated, 0),
    totalPayments: results.reduce((s, r) => s + r.billing.paymentsCreated, 0),
    totalSkipped: results.reduce((s, r) => s + r.billing.skipped, 0),
    totalWarnings: results.reduce((s, r) => s + r.billing.warnings.length, 0),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
  };

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  匯入完成摘要');
  console.log(`${'═'.repeat(80)}`);
  console.log(`  學年:        ${sorted.join(', ')}`);
  console.log(`  新增 persons:     ${summary.totalPersons}`);
  console.log(`  新增 enrollments: ${summary.totalEnrollments}`);
  console.log(`  出席 vectors:     ${summary.totalAttendance}`);
  console.log(`  新增 invoices:    ${summary.totalInvoices}`);
  console.log(`  新增 payments:    ${summary.totalPayments}`);
  console.log(`  跳過:             ${summary.totalSkipped}`);
  console.log(`  金額警告:         ${summary.totalWarnings}`);
  console.log(`  錯誤:             ${summary.totalErrors}`);
  console.log(`  耗時:             ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log('');

  return { years: results, totalDurationMs, summary };
}

function emptyImportResult(): ImportResult {
  return {
    invoicesCreated: 0,
    paymentsCreated: 0,
    skipped: 0,
    noAttendance: 0,
    warnings: [],
    errors: [],
  };
}
