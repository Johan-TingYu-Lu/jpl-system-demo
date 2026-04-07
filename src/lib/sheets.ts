/**
 * Google Sheets API Wrapper (v4 schema)
 * 使用 Service Account key file 驗證
 */
import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';

let sheetsInstance: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
    if (sheetsInstance) return sheetsInstance;

    // 支援兩種方式：
    // 1. GOOGLE_SERVICE_ACCOUNT_KEY — JSON 字串（Cloud Run 用）
    // 2. GOOGLE_SERVICE_ACCOUNT_KEY_PATH — 檔案路徑（本地開發用）
    let credentials: Record<string, unknown>;
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (keyJson) {
        credentials = JSON.parse(keyJson);
    } else {
        const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
        if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_PATH must be set');
        credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    }

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    });

    sheetsInstance = google.sheets({ version: 'v4', auth });
    return sheetsInstance;
}

function getSpreadsheetId(): string {
    const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!id) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set');
    return id;
}

/**
 * 讀取指定 range 的資料
 */
export async function readSheet(
    range: string,
    spreadsheetId?: string
): Promise<unknown[][]> {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId || getSpreadsheetId(),
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return (res.data.values as unknown[][]) || [];
}

/**
 * 寫入資料到指定 range
 */
export async function writeSheet(
    range: string,
    values: unknown[][],
    spreadsheetId?: string
): Promise<void> {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId || getSpreadsheetId(),
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });
}

/**
 * 取得所有工作表名稱
 */
export async function listSheetNames(spreadsheetId?: string): Promise<string[]> {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId || getSpreadsheetId(),
        fields: 'sheets.properties.title',
    });
    return res.data.sheets?.map(s => s.properties?.title || '') || [];
}

/**
 * 取得試算表標題
 */
export async function getSpreadsheetTitle(spreadsheetId?: string): Promise<string> {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId || getSpreadsheetId(),
        fields: 'properties.title',
    });
    return res.data.properties?.title || '';
}

/**
 * 附加資料到指定範圍的結尾 (Append)
 */
export async function appendSheet(
    range: string,
    values: unknown[][],
    spreadsheetId?: string
): Promise<void> {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId || getSpreadsheetId(),
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
    });
}
