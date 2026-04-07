/**
 * 讀取所有尚未檢視的工作表完整內容
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

    // 要讀取的工作表清單（尚未讀過的）
    const sheetsToRead = [
        '繳費日期表',
        '每月上課費用總表',
        '財務總表',
        '班級總表',
        '重要參數',
        '名單簡表',
        '排課',
        '歷年學生資料總表',
        '月度紀錄',
        '各年度總收費',
        '各年度應收金額',
        '各年度實收金額',
        '各年度次數_應收',
        '各年度次數_實收',
    ];

    for (const name of sheetsToRead) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`=== ${name} ===`);
        console.log('='.repeat(60));
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${name}'!A1:AZ`,
                valueRenderOption: 'UNFORMATTED_VALUE',
            });
            const rows = res.data.values || [];
            // 過濾掉全空行
            const nonEmpty = rows.filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
            console.log(`共 ${rows.length} 行（非空 ${nonEmpty.length} 行）`);
            // 顯示前 30 行和最後 5 行（如果超過 35 行的話）
            const limit = 30;
            if (nonEmpty.length <= limit + 5) {
                nonEmpty.forEach((row, i) => {
                    console.log(`[${i}] ${JSON.stringify(row)}`);
                });
            } else {
                for (let i = 0; i < limit; i++) {
                    console.log(`[${i}] ${JSON.stringify(nonEmpty[i])}`);
                }
                console.log(`... (省略 ${nonEmpty.length - limit - 5} 行)`);
                for (let i = nonEmpty.length - 5; i < nonEmpty.length; i++) {
                    console.log(`[${i}] ${JSON.stringify(nonEmpty[i])}`);
                }
            }
        } catch (e: any) {
            console.log(`  讀取失敗: ${e.message}`);
        }
    }
}

main().catch(console.error);
