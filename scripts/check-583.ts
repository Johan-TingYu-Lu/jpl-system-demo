import 'dotenv/config';
import { google } from 'googleapis';
import pg from 'pg';

const KEY_FILE = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-info-sys-4755479c1e25.json`;
const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: '計費日期表!A:Z' });
  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i]?.[0] || '').trim() === '583') {
      console.log('=== 583 in 計費日期表 ===');
      console.log('Raw:', JSON.stringify(rows[i]));
      const count = rows[i][3];
      const dates = rows[i].slice(4).filter((d: string) => d && d.trim());
      console.log('收費次數:', count);
      console.log('日期:', dates);
      break;
    }
  }

  // DB attendance
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows: att } = await client.query(`
    SELECT ma.year, ma.month, ma.days
    FROM monthly_attendance ma JOIN enrollments e ON ma.enrollment_id = e.id
    WHERE e.sheets_id = '583'
    ORDER BY ma.year, ma.month
  `);
  console.log('\n=== 583 出勤 (Y/YY) ===');
  for (const a of att) {
    const days = a.days as number[];
    for (let d = 0; d < 31; d++) {
      if (days[d] >= 2) console.log(`  ${a.year}/${String(a.month).padStart(2,'0')}/${String(d+1).padStart(2,'0')} status=${days[d]}`);
    }
  }
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
