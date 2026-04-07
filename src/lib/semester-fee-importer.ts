/**
 * semester-fee-importer.ts — 書籍雜費匯入器
 *
 * 從 Google Sheets「學費收支總表」讀取雜費欄位（col X~AA），
 * 寫入 semester_fees 表。
 *
 * 欄位對應（111~114 學年）：
 *   col 23 = 上學期雜費金額
 *   col 24 = 上學期雜費日期（Excel serial）
 *   col 25 = 下學期雜費金額
 *   col 26 = 下學期雜費日期（Excel serial）
 *
 * 106~110 學年無雜費欄位，跳過。
 */
import prisma from './prisma';
import { readSheet } from './sheets';
import { serialToDate } from './sheets-billing-reader';
import { createAuditLog } from './audit';
import { type YearConfig, YEAR_CONFIGS, getYearConfig } from './year-config';

// ============================================================================
// Types
// ============================================================================

export interface SemesterFeeImportResult {
  created: number;
  skipped: number;
  noEnrollment: number;
  errors: string[];
  details: {
    academicYear: number;
    created: number;
    skipped: number;
  }[];
}

interface RawMiscFeeRow {
  sheetsId: string;
  upperAmount: number | null;
  upperDate: Date | null;
  lowerAmount: number | null;
  lowerDate: Date | null;
}

// ============================================================================
// Reader: 從學費收支總表讀取雜費欄位
// ============================================================================

async function readMiscFeesForYear(config: YearConfig): Promise<RawMiscFeeRow[]> {
  if (!config.miscFee) return [];

  const rows = await readSheet("'學費收支總表'!A:AB", config.spreadsheetId);
  const fmt = config.miscFee;
  const results: RawMiscFeeRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const sheetsId = String(row[0] || '').trim();
    if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

    const upperAmt = typeof row[fmt.upperAmountCol] === 'number' ? row[fmt.upperAmountCol] as number : null;
    const upperDt = typeof row[fmt.upperDateCol] === 'number' && (row[fmt.upperDateCol] as number) > 0
      ? serialToDate(row[fmt.upperDateCol] as number) : null;
    const lowerAmt = typeof row[fmt.lowerAmountCol] === 'number' ? row[fmt.lowerAmountCol] as number : null;
    const lowerDt = typeof row[fmt.lowerDateCol] === 'number' && (row[fmt.lowerDateCol] as number) > 0
      ? serialToDate(row[fmt.lowerDateCol] as number) : null;

    // 至少有一個學期有金額才加入
    if (upperAmt || lowerAmt) {
      results.push({
        sheetsId,
        upperAmount: upperAmt && upperAmt > 0 ? upperAmt : null,
        upperDate: upperDt,
        lowerAmount: lowerAmt && lowerAmt > 0 ? lowerAmt : null,
        lowerDate: lowerDt,
      });
    }
  }

  return results;
}

// ============================================================================
// Importer
// ============================================================================

/**
 * 匯入指定學年的書籍雜費
 */
export async function importSemesterFeesForYear(
  config: YearConfig,
  options?: { dryRun?: boolean }
): Promise<{ created: number; skipped: number; noEnrollment: number; errors: string[] }> {
  const dryRun = options?.dryRun ?? false;
  let created = 0, skipped = 0, noEnrollment = 0;
  const errors: string[] = [];

  if (!config.miscFee) {
    console.log(`  ${config.academicYear}: 無雜費欄位，跳過`);
    return { created, skipped, noEnrollment, errors };
  }

  const rows = await readMiscFeesForYear(config);
  console.log(`  ${config.academicYear}: 找到 ${rows.length} 位有雜費紀錄的學生`);

  for (const row of rows) {
    // Find enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: row.sheetsId },
      select: { id: true, personId: true },
    });

    if (!enrollment) {
      noEnrollment++;
      continue;
    }

    // Process upper semester (上學期, semester=1)
    if (row.upperAmount != null) {
      const existing = await prisma.semesterFee.findUnique({
        where: {
          enrollmentId_academicYear_semester: {
            enrollmentId: enrollment.id,
            academicYear: config.academicYear,
            semester: 1,
          },
        },
      });

      if (existing) {
        skipped++;
      } else if (dryRun) {
        console.log(`    [DRY] ${row.sheetsId} 上學期 $${row.upperAmount} ${row.upperDate ? row.upperDate.toISOString().slice(0, 10) : 'no date'}`);
        created++;
      } else {
        const record = await prisma.semesterFee.create({
          data: {
            enrollmentId: enrollment.id,
            academicYear: config.academicYear,
            semester: 1,
            amount: row.upperAmount,
            feeDate: row.upperDate,
            status: row.upperDate ? 'paid' : 'pending',
          },
        });
        await createAuditLog({
          tableName: 'semester_fees',
          recordId: record.id,
          action: 'CREATE',
          afterData: { enrollmentId: enrollment.id, academicYear: config.academicYear, semester: 1, amount: row.upperAmount },
          changedBy: 'system',
          reason: `Historical import from ${config.academicYear} 學年 學費收支總表`,
        });
        created++;
      }
    }

    // Process lower semester (下學期, semester=2)
    if (row.lowerAmount != null) {
      const existing = await prisma.semesterFee.findUnique({
        where: {
          enrollmentId_academicYear_semester: {
            enrollmentId: enrollment.id,
            academicYear: config.academicYear,
            semester: 2,
          },
        },
      });

      if (existing) {
        skipped++;
      } else if (dryRun) {
        console.log(`    [DRY] ${row.sheetsId} 下學期 $${row.lowerAmount} ${row.lowerDate ? row.lowerDate.toISOString().slice(0, 10) : 'no date'}`);
        created++;
      } else {
        const record = await prisma.semesterFee.create({
          data: {
            enrollmentId: enrollment.id,
            academicYear: config.academicYear,
            semester: 2,
            amount: row.lowerAmount,
            feeDate: row.lowerDate,
            status: row.lowerDate ? 'paid' : 'pending',
          },
        });
        await createAuditLog({
          tableName: 'semester_fees',
          recordId: record.id,
          action: 'CREATE',
          afterData: { enrollmentId: enrollment.id, academicYear: config.academicYear, semester: 2, amount: row.lowerAmount },
          changedBy: 'system',
          reason: `Historical import from ${config.academicYear} 學年 學費收支總表`,
        });
        created++;
      }
    }
  }

  return { created, skipped, noEnrollment, errors };
}

/**
 * 匯入所有有雜費資料的學年（111~114）
 */
export async function importAllSemesterFees(
  options?: { dryRun?: boolean; years?: number[] }
): Promise<SemesterFeeImportResult> {
  const dryRun = options?.dryRun ?? false;
  const targetYears = options?.years ?? [111, 112, 113, 114];

  const result: SemesterFeeImportResult = {
    created: 0,
    skipped: 0,
    noEnrollment: 0,
    errors: [],
    details: [],
  };

  for (const year of targetYears) {
    const config = getYearConfig(year);
    if (!config) {
      result.errors.push(`Config for year ${year} not found`);
      continue;
    }

    console.log(`\n📥 匯入 ${year} 學年書籍雜費...`);
    const yearResult = await importSemesterFeesForYear(config, { dryRun });

    result.created += yearResult.created;
    result.skipped += yearResult.skipped;
    result.noEnrollment += yearResult.noEnrollment;
    result.errors.push(...yearResult.errors);
    result.details.push({
      academicYear: year,
      created: yearResult.created,
      skipped: yearResult.skipped,
    });

    console.log(`  ✅ ${year}: 新增 ${yearResult.created}, 跳過 ${yearResult.skipped}, 無 enrollment ${yearResult.noEnrollment}`);
  }

  return result;
}
