import 'dotenv/config';
import { google } from 'googleapis';
import pg from 'pg';

const KEY_FILE = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-info-sys-4755479c1e25.json`;
const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';

function parseSheetDate(d: string): string | null {
  // Handle both YYYY/MM/DD and DD/MM/YYYY formats
  const m1 = d.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')}`;
  const m2 = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  return null;
}

async function main() {
  // 1. Read Sheet 計費日期表
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: '計費日期表!A:Z',
  });
  const rows = res.data.values || [];

  // Build Sheet data: sheetsId → array of [startDate, endDate] pairs
  const sheetData = new Map<string, { starts: string[]; ends: string[] }>();
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]?.[0] || '').trim();
    if (!id || !/^\d+$/.test(id)) continue;
    const dates = rows[i].slice(4).filter((d: string) => d && d.trim());
    const starts: string[] = [];
    const ends: string[] = [];
    for (let j = 0; j < dates.length; j += 2) {
      const s = parseSheetDate(dates[j]);
      const e = dates[j + 1] ? parseSheetDate(dates[j + 1]) : null;
      if (s) starts.push(s);
      if (e) ends.push(e);
    }
    if (starts.length > 0) {
      sheetData.set(id, { starts, ends });
    }
  }

  // 2. Read DB invoices
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: dbInvoices } = await client.query(`
    SELECT i.id, i.serial_number, i.start_date, i.end_date, i.status,
           e.sheets_id
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE i.status != 'draft'
    ORDER BY e.sheets_id::int, i.start_date
  `);

  // Group by sheetsId
  const byStudent = new Map<string, typeof dbInvoices>();
  for (const inv of dbInvoices) {
    if (!byStudent.has(inv.sheets_id)) byStudent.set(inv.sheets_id, []);
    byStudent.get(inv.sheets_id)!.push(inv);
  }

  // 3. Compare and fix
  let fixedCount = 0;
  let skippedCount = 0;
  const fixes: { id: number; serial: string; field: string; from: string; to: string }[] = [];

  for (const [sheetsId, sheet] of sheetData) {
    const dbInvs = byStudent.get(sheetsId);
    if (!dbInvs || dbInvs.length === 0) continue;

    // Match by index (both should be in chronological order)
    const minLen = Math.min(sheet.starts.length, dbInvs.length);
    for (let i = 0; i < minLen; i++) {
      const inv = dbInvs[i];
      const dbStart = inv.start_date?.toISOString().slice(0, 10);
      const dbEnd = inv.end_date?.toISOString().slice(0, 10);
      const sheetStart = sheet.starts[i];
      const sheetEnd = sheet.ends[i];

      if (sheetStart && dbStart && sheetStart !== dbStart) {
        fixes.push({ id: inv.id, serial: inv.serial_number, field: 'start_date', from: dbStart, to: sheetStart });
      }
      if (sheetEnd && dbEnd && sheetEnd !== dbEnd) {
        fixes.push({ id: inv.id, serial: inv.serial_number, field: 'end_date', from: dbEnd, to: sheetEnd });
      }
    }
  }

  console.log(`需修正: ${fixes.length} 筆日期`);

  // Show sample
  const sample = fixes.slice(0, 20);
  for (const f of sample) {
    console.log(`  ${f.serial} ${f.field}: ${f.from} → ${f.to}`);
  }
  if (fixes.length > 20) console.log(`  ... 還有 ${fixes.length - 20} 筆`);

  // Apply fixes
  let applied = 0;
  for (const f of fixes) {
    await client.query(`UPDATE invoices SET ${f.field} = $1::date WHERE id = $2`, [f.to, f.id]);
    applied++;
  }
  console.log(`\n✅ 已修正 ${applied} 筆日期`);

  // Verify: re-run comparison for a few
  const { rows: verify } = await client.query(`
    SELECT i.serial_number, i.start_date, i.end_date, e.sheets_id
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id IN ('446', '591', '555')
    ORDER BY e.sheets_id::int, i.start_date
  `);
  console.log('\n=== 驗證 ===');
  for (const v of verify) {
    console.log(`${v.sheets_id} ${v.serial_number}: ${v.start_date?.toISOString().slice(0,10)} ~ ${v.end_date?.toISOString().slice(0,10)}`);
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
