import 'dotenv/config';
import { google } from 'googleapis';

const KEY_FILE = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-info-sys-4755479c1e25.json`;
const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'2026/02上課紀錄'!A:BZ",
  });
  const rows = res.data.values || [];

  // Find header row with 識別碼
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    if (String(rows[r]?.[0] || '').trim() === '識別碼') {
      headerRowIdx = r;
      break;
    }
  }
  console.log('Header row index:', headerRowIdx);
  if (headerRowIdx >= 0) {
    const headerRow = rows[headerRowIdx];
    console.log('Header row:', JSON.stringify(headerRow));

    // Find day columns (col >= 8, value 1-31)
    const dayMap: Record<number, number> = {};
    for (let c = 8; c < (headerRow?.length || 0); c++) {
      const num = parseInt(String(headerRow[c] || ''));
      if (!isNaN(num) && num >= 1 && num <= 31) {
        dayMap[c] = num;
      }
    }
    console.log('Day column mapping:', JSON.stringify(dayMap));

    // Find 591 data row
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (String(row[0] || '').trim() === '591') {
        console.log('\n=== 591 林彥祺 2026/02 出勤 ===');
        for (const [colStr, day] of Object.entries(dayMap)) {
          const col = parseInt(colStr);
          const val = String(row[col] || '').trim();
          if (val) console.log(`  Day ${day} (col${col}): ${val}`);
        }
        console.log('\nFull row:', JSON.stringify(row));
        break;
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
