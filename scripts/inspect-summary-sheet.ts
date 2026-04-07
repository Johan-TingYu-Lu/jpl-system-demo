/**
 * inspect-summary-sheet.ts — 掃描學費收支總表，找出書籍雜費欄位
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const ALL_SHEETS: Record<string, string> = {
  '112': '1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU',
  '113': '1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps',
  '114': process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
};

async function main() {
  const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  for (const [year, spreadsheetId] of Object.entries(ALL_SHEETS)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`  ${year} 學年 — 學費收支總表`);
    console.log('='.repeat(80));

    const r = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: "'學費收支總表'!A1:AZ3",
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = r.data.values || [];
    const header = rows[0] || [];
    const row2 = rows[1] || [];
    const row3 = rows[2] || [];

    console.log(`  欄位數: ${header.length}`);
    console.log('');
    console.log('  Col | Header                     | Row2 Sample        | Row3 Sample');
    console.log('  ----+----------------------------+--------------------+--------------------');
    for (let i = 0; i < Math.max(header.length, row2.length); i++) {
      const colLetter = String.fromCharCode(65 + (i < 26 ? i : -1)) || `${String.fromCharCode(65 + Math.floor(i/26) - 1)}${String.fromCharCode(65 + i%26)}`;
      const h = String(header[i] ?? '').substring(0, 26);
      const r2 = String(row2[i] ?? '').substring(0, 18);
      const r3 = String(row3[i] ?? '').substring(0, 18);
      console.log(`  ${String(i).padStart(3)} | ${h.padEnd(26)} | ${r2.padEnd(18)} | ${r3}`);
    }

    // Search for 書籍 or 雜費 in headers
    console.log('');
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] || '');
      if (h.includes('書') || h.includes('雜') || h.includes('費') || h.includes('book')) {
        console.log(`  🔍 col ${i}: "${h}"`);
      }
    }
  }
}
main().catch(console.error);
