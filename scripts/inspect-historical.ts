/**
 * 快速探測歷年試算表結構（2024, 2023, 2017）
 * 看看跟 114 學年差異多大
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

const SHEETS: Record<string, string> = {
    '2024': '1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps',
    '2023': '1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU',
    '2017': '1G90xbpj9JC-_3X2vv4i0lfDUmIPrBZsZ94-LKQj_-FE',
};

async function inspectSpreadsheet(label: string, id: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${label} — ${id}`);
    console.log('='.repeat(60));

    // 1. Sheet names
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId: id,
        fields: 'properties.title,sheets.properties.title',
    });
    const title = meta.data.properties?.title;
    const names = meta.data.sheets?.map(s => s.properties?.title || '') || [];
    console.log(`  名稱: ${title}`);
    console.log(`  工作表 (${names.length}): ${names.join(', ')}`);

    // 2. Find student sheet
    const studentSheet = names.find(n => n.includes('學生資料')) || names[0];
    if (studentSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id,
            range: `'${studentSheet}'!A1:F3`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        console.log(`\n  👤 "${studentSheet}" 前 3 行:`);
        (r.data.values || []).forEach((row: unknown[], i: number) => {
            console.log(`    [${i}] ${(row as string[]).slice(0, 6).join(' | ')}`);
        });
    }

    // 3. Find attendance sheet
    const attSheet = names.find(n => /\d{4}\/\d{2}上課紀錄/.test(n));
    if (attSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id,
            range: `'${attSheet}'!A1:H3`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        console.log(`\n  📅 "${attSheet}" 前 3 行:`);
        (r.data.values || []).forEach((row: unknown[], i: number) => {
            console.log(`    [${i}] ${(row as string[]).slice(0, 8).join(' | ')}`);
        });
    }

    // 4. Find billing sheet
    const billingSheet = names.find(n => n.includes('計費日期'));
    if (billingSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id,
            range: `'${billingSheet}'!A1:H3`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        console.log(`\n  💰 "${billingSheet}" 前 3 行:`);
        (r.data.values || []).forEach((row: unknown[], i: number) => {
            console.log(`    [${i}] ${(row as string[]).slice(0, 8).join(' | ')}`);
        });
    }
}

async function main() {
    // Also read billing table from 114 in detail
    console.log('='.repeat(60));
    console.log('💰 114 計費日期表完整結構');
    console.log('='.repeat(60));
    const r = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
        range: "'計費日期表'!A1:AZ5",
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = r.data.values || [];
    for (let i = 0; i < rows.length; i++) {
        console.log(`\n  行 ${i}:`);
        for (let c = 0; c < (rows[i]?.length || 0); c++) {
            const val = rows[i][c];
            if (val !== '' && val !== null && val !== undefined) {
                console.log(`    [col ${String(c).padStart(2)}] ${val}`);
            }
        }
    }

    for (const [label, id] of Object.entries(SHEETS)) {
        await inspectSpreadsheet(label, id);
    }
}

main().catch(console.error);
