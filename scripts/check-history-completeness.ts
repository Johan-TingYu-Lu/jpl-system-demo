/**
 * check-history-completeness.ts
 * 比對 Sheet 收費張數 vs DB paid invoice 張數，確認歷史資料是否匯入完整
 */
import 'dotenv/config';
import { readBillingHistory } from '../src/lib/sheets-billing-reader.js';
import pg from 'pg';

async function main() {
  const sheetStudents = await readBillingHistory();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // DB: paid/draft 分開計算
  const { rows: dbRows } = await client.query(`
    SELECT e.sheets_id, p.name, e.class_name,
           COUNT(i.id) FILTER (WHERE i.status = 'paid') as paid_count,
           COUNT(i.id) FILTER (WHERE i.status = 'draft') as draft_count,
           COUNT(i.id) as total_count
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    LEFT JOIN invoices i ON i.enrollment_id = e.id
    WHERE e.status != '永久停止'
    GROUP BY e.sheets_id, p.name, e.class_name
    ORDER BY e.sheets_id::int
  `);

  const dbMap = new Map<string, { name: string; className: string; paidCount: number; draftCount: number; totalCount: number }>();
  for (const r of dbRows) {
    dbMap.set(r.sheets_id, {
      name: r.name,
      className: r.class_name,
      paidCount: Number(r.paid_count),
      draftCount: Number(r.draft_count),
      totalCount: Number(r.total_count),
    });
  }

  // Sheet lookup
  const sheetMap = new Map<string, { name: string; invoiceCount: number; actualInvoices: number }>();
  for (const s of sheetStudents) {
    sheetMap.set(s.sheetsId, {
      name: s.name,
      invoiceCount: s.invoiceCount,
      actualInvoices: s.invoices.length,
    });
  }

  // 比對
  let matchCount = 0;
  let mismatchCount = 0;
  let sheetOnlyCount = 0;
  let dbOnlyCount = 0;
  const mismatches: any[] = [];

  for (const [sid, sheet] of sheetMap) {
    const db = dbMap.get(sid);
    if (!db) {
      sheetOnlyCount++;
      mismatches.push({ sid, name: sheet.name, sheetCount: sheet.invoiceCount, dbPaid: '-', dbDraft: '-', dbTotal: '-', note: 'Sheet有/DB無(可能已永久停止)' });
      continue;
    }
    if (sheet.invoiceCount === db.paidCount) {
      matchCount++;
    } else {
      mismatchCount++;
      const diff = db.paidCount - sheet.invoiceCount;
      mismatches.push({
        sid, name: db.name,
        sheetCount: sheet.invoiceCount,
        dbPaid: db.paidCount,
        dbDraft: db.draftCount,
        dbTotal: db.totalCount,
        note: diff > 0 ? `DB多${diff}張paid` : `DB少${Math.abs(diff)}張paid`,
      });
    }
  }

  // DB 有 invoice 但 Sheet 沒有收費紀錄
  for (const [sid, db] of dbMap) {
    if (!sheetMap.has(sid) && db.totalCount > 0) {
      dbOnlyCount++;
      mismatches.push({ sid, name: db.name, sheetCount: '-', dbPaid: db.paidCount, dbDraft: db.draftCount, dbTotal: db.totalCount, note: 'DB有/Sheet無收費紀錄' });
    }
  }

  console.log('=== 歷史資料匯入完整性檢查 ===');
  console.log('比對: Sheet 計費日期表張數 vs DB invoices(status=paid) 張數');
  console.log('');
  console.log(`Sheet 有收費紀錄: ${sheetMap.size} 人`);
  console.log(`DB active enrollment: ${dbMap.size} 人`);
  console.log('');
  console.log(`✅ 張數一致 (Sheet=DB paid): ${matchCount} 人`);
  console.log(`❌ 張數不一致: ${mismatchCount} 人`);
  console.log(`⚠️ Sheet有/DB無: ${sheetOnlyCount} 人`);
  console.log(`⚠️ DB有invoice/Sheet無: ${dbOnlyCount} 人`);

  if (mismatches.length > 0) {
    console.log('');
    console.log('ID   | 姓名       | Sheet張數 | DB paid | DB draft | DB total | 說明');
    console.log('-----|------------|-----------|---------|----------|----------|--------');
    for (const m of mismatches) {
      console.log(
        String(m.sid).padEnd(4) + ' | ' +
        String(m.name).padEnd(10) + ' | ' +
        String(m.sheetCount).padEnd(9) + ' | ' +
        String(m.dbPaid).padEnd(7) + ' | ' +
        String(m.dbDraft).padEnd(8) + ' | ' +
        String(m.dbTotal).padEnd(8) + ' | ' +
        m.note
      );
    }
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
