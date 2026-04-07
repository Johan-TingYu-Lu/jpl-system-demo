import * as dotenv from 'dotenv';
dotenv.config({ quiet: true } as any);
import pg from 'pg';
import fs from 'fs';
import path from 'path';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const OK_DIR = String.raw`C:\Users\johan\OneDrive\抓盒子\Johan\補習班\總務\收費單\202603\making\NEW\OK`;

  // 1. Read OK folder
  const okFiles = fs.readdirSync(OK_DIR).filter(f => f.endsWith('.pdf'));
  const okKeys = new Set<string>();
  for (const f of okFiles) {
    const m = f.match(/^(\d+)_([NM])_/);
    if (m) okKeys.add(m[1] + '_' + m[2]);
  }
  console.log(`OK 資料夾: ${okFiles.length} 張 PDF`);

  // 2. Get all March invoices from DB
  const { rows: marchInvoices } = await client.query(`
    SELECT i.id, i.serial_number, i.status, i.pdf_path, e.sheets_id, e.class_code
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
    WHERE i.end_date >= '2026-03-01' AND i.end_date <= '2026-03-31'
    ORDER BY e.sheets_id, e.class_code
  `);
  console.log(`DB 三月 invoices: ${marchInvoices.length} 筆`);

  // 3. Cross-reference
  const dbKeys = new Set(marchInvoices.map((r: any) => r.sheets_id + '_' + r.class_code));
  const inOkNotDb = [...okKeys].filter(k => !dbKeys.has(k)).sort();
  const inDbNotOk = [...dbKeys].filter(k => !okKeys.has(k)).sort();
  const matched = marchInvoices.filter((r: any) => okKeys.has(r.sheets_id + '_' + r.class_code));

  console.log(`\n匹配: ${matched.length} 筆`);
  console.log(`OK 有但 DB 沒有 (${inOkNotDb.length}): ${inOkNotDb.join(', ')}`);
  console.log(`DB 有但 OK 沒有 (${inDbNotOk.length}): ${inDbNotOk.join(', ')}`);

  // 4. Migrate ALL "pending" → "draft"
  const migResult = await client.query(`UPDATE invoices SET status = 'draft' WHERE status = 'pending'`);
  console.log(`\n✅ 狀態遷移: ${migResult.rowCount} 筆 pending → draft`);

  // 5. Update matched invoices: set pdf_path to OK folder
  let updated = 0;
  for (const inv of matched) {
    const filename = `${inv.sheets_id}_${inv.class_code}_20260313.pdf`;
    const newPath = path.join(OK_DIR, filename);
    if (fs.existsSync(newPath)) {
      await client.query(`UPDATE invoices SET pdf_path = $1 WHERE id = $2`, [newPath, inv.id]);
      updated++;
    } else {
      console.log(`⚠️ 檔案不存在: ${newPath}`);
    }
  }
  console.log(`✅ PDF 路徑更新: ${updated} 筆指向 OK 資料夾`);

  // 6. Verify
  const verify = await client.query(`SELECT status, count(*)::int as cnt FROM invoices GROUP BY status ORDER BY status`);
  console.log('\n=== 更新後狀態分佈 ===');
  for (const r of verify.rows) console.log(`  ${r.status}: ${r.cnt}`);

  await client.end();
}

main().catch(console.error);
