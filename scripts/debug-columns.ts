/**
 * Debug: 檢查出席紀錄的欄位結構
 * 找出日期欄和出席資料的對應關係
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

async function main() {
    console.log('🔍 2026/02上課紀錄 欄位結構分析\n');

    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: SID,
        range: "'2026/02上課紀錄'!A1:BZ5",
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = res.data.values || [];

    // Print first 5 rows with column indices
    for (let r = 0; r < rows.length; r++) {
        console.log(`\n行 ${r}:`);
        for (let c = 0; c < (rows[r]?.length || 0); c++) {
            const val = rows[r][c];
            if (val !== '' && val !== null && val !== undefined) {
                console.log(`  [col ${String(c).padStart(2)}] ${val}`);
            }
        }
    }

    // Now find row 542 and show all data
    const allRows = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: SID,
        range: "'2026/02上課紀錄'!A1:BZ100",
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const allData = allRows.data.values || [];

    console.log('\n\n🔎 學號 542 的完整行:');
    for (let r = 0; r < allData.length; r++) {
        if (String(allData[r]?.[0]).trim() === '542') {
            for (let c = 0; c < (allData[r]?.length || 0); c++) {
                const val = allData[r][c];
                if (val !== '' && val !== null && val !== undefined) {
                    console.log(`  [col ${String(c).padStart(2)}] ${val}`);
                }
            }
            break;
        }
    }
}

main().catch(console.error);
