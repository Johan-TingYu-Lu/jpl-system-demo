/**
 * audit-engine.ts — 交互檢核引擎
 *
 * Phase 1：DB ↔ Sheets 同步性確認
 *   - 收費張數比對
 *   - FLAG（最後 endDate）比對
 *   - 收費金額比對
 *
 * Phase 2：DB 內部四項交互檢核
 *   ① floor(totalY ÷ settlementY) = invoiceCount
 *   ② invoiceCount × planAmount = totalRevenue
 *   ③ 0 ≤ unbilledY < settlementY
 *   ④ 三角驗算：totalRevenue = floor(totalY ÷ settlementY) × planAmount
 */
import prisma from './prisma';
import { readBillingHistory, type StudentBillingData } from './sheets-billing-reader';
import { formatDate, formatDateUTC } from './attendance-utils';
import { countTotalY } from './attendance-utils';
import { resolveRateConfig } from './rate-resolver';
import { ACTIVE_STATUS_FILTER } from './enrollment-status';

// ============================================================================
// Types
// ============================================================================

export interface SyncCheckResult {
  sheetsId: string;
  name: string;
  classCode: string;
  // 張數
  sheetCount: number;
  dbCount: number;
  countMatch: boolean;
  // FLAG（最後 endDate）
  sheetLastEnd: string | null;
  dbLastEnd: string | null;
  flagMatch: boolean;
  // 金額
  sheetTotalAmount: number;
  dbTotalAmount: number;
  amountMatch: boolean;
}

export interface InternalCheckResult {
  sheetsId: string;
  name: string;
  classCode: string;
  planName: string;
  settlementY: number;
  planAmount: number;
  // 原始數據
  totalY: number;
  invoiceCount: number;
  totalRevenue: number;
  // ① 上課次數 → 收費單張數
  expectedCount: number;
  check1Pass: boolean;
  // ② 收費單張數 → 收入金額
  expectedRevenue: number;
  check2Pass: boolean;
  // ③ 未結算餘額
  unbilledY: number;
  check3Pass: boolean;
  // ④ 三角驗算
  triangleRevenue: number;
  check4Pass: boolean;
}

export interface AuditResult {
  // Phase 1
  syncChecks: SyncCheckResult[];
  syncSummary: {
    total: number;
    countMismatch: number;
    flagMismatch: number;
    amountMismatch: number;
    allPass: boolean;
  };
  // Phase 2
  internalChecks: InternalCheckResult[];
  internalSummary: {
    total: number;
    check1Fail: number;
    check2Fail: number;
    check3Fail: number;
    check4Fail: number;
    allPass: boolean;
  };
}

// ============================================================================
// Phase 1: DB ↔ Sheets 同步性確認
// ============================================================================

async function runSyncChecks(): Promise<SyncCheckResult[]> {
  // 1. 從 Sheets 取得所有學生的收費資料
  console.log('📥 Phase 1: 讀取 Google Sheets 收費紀錄...');
  const sheetStudents = await readBillingHistory();
  console.log(`   Sheet 有 ${sheetStudents.length} 位學生`);

  // Build Sheet lookup: sheetsId → { count, lastEnd, totalAmount }
  const sheetMap = new Map<string, {
    count: number;
    lastEnd: string | null;
    totalAmount: number;
  }>();
  for (const s of sheetStudents) {
    const lastInv = s.invoices[s.invoices.length - 1];
    const lastEnd = lastInv ? formatDate(lastInv.endDate) : null;
    const totalAmount = s.invoices.reduce((sum, inv) => sum + (inv.sheetAmount ?? 0), 0);
    sheetMap.set(s.sheetsId, {
      count: s.invoiceCount,
      lastEnd,
      totalAmount,
    });
  }

  // 2. 從 DB 取得所有 active enrollment 的 invoice 統計
  const dbRows = await prisma.$queryRaw<{
    sheets_id: string;
    name: string;
    class_code: string;
    invoice_count: bigint;
    total_amount: bigint | null;
    last_end: Date | null;
  }[]>`
    SELECT e.sheets_id, p.name, e.class_code,
           COUNT(i.id) as invoice_count,
           SUM(i.amount) as total_amount,
           MAX(i.end_date) as last_end
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    LEFT JOIN invoices i ON i.enrollment_id = e.id
    WHERE e.status NOT IN ('永久停止', '結清')
    GROUP BY e.sheets_id, p.name, e.class_code
    ORDER BY e.sheets_id::int
  `;

  // 3. 比對
  const results: SyncCheckResult[] = [];
  for (const db of dbRows) {
    const sheet = sheetMap.get(db.sheets_id);
    if (!sheet) continue; // Sheet 無此學生的收費紀錄，跳過

    const dbCount = Number(db.invoice_count);
    const dbTotalAmount = Number(db.total_amount ?? 0);
    const dbLastEnd = db.last_end
      ? formatDateUTC(db.last_end)
      : null;

    const countMatch = sheet.count === dbCount;
    const flagMatch = sheet.lastEnd === dbLastEnd;
    const amountMatch = Math.abs(sheet.totalAmount - dbTotalAmount) <= 1;

    results.push({
      sheetsId: db.sheets_id,
      name: db.name,
      classCode: db.class_code,
      sheetCount: sheet.count,
      dbCount,
      countMatch,
      sheetLastEnd: sheet.lastEnd,
      dbLastEnd,
      flagMatch,
      sheetTotalAmount: sheet.totalAmount,
      dbTotalAmount,
      amountMatch,
    });
  }

  return results;
}

// ============================================================================
// Phase 2: DB 內部四項交互檢核
// ============================================================================

async function runInternalChecks(): Promise<InternalCheckResult[]> {
  console.log('\n📊 Phase 2: DB 內部交互檢核...');

  // 1. 取得所有 active enrollments
  const enrollments = await prisma.enrollment.findMany({
    where: ACTIVE_STATUS_FILTER,
    include: { person: { select: { name: true } } },
  });

  const results: InternalCheckResult[] = [];

  for (const e of enrollments) {
    // 解析費率
    const resolved = await resolveRateConfig(e);
    const settlementY = resolved.config.settlementSessions * 2;
    const planAmount = resolved.config.settlementSessions * resolved.config.fullSessionFee;

    // 取得 DB 出勤統計：totalY
    const attRows = await prisma.monthlyAttendance.findMany({
      where: { enrollmentId: e.id },
    });
    const totalY = countTotalY(attRows);

    // 取得 DB invoice 統計
    const invoiceAgg = await prisma.invoice.aggregate({
      where: { enrollmentId: e.id },
      _count: { id: true },
      _sum: { amount: true },
    });
    const invoiceCount = invoiceAgg._count.id;
    const totalRevenue = invoiceAgg._sum.amount ?? 0;

    // ① floor(totalY ÷ settlementY) = invoiceCount
    const expectedCount = Math.floor(totalY / settlementY);
    const check1Pass = expectedCount === invoiceCount;

    // ② invoiceCount × planAmount = totalRevenue
    const expectedRevenue = invoiceCount * planAmount;
    const check2Pass = Math.abs(expectedRevenue - totalRevenue) <= 1;

    // ③ 0 ≤ unbilledY < settlementY
    const unbilledY = totalY - (invoiceCount * settlementY);
    const check3Pass = unbilledY >= 0 && unbilledY < settlementY;

    // ④ 三角驗算
    const triangleRevenue = Math.floor(totalY / settlementY) * planAmount;
    const check4Pass = Math.abs(triangleRevenue - totalRevenue) <= 1;

    results.push({
      sheetsId: e.sheetsId,
      name: e.person.name,
      classCode: e.classCode,
      planName: resolved.planName,
      settlementY,
      planAmount,
      totalY,
      invoiceCount,
      totalRevenue,
      expectedCount,
      check1Pass,
      expectedRevenue,
      check2Pass,
      unbilledY,
      check3Pass,
      triangleRevenue,
      check4Pass,
    });
  }

  return results;
}

// ============================================================================
// Main: runAudit()
// ============================================================================

export async function runAudit(): Promise<AuditResult> {
  // Phase 1
  const syncChecks = await runSyncChecks();
  const countMismatch = syncChecks.filter(c => !c.countMatch).length;
  const flagMismatch = syncChecks.filter(c => !c.flagMatch).length;
  const amountMismatch = syncChecks.filter(c => !c.amountMatch).length;

  console.log(`\n=== Phase 1: DB ↔ Sheets 同步性 ===`);
  console.log(`比對學生數: ${syncChecks.length}`);
  console.log(`張數不一致: ${countMismatch}`);
  console.log(`FLAG不一致: ${flagMismatch}`);
  console.log(`金額不一致: ${amountMismatch}`);

  if (countMismatch + flagMismatch + amountMismatch > 0) {
    console.log('\n--- 不一致清單 ---');
    console.log('ID   | 姓名     | 項目   | Sheet        | DB');
    console.log('-----|----------|--------|--------------|-------------');
    for (const c of syncChecks) {
      if (!c.countMatch) {
        console.log(`${c.sheetsId.padEnd(4)} | ${c.name.padEnd(8)} | 張數   | ${String(c.sheetCount).padEnd(12)} | ${c.dbCount}`);
      }
      if (!c.flagMatch) {
        console.log(`${c.sheetsId.padEnd(4)} | ${c.name.padEnd(8)} | FLAG   | ${(c.sheetLastEnd ?? 'N/A').padEnd(12)} | ${c.dbLastEnd ?? 'N/A'}`);
      }
      if (!c.amountMatch) {
        console.log(`${c.sheetsId.padEnd(4)} | ${c.name.padEnd(8)} | 金額   | $${String(c.sheetTotalAmount).padEnd(11)} | $${c.dbTotalAmount}`);
      }
    }
  } else {
    console.log('✅ Phase 1 全部一致！');
  }

  // Phase 2
  const internalChecks = await runInternalChecks();
  const check1Fail = internalChecks.filter(c => !c.check1Pass).length;
  const check2Fail = internalChecks.filter(c => !c.check2Pass).length;
  const check3Fail = internalChecks.filter(c => !c.check3Pass).length;
  const check4Fail = internalChecks.filter(c => !c.check4Pass).length;

  console.log(`\n=== Phase 2: DB 內部交互檢核 ===`);
  console.log(`檢核學生數: ${internalChecks.length}`);
  console.log(`① 張數 vs Y值: ${check1Fail ? `❌ ${check1Fail} 人不一致` : '✅ 通過'}`);
  console.log(`② 金額 vs 張數: ${check2Fail ? `❌ ${check2Fail} 人不一致` : '✅ 通過'}`);
  console.log(`③ 未結算餘額:   ${check3Fail ? `❌ ${check3Fail} 人異常` : '✅ 通過'}`);
  console.log(`④ 三角驗算:     ${check4Fail ? `❌ ${check4Fail} 人不一致` : '✅ 通過'}`);

  const anyFail = internalChecks.filter(c => !c.check1Pass || !c.check2Pass || !c.check3Pass || !c.check4Pass);
  if (anyFail.length > 0) {
    console.log('\n--- 未通過清單 ---');
    console.log('ID   | 姓名     | 方案  | totalY | 張數(期望/實際) | 收入(期望/實際)   | 餘額Y | 失敗項');
    console.log('-----|----------|-------|--------|----------------|-----------------|-------|------');
    for (const c of anyFail) {
      const fails: string[] = [];
      if (!c.check1Pass) fails.push('①');
      if (!c.check2Pass) fails.push('②');
      if (!c.check3Pass) fails.push('③');
      if (!c.check4Pass) fails.push('④');
      console.log(
        `${c.sheetsId.padEnd(4)} | ${c.name.padEnd(8)} | ${c.planName.padEnd(5)} | ` +
        `${String(c.totalY).padEnd(6)} | ${c.expectedCount}/${c.invoiceCount}`.padEnd(16) +
        ` | $${c.expectedRevenue}/$${c.totalRevenue}`.padEnd(17) +
        ` | ${String(c.unbilledY).padEnd(5)} | ${fails.join(',')}`
      );
    }
  } else {
    console.log('✅ Phase 2 全部通過！');
  }

  return {
    syncChecks,
    syncSummary: {
      total: syncChecks.length,
      countMismatch,
      flagMismatch,
      amountMismatch,
      allPass: countMismatch + flagMismatch + amountMismatch === 0,
    },
    internalChecks,
    internalSummary: {
      total: internalChecks.length,
      check1Fail,
      check2Fail,
      check3Fail,
      check4Fail,
      allPass: check1Fail + check2Fail + check3Fail + check4Fail === 0,
    },
  };
}
