/**
 * 讀取所有工作表名稱 + 學費收支總表完整內容
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!;

async function main() {
    const credentials = JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. 列出所有工作表
    console.log('=== 所有工作表 ===');
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets.properties.title',
    });
    const sheetNames = meta.data.sheets?.map(s => s.properties?.title || '') || [];
    sheetNames.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

    // 2. 讀取學費收支總表完整內容
    console.log('\n=== 學費收支總表（全部） ===');
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'學費收支總表'!A1:Z",
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = res.data.values || [];
        console.log(`共 ${rows.length} 行`);
        rows.forEach((row, i) => {
            console.log(`[${i}] ${JSON.stringify(row)}`);
        });
    } catch (e: any) {
        console.log('學費收支總表 讀取失敗:', e.message);
    }

    // 3. 檢查是否有其他收費相關的表
    const feeSheets = sheetNames.filter(n =>
        n.includes('收費') || n.includes('繳費') || n.includes('計費') || n.includes('帳')
    );
    if (feeSheets.length > 0) {
        console.log('\n=== 其他收費相關工作表 ===');
        for (const name of feeSheets) {
            if (name === '學費收支總表') continue;
            console.log(`\n--- ${name} ---`);
            try {
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `'${name}'!A1:Z`,
                    valueRenderOption: 'UNFORMATTED_VALUE',
                });
                const rows = res.data.values || [];
                console.log(`共 ${rows.length} 行`);
                rows.forEach((row, i) => {
                    console.log(`[${i}] ${JSON.stringify(row)}`);
                });
            } catch (e: any) {
                console.log(`  讀取失敗: ${e.message}`);
            }
        }
    }
}

main().catch(console.error);
