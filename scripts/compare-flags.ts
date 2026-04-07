import 'dotenv/config';
import { google } from 'googleapis';
import pg from 'pg';

const KEY_FILE = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-info-sys-4755479c1e25.json`;
const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';

async function main() {
  // 1. Read Sheet 計費日期表
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: '計費日期表!A:Z',
  });
  const rows = res.data.values || [];

  // Build Sheet FLAG map: sheetsId → last end_date
  const sheetFlags = new Map<string, { count: number; lastEnd: string; allDates: string[] }>();
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]?.[0] || '').trim();
    if (!id || !/^\d+$/.test(id)) continue;
    const count = parseInt(rows[i][3]) || 0;
    const dates = rows[i].slice(4).filter((d: string) => d && d.trim());
    const lastEnd = dates.length > 0 ? dates[dates.length - 1] : null;
    if (lastEnd) {
      sheetFlags.set(id, { count, lastEnd, allDates: dates });
    }
  }

  // 2. Read DB FLAGs: last end_date per enrollment
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: dbRows } = await client.query(`
    SELECT e.sheets_id, p.name, e.class_code,
           MAX(i.end_date)::text as last_end_text,
           COUNT(i.id) as invoice_count
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    LEFT JOIN invoices i ON i.enrollment_id = e.id
    WHERE e.status != '永久停止'
    GROUP BY e.sheets_id, p.name, e.class_code
    ORDER BY e.sheets_id::int
  `);

  const dbFlags = new Map<string, { name: string; classCode: string; lastEnd: string | null; count: number }>();
  for (const r of dbRows) {
    const lastEnd = r.last_end_text ? r.last_end_text.replace(/-/g, '/') : null;
    dbFlags.set(r.sheets_id, { name: r.name, classCode: r.class_code, lastEnd, count: parseInt(r.invoice_count) });
  }

  // 3. Compare
  let mismatchCount = 0;
  const mismatches: { id: string; name: string; sheetEnd: string; dbEnd: string; sheetCount: number; dbCount: number }[] = [];

  for (const [id, sheet] of sheetFlags) {
    const db = dbFlags.get(id);
    if (!db) continue;
    if (!db.lastEnd) continue;

    // Normalize dates for comparison (Sheet uses YYYY/MM/DD, DB too after conversion)
    const sheetNorm = sheet.lastEnd.trim();
    const dbNorm = db.lastEnd;

    if (sheetNorm !== dbNorm) {
      mismatchCount++;
      mismatches.push({
        id,
        name: db.name,
        sheetEnd: sheetNorm,
        dbEnd: dbNorm,
        sheetCount: sheet.count,
        dbCount: db.count,
      });
    }
  }

  console.log(`=== FLAG 比對結果 ===`);
  console.log(`Sheet 有 FLAG: ${sheetFlags.size} 人`);
  console.log(`DB 有 invoice: ${dbFlags.size} 人`);
  console.log(`不一致: ${mismatchCount} 人\n`);

  if (mismatches.length > 0) {
    console.log('ID   | 姓名     | Sheet FLAG    | DB FLAG       | Sheet次數 | DB次數');
    console.log('-----|----------|---------------|---------------|-----------|------');
    for (const m of mismatches) {
      const nameP = m.name.padEnd(6, '　');
      console.log(`${m.id.padEnd(4)} | ${nameP} | ${m.sheetEnd.padEnd(13)} | ${m.dbEnd.padEnd(13)} | ${String(m.sheetCount).padEnd(9)} | ${m.dbCount}`);
    }
  } else {
    console.log('✅ 全部一致！');
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
