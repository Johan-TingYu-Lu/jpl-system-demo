/**
 * 修正剛剛回寫到 Sheet 的日期（UTC 時區偏差 -1 天）
 * 將 Sheet 中最後一筆的日期改為 DB 中的正確日期（Excel serial number）
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const TARGET_IDS = ['555','557','585','587','591','631','656','658','662','674','678','681','689'];

function dateToSerial(d: Date): number {
  return Math.round(d.getTime() / 86400000 + 25569);
}

function toLocalStr(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
}

async function main() {
  // 1. Read Sheet 計費日期表 to find row positions
  const r = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'計費日期表'!A:AZ",
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = r.data.values || [];

  // Map: sheetsId → { rowIdx, count }
  const sheetMap = new Map<string, { rowIdx: number; count: number }>();
  for (let i = 1; i < rows.length; i++) {
    const sid = String(rows[i][0] || '').trim();
    if (TARGET_IDS.includes(sid)) {
      const count = parseInt(String(rows[i][3] || '0'));
      sheetMap.set(sid, { rowIdx: i, count });
    }
  }

  // 2. Read DB invoices (draft with pdf_path) for these students
  const dbInvoices: any[] = await prisma.$queryRaw`
    SELECT e.sheets_id, i.start_date, i.end_date, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = ANY(${TARGET_IDS})
    AND i.status = 'draft'
    AND i.pdf_path IS NOT NULL
    ORDER BY e.sheets_id::int, i.start_date
  `;

  // 3. Build corrections
  const colLetter = (n: number) => {
    let s = '';
    n++;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  };

  const updates: { range: string; values: any[][] }[] = [];

  // Group DB invoices by sheetsId
  const grouped = new Map<string, any[]>();
  for (const inv of dbInvoices) {
    if (!grouped.has(inv.sheets_id)) grouped.set(inv.sheets_id, []);
    grouped.get(inv.sheets_id)!.push(inv);
  }

  for (const sid of TARGET_IDS) {
    const entry = sheetMap.get(sid);
    const invs = grouped.get(sid);
    if (!entry || !invs) continue;

    const rowNum = entry.rowIdx + 1;

    // The invoices we just synced are the last N entries in the sheet
    // We need to overwrite the last invs.length pairs with correct dates
    for (let i = 0; i < invs.length; i++) {
      const inv = invs[i];
      const startSerial = dateToSerial(new Date(inv.start_date));
      const endSerial = dateToSerial(new Date(inv.end_date));

      // Position: the entry is at count - invs.length + i (0-based from the end)
      const pairIdx = entry.count - invs.length + i;
      const colOffset = 4 + pairIdx * 2;

      updates.push({
        range: `'計費日期表'!${colLetter(colOffset)}${rowNum}:${colLetter(colOffset + 1)}${rowNum}`,
        values: [[startSerial, endSerial]],
      });

      console.log(`  ✏️ ${sid} [${pairIdx + 1}/${entry.count}] → ${toLocalStr(inv.start_date)} ~ ${toLocalStr(inv.end_date)} (serial: ${startSerial}, ${endSerial})`);
    }
  }

  if (updates.length === 0) {
    console.log('無需修正');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n寫入 ${updates.length} 筆修正...`);

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  console.log('✅ 修正完成！');
  await prisma.$disconnect();
}

main().catch(console.error);
