/**
 * Google Sheets API 連線測試腳本
 * 測試項目：
 * 1. Service Account 認證
 * 2. 讀取試算表工作表清單
 * 3. 讀取學生資料表前幾行
 * 4. 讀取出席紀錄樣本
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!;

async function main() {
    console.log('='.repeat(70));
    console.log('📋 JPL Google Sheets API 連線測試');
    console.log('='.repeat(70));
    console.log(`  Spreadsheet ID: ${SPREADSHEET_ID}`);
    console.log(`  Key File: ${KEY_PATH}`);
    console.log();

    // ========================================
    // 1. 認證
    // ========================================
    console.log('🔑 步驟 1: Service Account 認證...');
    let credentials: Record<string, unknown>;
    try {
        const keyContent = fs.readFileSync(KEY_PATH, 'utf-8');
        credentials = JSON.parse(keyContent);
        console.log(`  ✅ 讀取金鑰成功 (email: ${credentials.client_email})`);
    } catch (e) {
        console.error(`  ❌ 讀取金鑰失敗: ${e}`);
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ========================================
    // 2. 取得所有工作表名稱
    // ========================================
    console.log('\n📄 步驟 2: 取得工作表清單...');
    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
            fields: 'properties.title,sheets.properties.title',
        });

        const title = res.data.properties?.title;
        const sheetNames = res.data.sheets?.map(s => s.properties?.title) || [];

        console.log(`  ✅ 試算表名稱: "${title}"`);
        console.log(`  ✅ 共 ${sheetNames.length} 個工作表:`);
        sheetNames.forEach((name, i) => {
            console.log(`     ${String(i + 1).padStart(2)}. ${name}`);
        });
    } catch (e: unknown) {
        const err = e as { message?: string };
        console.error(`  ❌ 失敗: ${err.message}`);
        process.exit(1);
    }

    // ========================================
    // 3. 讀取學生資料表
    // ========================================
    console.log('\n👤 步驟 3: 讀取學生資料表（前 5 行）...');
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'114學生資料表'!A1:F5",
        });
        const rows = res.data.values || [];
        console.log(`  ✅ 讀取到 ${rows.length} 行:`);
        rows.forEach((row, i) => {
            console.log(`     [${i}] ${row.slice(0, 6).join(' | ')}`);
        });
    } catch (e: unknown) {
        const err = e as { message?: string };
        console.log(`  ⚠️ 工作表 "114學生資料表" 不存在或格式不同: ${err.message}`);
        console.log('  → 嘗試讀取第一個工作表的前 5 行...');
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'A1:F5',
            });
            const rows = res.data.values || [];
            console.log(`  ✅ 讀取到 ${rows.length} 行:`);
            rows.forEach((row, i) => {
                console.log(`     [${i}] ${row.slice(0, 6).join(' | ')}`);
            });
        } catch (e2: unknown) {
            const err2 = e2 as { message?: string };
            console.error(`  ❌ 第一個工作表也失敗: ${err2.message}`);
        }
    }

    // ========================================
    // 4. 嘗試讀取月份出席紀錄
    // ========================================
    console.log('\n📅 步驟 4: 嘗試讀取出席紀錄...');
    const testSheets = ['2026/02上課紀錄', '2026/01上課紀錄', '2025/12上課紀錄', '2025/11上課紀錄'];

    for (const sheetName of testSheets) {
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${sheetName}'!A1:H3`,
            });
            const rows = res.data.values || [];
            if (rows.length > 0) {
                console.log(`  ✅ "${sheetName}" — ${rows.length} 行範例:`);
                rows.forEach((row, i) => {
                    console.log(`     [${i}] ${row.slice(0, 8).join(' | ')}`);
                });
                break; // 找到一個就行
            }
        } catch {
            console.log(`  ⏭️ "${sheetName}" 不存在，跳過`);
        }
    }

    // ========================================
    // 5. 嘗試讀取計費日期表
    // ========================================
    console.log('\n💰 步驟 5: 嘗試讀取計費日期表...');
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'計費日期表'!A1:F3",
        });
        const rows = res.data.values || [];
        console.log(`  ✅ "計費日期表" — ${rows.length} 行範例:`);
        rows.forEach((row, i) => {
            console.log(`     [${i}] ${row.slice(0, 6).join(' | ')}`);
        });
    } catch {
        console.log('  ⏭️ "計費日期表" 不存在或名稱不同');
    }

    // ========================================
    // 6. 嘗試讀取學費收支總表
    // ========================================
    console.log('\n📊 步驟 6: 嘗試讀取學費收支總表...');
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'學費收支總表'!A1:Q3",
        });
        const rows = res.data.values || [];
        console.log(`  ✅ "學費收支總表" — ${rows.length} 行範例:`);
        rows.forEach((row, i) => {
            console.log(`     [${i}] ${row.join(' | ')}`);
        });
    } catch {
        console.log('  ⏭️ "學費收支總表" 不存在或名稱不同');
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 測試完成！');
    console.log('='.repeat(70));
}

main().catch(console.error);
