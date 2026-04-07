/**
 * check-686-full.ts — 完整比對 686 的 DB vs Sheets (113+114)
 * 1. 查 113 學年 Sheets 暑假收費單
 * 2. 查 114 學年 Sheets
 * 3. 列出每筆收費單對應的 5 次上課日期
 */
import 'dotenv/config';
import { createSheetsApi } from '../src/lib/script-init.js';
import { readBillingHistoryForYear } from '../src/lib/sheets-billing-reader.js';
import { getYearConfig } from '../src/lib/year-config.js';
import pg from 'pg';

async function main() {
  await createSheetsApi();

  // ===== 1. 查 113 + 114 Sheets =====
  const config113 = getYearConfig(113)!;
  const config114 = getYearConfig(114)!;

  console.log('讀取 113 學年 Sheets...');
  const data113 = await readBillingHistoryForYear(config113);
  const s113 = data113.find(s => s.sheetsId === '686');

  console.log('讀取 114 學年 Sheets...');
  const data114 = await readBillingHistoryForYear(config114);
  const s114 = data114.find(s => s.sheetsId === '686');

  console.log('\n========== 113 學年 Sheets (686) ==========');
  if (s113) {
    console.log(`  姓名: ${s113.name} | 班別: ${s113.classInfo} | 收費次數: ${s113.invoiceCount}`);
    for (const inv of s113.invoices) {
      const sd = inv.startDate.toISOString().slice(0, 10);
      const ed = inv.endDate.toISOString().slice(0, 10);
      const pd = inv.paymentDate ? inv.paymentDate.toISOString().slice(0, 10) : '未繳';
      console.log(`    #${inv.invoiceIndex + 1} | ${sd}~${ed} | $${inv.sheetAmount} | 繳費: ${pd}`);
    }
  } else {
    console.log('  113 學年 Sheets 找不到 686');
  }

  console.log('\n========== 114 學年 Sheets (686) ==========');
  if (s114) {
    console.log(`  姓名: ${s114.name} | 班別: ${s114.classInfo} | 收費次數: ${s114.invoiceCount}`);
    for (const inv of s114.invoices) {
      const sd = inv.startDate.toISOString().slice(0, 10);
      const ed = inv.endDate.toISOString().slice(0, 10);
      const pd = inv.paymentDate ? inv.paymentDate.toISOString().slice(0, 10) : '未繳';
      console.log(`    #${inv.invoiceIndex + 1} | ${sd}~${ed} | $${inv.sheetAmount} | 繳費: ${pd}`);
    }
  } else {
    console.log('  114 學年 Sheets 找不到 686');
  }

  // ===== 2. 查 DB 出勤，列出每筆收費單的 5 次日期 =====
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 取得出勤
  const { rows: att } = await client.query(`
    SELECT ma.year, ma.month, ma.days
    FROM monthly_attendance ma
    JOIN enrollments e ON ma.enrollment_id = e.id
    WHERE e.sheets_id = '686'
    ORDER BY ma.year, ma.month
  `);

  // 建立所有上課日期列表
  const allDates: { date: string; dateObj: Date; y: number; code: number }[] = [];
  for (const a of att) {
    const days = a.days as number[];
    for (let d = 0; d < days.length; d++) {
      if (days[d] === 2 || days[d] === 3) {
        const dt = new Date(a.year, a.month - 1, d + 1);
        if (dt.getMonth() !== a.month - 1) continue;
        allDates.push({
          date: `${a.year}/${String(a.month).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`,
          dateObj: dt,
          y: days[d] === 3 ? 2 : 1,
          code: days[d],
        });
      }
    }
  }

  console.log(`\n========== DB 出勤紀錄 (${allDates.length} 次) ==========`);
  for (const d of allDates) {
    console.log(`  ${d.date} | ${d.code === 3 ? 'YY (2Y)' : 'Y  (1Y)'}`);
  }

  // ===== 3. 按 10Y 切割，列出每筆收費單對應的 5 次日期 =====
  // Plan B: 10Y settlement, 每次 YY=2Y, 所以 5 次 YY = 10Y
  console.log('\n========== 按 10Y 切割收費單（應有的日期） ==========');
  let cumY = 0;
  let invoiceNum = 0;
  let currentBatch: { date: string; y: number; code: number }[] = [];

  for (const d of allDates) {
    currentBatch.push(d);
    cumY += d.y;

    if (cumY >= 10) {
      invoiceNum++;
      const startDate = currentBatch[0].date;
      const endDate = currentBatch[currentBatch.length - 1].date;
      console.log(`\n  收費單 #${invoiceNum}: ${startDate} ~ ${endDate} (${cumY}Y)`);
      for (const b of currentBatch) {
        console.log(`    ${b.date} | ${b.code === 3 ? 'YY' : 'Y '} | ${b.y}Y`);
      }

      // 比對 Sheets
      // 合併 113 + 114 的 Sheets invoices
      const allSheetsInv = [
        ...(s113?.invoices || []),
        ...(s114?.invoices || []),
      ];
      if (invoiceNum <= allSheetsInv.length) {
        const sh = allSheetsInv[invoiceNum - 1];
        const shSd = sh.startDate.toISOString().slice(0, 10);
        const shEd = sh.endDate.toISOString().slice(0, 10);
        console.log(`    → Sheets: ${shSd}~${shEd} | $${sh.sheetAmount}`);
        console.log(`    → 比對: 起=${startDate.replace(/\//g, '-') === shSd ? '✅' : '❌ ' + shSd} 迄=${endDate.replace(/\//g, '-') === shEd ? '✅' : '❌ ' + shEd}`);
      } else {
        console.log(`    → Sheets: (無對應)`);
      }

      cumY = 0;
      currentBatch = [];
    }
  }

  // 剩餘未滿 10Y
  if (currentBatch.length > 0) {
    console.log(`\n  未結算餘額: ${cumY}Y (${currentBatch.length} 次)`);
    for (const b of currentBatch) {
      console.log(`    ${b.date} | ${b.code === 3 ? 'YY' : 'Y '} | ${b.y}Y`);
    }
  }

  // ===== 4. 查 DB invoices 列出日期差異 =====
  const { rows: dbInv } = await client.query(`
    SELECT i.serial_number, i.start_date, i.end_date, i.amount, i.total_y, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = '686'
    ORDER BY i.start_date
  `);

  console.log('\n========== DB 現有收費單 vs 應有收費單 ==========');
  console.log('DB:');
  for (let i = 0; i < dbInv.length; i++) {
    const inv = dbInv[i];
    console.log(`  #${i + 1} ${inv.serial_number} | ${inv.start_date.toISOString().slice(0, 10)}~${inv.end_date.toISOString().slice(0, 10)} | $${inv.amount} | ${inv.status}`);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
