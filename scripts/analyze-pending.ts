/**
 * 檢查 17 位不足學生的未收費金額
 * 看 學費收支總表 中的相關欄位
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

const MISSING = ['476', '543', '544', '596', '621', '629', '630', '631', '660', '664', '665', '672', '679', '680', '685', '686', '689'];

async function main() {
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: SID,
        range: "'學費收支總表'!A:Z",
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = res.data.values || [];
    const header = rows[0] || [];

    // Print relevant columns for these students
    console.log('欄位: ');
    for (let c = 0; c < header.length; c++) {
        const v = String(header[c] || '');
        if (v) console.log(`  col ${String(c).padStart(2)}: ${v}`);
    }

    console.log('\n' + '-'.repeat(100));
    console.log(`${'學號'.padEnd(6)} ${'姓名'.padEnd(10)} ${'col5(距下次)'.padEnd(14)} ${'col6(欠費)'.padEnd(12)} ${'col9(年度學費)'.padEnd(14)} ${'col10(已發單)'.padEnd(12)} ${'col12(應製單)'.padEnd(12)} ${'col15(應製)'.padEnd(10)}`);
    console.log('-'.repeat(100));

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        const sid = String(row[0] || '').trim();
        if (!MISSING.includes(sid)) continue;

        const name = String(row[1] || '').trim();
        console.log(
            `${sid.padEnd(6)} ${name.padEnd(10)} ` +
            `${String(row[5] || '').padEnd(14)} ` +
            `${String(row[6] || '').padEnd(12)} ` +
            `${String(row[9] || '').padEnd(14)} ` +
            `${String(row[10] || '').padEnd(12)} ` +
            `${String(row[12] || '').padEnd(12)} ` +
            `${String(row[15] || '').padEnd(10)}`
        );
    }
}

main().catch(console.error);
