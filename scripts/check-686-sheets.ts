/**
 * check-686-sheets.ts — 從 Google Sheets 讀取 686 的收費資料，與 DB 比對
 */
import 'dotenv/config';
import { createSheetsApi } from '../src/lib/script-init.js';
import { readBillingHistoryForYear } from '../src/lib/sheets-billing-reader.js';
import { getYearConfig } from '../src/lib/year-config.js';

async function main() {
  // 先初始化 Google Sheets API
  await createSheetsApi();

  const config = getYearConfig(114);
  if (!config) {
    console.error('找不到 114 學年設定');
    process.exit(1);
  }

  console.log('正在讀取 114 學年 Sheets 資料...');
  const allData = await readBillingHistoryForYear(config);

  // 找 686
  const student686 = allData.find(s => s.sheetsId === '686');
  if (!student686) {
    console.log('Sheets 中找不到 sheetsId=686');
    // 列出所有 ID 看看
    console.log('所有 Sheets ID:', allData.map(s => s.sheetsId).join(', '));
    return;
  }

  console.log('\n=== SHEETS DATA for 686 ===');
  console.log(`  姓名: ${student686.name}`);
  console.log(`  班別: ${student686.classInfo}`);
  console.log(`  收費次數: ${student686.invoiceCount}`);
  console.log(`  prepThreshold: ${student686.prepThreshold}`);
  console.log(`  feeThreshold: ${student686.feeThreshold}`);

  console.log(`\n  Sheets 收費明細 (${student686.invoices.length} 筆):`);
  let sheetsTotal = 0;
  for (const inv of student686.invoices) {
    const sd = inv.startDate.toISOString().slice(0, 10);
    const ed = inv.endDate.toISOString().slice(0, 10);
    const amt = inv.sheetAmount ?? 'N/A';
    const pd = inv.paymentDate ? inv.paymentDate.toISOString().slice(0, 10) : '未繳';
    if (typeof inv.sheetAmount === 'number') sheetsTotal += inv.sheetAmount;
    console.log(`    #${inv.invoiceIndex + 1} | ${sd}~${ed} | $${amt} | 繳費: ${pd}`);
  }
  console.log(`  Sheets 金額合計: $${sheetsTotal}`);

  // 現在比對 DB
  console.log('\n\n=== DB vs SHEETS 比對 ===');
  console.log('項目                | DB              | Sheets          | 匹配');
  console.log('-'.repeat(75));

  // DB data (re-query)
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: dbInvoices } = await client.query(`
    SELECT i.serial_number, i.start_date, i.end_date, i.amount, i.total_y, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = '686'
    ORDER BY i.start_date
  `);

  const { rows: dbPayments } = await client.query(`
    SELECT amount, payment_date
    FROM payments p
    JOIN enrollments e ON p.enrollment_id = e.id
    WHERE e.sheets_id = '686'
    ORDER BY payment_date
  `);

  // 比對筆數
  const countMatch = dbInvoices.length === student686.invoices.length;
  console.log(`收費單筆數          | ${String(dbInvoices.length).padEnd(15)} | ${String(student686.invoices.length).padEnd(15)} | ${countMatch ? '✅' : '❌'}`);

  // 逐筆比對
  const maxLen = Math.max(dbInvoices.length, student686.invoices.length);
  for (let i = 0; i < maxLen; i++) {
    const db = dbInvoices[i];
    const sh = student686.invoices[i];

    if (!db && sh) {
      console.log(`收費單 #${i + 1}           | (無)            | ${sh.startDate.toISOString().slice(0, 10)}~${sh.endDate.toISOString().slice(0, 10)} $${sh.sheetAmount} | ❌ DB缺`);
      continue;
    }
    if (db && !sh) {
      console.log(`收費單 #${i + 1}           | ${db.start_date.toISOString().slice(0, 10)}~${db.end_date.toISOString().slice(0, 10)} $${db.amount} | (無)            | ❌ Sheets缺`);
      continue;
    }
    if (db && sh) {
      const dbSd = db.start_date.toISOString().slice(0, 10);
      const dbEd = db.end_date.toISOString().slice(0, 10);
      const shSd = sh.startDate.toISOString().slice(0, 10);
      const shEd = sh.endDate.toISOString().slice(0, 10);
      const dbAmt = db.amount;
      const shAmt = sh.sheetAmount;

      const dateMatch = dbSd === shSd && dbEd === shEd;
      const amtMatch = dbAmt === shAmt;

      console.log(`收費單 #${i + 1} 日期      | ${dbSd}~${dbEd} | ${shSd}~${shEd} | ${dateMatch ? '✅' : '❌'}`);
      console.log(`收費單 #${i + 1} 金額      | $${String(dbAmt).padEnd(14)} | $${String(shAmt).padEnd(14)} | ${amtMatch ? '✅' : '❌'}`);

      // 繳費日期比對
      const shPd = sh.paymentDate ? sh.paymentDate.toISOString().slice(0, 10) : '未繳';
      const dbPayment = dbPayments[i];
      const dbPd = dbPayment ? dbPayment.payment_date.toISOString().slice(0, 10) : '未繳';
      const pdMatch = dbPd === shPd;
      console.log(`收費單 #${i + 1} 繳費日    | ${dbPd.padEnd(15)} | ${shPd.padEnd(15)} | ${pdMatch ? '✅' : '❌'}`);
    }
  }

  // 總金額
  const dbTotal = dbInvoices.reduce((s: number, i: any) => s + i.amount, 0);
  const totalMatch = dbTotal === sheetsTotal;
  console.log(`${'─'.repeat(75)}`);
  console.log(`金額合計            | $${String(dbTotal).padEnd(14)} | $${String(sheetsTotal).padEnd(14)} | ${totalMatch ? '✅' : '❌'}`);

  // 繳費總額
  const dbPayTotal = dbPayments.reduce((s: number, p: any) => s + p.amount, 0);
  const shPayTotal = student686.invoices
    .filter(inv => inv.paymentDate !== null)
    .reduce((s, inv) => s + (inv.sheetAmount ?? 0), 0);
  console.log(`已繳合計            | $${String(dbPayTotal).padEnd(14)} | $${String(shPayTotal).padEnd(14)} | ${dbPayTotal === shPayTotal ? '✅' : '❌'}`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
