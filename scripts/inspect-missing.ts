import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

const SHEETS: Record<string, string> = {
    'A': '13iwro7zS4Da_Z6Xnopn6nHlMfOYil-Id5ib2HyUrH2E',
    'B': '1RLv3XuGjeDZd3CEQOh-0Cn2azIJmozkwnI7gDliXC3U',
    'C': '1G7_Y7pDE__l3cpoG8TTbduweRQmIoQIlO7Q9010tb68',
};

async function inspect(label: string, id: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${label} — ${id}`);
    console.log('='.repeat(60));
    
    const meta = await sheetsApi.spreadsheets.get({
        spreadsheetId: id,
        fields: 'properties.title,sheets.properties.title',
    });
    const title = meta.data.properties?.title;
    const names = meta.data.sheets?.map(s => s.properties?.title || '') || [];
    console.log(`  名稱: ${title}`);
    console.log(`  工作表 (${names.length}): ${names.join(', ')}`);

    const studentSheet = names.find(n => n.includes('學生資料')) || names[0];
    if (studentSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id, range: `'${studentSheet}'!A1:F5`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        console.log(`\n  👤 "${studentSheet}" 前 5 行:`);
        (r.data.values || []).forEach((row: any[], i: number) => {
            console.log(`    [${i}] ${row.slice(0, 6).join(' | ')}`);
        });
    }

    const billingSheet = names.find(n => n.includes('計費日期'));
    if (billingSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id, range: `'${billingSheet}'!A1:H5`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        console.log(`\n  💰 "${billingSheet}" 前 5 行:`);
        (r.data.values || []).forEach((row: any[], i: number) => {
            console.log(`    [${i}] ${row.slice(0, 8).join(' | ')}`);
        });
    }
    
    if (billingSheet) {
        const r = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: id, range: `'${billingSheet}'!A:D`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = (r.data.values || []).filter(r => typeof r[0] === 'number');
        const ids = rows.map(r => r[0] as number);
        if (ids.length > 0) {
            console.log(`\n  📊 計費日期表學生: ${rows.length} 人, ID ${Math.min(...ids)} ~ ${Math.max(...ids)}`);
            const withBilling = rows.filter(r => r[3] && r[3] > 0);
            const totalInvoices = withBilling.reduce((s, r) => s + (r[3] || 0), 0);
            console.log(`  📊 有收費的學生: ${withBilling.length} 人, 總收費筆數: ${totalInvoices}`);
        }
    }

    const attSheets = names.filter(n => /\d{4}\/\d{2}上課紀錄/.test(n));
    console.log(`\n  📅 上課紀錄表: ${attSheets.length} 個 — ${attSheets[0] || 'N/A'} ~ ${attSheets[attSheets.length-1] || 'N/A'}`);
}

async function main() {
    for (const [label, id] of Object.entries(SHEETS)) {
        try { await inspect(label, id); } catch (e: any) { console.log(`\n❌ ${label}: ${e.message}`); }
    }
}
main().catch(console.error);
