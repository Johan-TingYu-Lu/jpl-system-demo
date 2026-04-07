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

  console.log('=== 計費日期表 Header ===');
  console.log(JSON.stringify(rows[0]));

  // Find 591
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]?.[0] || '').trim();
    if (id === '591') {
      console.log('\n=== 591 in 計費日期表 ===');
      console.log('Raw row:', JSON.stringify(rows[i]));
      const count = rows[i][3];
      console.log('收費次數:', count);
      // Show date pairs (col 4 onwards)
      const dates = rows[i].slice(4).filter((d: string) => d && d.trim());
      console.log('日期欄位:', JSON.stringify(dates));
      break;
    }
  }

  // 2. Compare with DB FLAG
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows: inv } = await client.query(`
    SELECT i.serial_number, i.start_date, i.end_date, i.amount, i.status
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = '591'
    ORDER BY i.end_date DESC
  `);
  console.log('\n=== 591 DB invoices (by end_date desc) ===');
  for (const r of inv) {
    console.log(r.serial_number, r.start_date?.toISOString().slice(0,10), '~', r.end_date?.toISOString().slice(0,10), '$'+r.amount, r.status);
  }
  console.log('\nDB FLAG (last end_date):', inv[0]?.end_date?.toISOString().slice(0,10));

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
