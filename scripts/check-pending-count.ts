/**
 * check-pending-count.ts — 比對系統待開單數 vs Sheets 待開單數
 */
import 'dotenv/config';
import { createSheetsApi } from '../src/lib/script-init.js';
import { readBillingHistoryForYear } from '../src/lib/sheets-billing-reader.js';
import { getYearConfig } from '../src/lib/year-config.js';
import pg from 'pg';

async function main() {
  await createSheetsApi();

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1. DB: 所有 active enrollment 的待開單（draft）
  const { rows: dbDrafts } = await client.query(`
    SELECT e.sheets_id, p.name, e.class_name, i.serial_number,
           i.start_date, i.end_date, i.amount, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.status = 'draft'
    ORDER BY e.sheets_id::int, i.start_date
  `);
  console.log(`=== DB draft 收費單: ${dbDrafts.length} 筆 ===`);
  for (const d of dbDrafts) {
    console.log(`  ${d.sheets_id} ${d.name} | ${d.serial_number} | ${d.start_date.toISOString().slice(0,10)}~${d.end_date.toISOString().slice(0,10)} | $${d.amount}`);
  }

  // 2. DB: 用出勤算每個 active student 可開單數
  const { rows: activeEnrollments } = await client.query(`
    SELECT e.id, e.sheets_id, e.class_name, e.class_code, p.name
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    WHERE e.status = 'active'
    ORDER BY e.sheets_id::int
  `);

  // 取每個 enrollment 的已開單數和出勤 totalY
  let systemPending = 0;
  const pendingDetails: string[] = [];

  for (const e of activeEnrollments) {
    // 已開單數
    const { rows: [{ count: invCount }] } = await client.query(
      `SELECT count(*) FROM invoices WHERE enrollment_id = $1`, [e.id]
    );

    // 出勤 totalY
    const { rows: attRows } = await client.query(
      `SELECT days FROM monthly_attendance WHERE enrollment_id = $1`, [e.id]
    );
    let totalY = 0;
    for (const a of attRows) {
      for (const code of (a.days as number[])) {
        if (code === 3) totalY += 2;
        else if (code === 2) totalY += 1;
      }
    }

    // 判斷方案 (簡化: 高三/115 = A/8Y, 其他 = B/10Y)
    const cn = e.class_name || '';
    const settlementY = (cn.includes('(115)') || cn.includes('高三班')) ? 8 : 10;

    const expectedInvoices = Math.floor(totalY / settlementY);
    const actualInvoices = parseInt(invCount);
    const pending = expectedInvoices - actualInvoices;

    if (pending > 0) {
      systemPending += pending;
      pendingDetails.push(`  ${e.sheets_id} ${e.name} | ${e.class_name} | totalY=${totalY} 期望${expectedInvoices}張 實際${actualInvoices}張 → 待開${pending}張`);
    }
  }

  console.log(`\n=== 系統計算待開單: ${systemPending} 筆 ===`);
  for (const d of pendingDetails) console.log(d);

  // 3. Sheets 114: 讀取所有學生的收費次數
  const config114 = getYearConfig(114)!;
  console.log('\n讀取 114 Sheets...');
  const sheetsData = await readBillingHistoryForYear(config114);

  // 比對: Sheets 的 invoiceCount vs DB 的 114 學年 invoice 數
  // 先取 DB 中 114 學年的 invoice 數（按 sheetsId）
  // 114 學年 = startDate >= 2025-08-01
  const { rows: db114Invoices } = await client.query(`
    SELECT e.sheets_id, count(*) as cnt
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE i.start_date >= '2025-08-01'
    GROUP BY e.sheets_id
  `);
  const db114Map = new Map<string, number>();
  for (const r of db114Invoices) db114Map.set(r.sheets_id, parseInt(r.cnt));

  let sheetsPending = 0;
  const sheetsPendingDetails: string[] = [];
  const mismatchDetails: string[] = [];

  for (const s of sheetsData) {
    const dbCount = db114Map.get(s.sheetsId) || 0;
    const sheetsCount = s.invoiceCount;

    // Sheets 有繳費紀錄但 DB 沒有對應 paid 的
    const sheetsPaid = s.invoices.filter(inv => inv.paymentDate !== null).length;

    // 查 DB 中該學生 114 學年 paid 的數量
    const { rows: [{ count: dbPaidCount }] } = await client.query(`
      SELECT count(*) FROM invoices i
      JOIN enrollments e ON i.enrollment_id = e.id
      WHERE e.sheets_id = $1 AND i.start_date >= '2025-08-01' AND i.status = 'paid'
    `, [s.sheetsId]);

    const dbPaid = parseInt(dbPaidCount);

    if (sheetsCount !== dbCount || sheetsPaid !== dbPaid) {
      mismatchDetails.push(`  ${s.sheetsId} ${s.name} | Sheets: ${sheetsCount}張(${sheetsPaid}已繳) | DB114: ${dbCount}張(${dbPaid}已繳)`);
    }
  }

  console.log(`\n=== Sheets vs DB 114學年 收費單數量差異 (${mismatchDetails.length} 人) ===`);
  for (const d of mismatchDetails) console.log(d);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
