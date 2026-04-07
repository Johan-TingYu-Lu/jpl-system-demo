/**
 * check-all-dates.ts — 比對所有學生的 DB invoice 日期 vs Sheets 日期
 * 找出 off-by-one 或其他日期不匹配
 */
import 'dotenv/config';
import { createSheetsApi } from '../src/lib/script-init.js';
import { readBillingHistoryForYear } from '../src/lib/sheets-billing-reader.js';
import { getYearConfig, getAllAcademicYears } from '../src/lib/year-config.js';
import pg from 'pg';

async function main() {
  await createSheetsApi();

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 取得所有 DB invoices，按 sheetsId 分組
  const { rows: dbInvoices } = await client.query(`
    SELECT e.sheets_id, i.start_date, i.end_date, i.amount, i.serial_number, i.status,
           p.name, e.class_name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    ORDER BY e.sheets_id::int, i.start_date
  `);

  const dbMap = new Map<string, typeof dbInvoices>();
  for (const inv of dbInvoices) {
    if (!dbMap.has(inv.sheets_id)) dbMap.set(inv.sheets_id, []);
    dbMap.get(inv.sheets_id)!.push(inv);
  }

  // 讀取所有學年 Sheets
  const allSheetsMap = new Map<string, { startDate: Date; endDate: Date; amount: number | null; year: number }[]>();

  for (const year of getAllAcademicYears()) {
    const config = getYearConfig(year);
    if (!config) continue;
    console.error(`讀取 ${year} 學年 Sheets...`);
    try {
      const data = await readBillingHistoryForYear(config);
      for (const s of data) {
        if (!allSheetsMap.has(s.sheetsId)) allSheetsMap.set(s.sheetsId, []);
        for (const inv of s.invoices) {
          allSheetsMap.get(s.sheetsId)!.push({
            startDate: inv.startDate,
            endDate: inv.endDate,
            amount: inv.sheetAmount,
            year,
          });
        }
      }
    } catch (e: any) {
      console.error(`  ${year} 學年讀取失敗: ${e.message}`);
    }
  }

  // 比對
  let totalStudents = 0;
  let studentsWithMismatch = 0;
  let totalInvoices = 0;
  let offByOneCount = 0;
  let otherMismatchCount = 0;
  let dbOnlyCount = 0;
  let sheetsOnlyCount = 0;
  const mismatchDetails: string[] = [];

  for (const [sheetsId, dbInvs] of dbMap) {
    const sheetsInvs = allSheetsMap.get(sheetsId) || [];
    totalStudents++;

    // 按日期排序
    const dbSorted = [...dbInvs].sort((a, b) => a.start_date.getTime() - b.start_date.getTime());
    const shSorted = [...sheetsInvs].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    let hasMismatch = false;

    // 嘗試匹配：對每個 DB invoice 找最近的 Sheets invoice
    for (const db of dbSorted) {
      totalInvoices++;
      const dbSd = db.start_date.toISOString().slice(0, 10);
      const dbEd = db.end_date.toISOString().slice(0, 10);

      // 找完全匹配
      let matched = shSorted.find(sh => {
        const shSd = sh.startDate.toISOString().slice(0, 10);
        const shEd = sh.endDate.toISOString().slice(0, 10);
        return shSd === dbSd && shEd === dbEd;
      });

      if (matched) continue; // 完全匹配，OK

      // 找 off-by-one 匹配（DB 早 1 天）
      const dbSdPlus1 = new Date(db.start_date.getTime() + 86400000).toISOString().slice(0, 10);
      const dbEdPlus1 = new Date(db.end_date.getTime() + 86400000).toISOString().slice(0, 10);

      let offByOne = shSorted.find(sh => {
        const shSd = sh.startDate.toISOString().slice(0, 10);
        const shEd = sh.endDate.toISOString().slice(0, 10);
        return shSd === dbSdPlus1 && shEd === dbEdPlus1;
      });

      if (offByOne) {
        offByOneCount++;
        hasMismatch = true;
        continue;
      }

      // 找其他偏移
      let closest = shSorted.reduce<{ sh: typeof shSorted[0]; diffStart: number; diffEnd: number } | null>((best, sh) => {
        const diffStart = Math.abs(sh.startDate.getTime() - db.start_date.getTime());
        const diffEnd = Math.abs(sh.endDate.getTime() - db.end_date.getTime());
        const totalDiff = diffStart + diffEnd;
        if (!best || totalDiff < Math.abs(best.diffStart) + Math.abs(best.diffEnd)) {
          return { sh, diffStart: (sh.startDate.getTime() - db.start_date.getTime()) / 86400000, diffEnd: (sh.endDate.getTime() - db.end_date.getTime()) / 86400000 };
        }
        return best;
      }, null);

      if (closest && Math.abs(closest.diffStart) <= 3 && Math.abs(closest.diffEnd) <= 3) {
        otherMismatchCount++;
        hasMismatch = true;
        const shSd = closest.sh.startDate.toISOString().slice(0, 10);
        const shEd = closest.sh.endDate.toISOString().slice(0, 10);
        mismatchDetails.push(`  ${sheetsId} ${dbInvs[0].name} | DB: ${dbSd}~${dbEd} | SH: ${shSd}~${shEd} | diff: start=${closest.diffStart > 0 ? '+' : ''}${closest.diffStart}d end=${closest.diffEnd > 0 ? '+' : ''}${closest.diffEnd}d`);
      } else {
        // DB 有但 Sheets 沒有
        dbOnlyCount++;
        hasMismatch = true;
      }
    }

    // Sheets 有但 DB 沒有的
    for (const sh of shSorted) {
      const shSd = sh.startDate.toISOString().slice(0, 10);
      const shEd = sh.endDate.toISOString().slice(0, 10);

      const hasExact = dbSorted.some(db => {
        const dSd = db.start_date.toISOString().slice(0, 10);
        const dEd = db.end_date.toISOString().slice(0, 10);
        return dSd === shSd && dEd === shEd;
      });
      const hasClose = dbSorted.some(db => {
        const diff = Math.abs(db.start_date.getTime() - sh.startDate.getTime());
        return diff <= 3 * 86400000;
      });

      if (!hasExact && !hasClose) {
        sheetsOnlyCount++;
        hasMismatch = true;
      }
    }

    if (hasMismatch) studentsWithMismatch++;
  }

  console.log('\n========== 全面比對結果 ==========');
  console.log(`學生數: ${totalStudents}`);
  console.log(`DB 收費單總數: ${totalInvoices}`);
  console.log(`有差異的學生: ${studentsWithMismatch}`);
  console.log(`off-by-one (DB早1天): ${offByOneCount} 筆`);
  console.log(`其他日期偏移: ${otherMismatchCount} 筆`);
  console.log(`DB有/Sheets無: ${dbOnlyCount} 筆`);
  console.log(`Sheets有/DB無: ${sheetsOnlyCount} 筆`);

  if (mismatchDetails.length > 0) {
    console.log('\n--- 非 off-by-one 的日期偏移明細 ---');
    for (const d of mismatchDetails) console.log(d);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
