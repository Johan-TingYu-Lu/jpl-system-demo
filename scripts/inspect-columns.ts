import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const c = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials: c, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const s = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

async function go() {
    // Headers
    const r1 = await s.spreadsheets.values.get({ spreadsheetId: SID, range: "'歷年學生資料總表'!A1:V1" });
    console.log('=== 歷年學生資料總表 HEADERS ===');
    (r1.data.values?.[0] || []).forEach((h: string, i: number) => {
        console.log(`  [${String.fromCharCode(65 + i)}] ${h}`);
    });

    // Last 10 rows (class name examples)
    const r2 = await s.spreadsheets.values.get({ spreadsheetId: SID, range: "'歷年學生資料總表'!A:C", valueRenderOption: 'UNFORMATTED_VALUE' });
    const rows = r2.data.values || [];
    const last15 = rows.slice(-15);
    console.log('\n=== 最後 15 筆 (ID | 姓名 | 班別) ===');
    last15.forEach((row: unknown[]) => console.log(`  ${row[0]} | ${row[1]} | ${row[2]}`));

    // Also some active 114 students for class name examples
    const r3 = await s.spreadsheets.values.get({ spreadsheetId: SID, range: "'114學生資料表'!A:C", valueRenderOption: 'UNFORMATTED_VALUE' });
    const rows3 = r3.data.values || [];
    console.log('\n=== 114學生資料表 前 20 筆 (ID | 姓名 | 班別) ===');
    rows3.slice(1, 21).forEach((row: unknown[]) => console.log(`  ${row[0]} | ${row[1]} | ${row[2]}`));
}
go();
