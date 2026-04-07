/**
 * 驗證剛剛回寫的 15 筆 Sheet 日期是否與 DB 一致
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });

const TARGET_IDS = ['555','557','585','587','591','631','656','658','662','674','678','681','689'];

function serialToDate(serial: number): Date {
  return new Date((serial - 25569) * 86400 * 1000);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

async function main() {
  // 1. Read Sheet 計費日期表
  const r = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
    range: "'計費日期表'!A:AZ",
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = r.data.values || [];

  // Build sheet data map
  const sheetData = new Map<string, { count: number; dates: { start: string; end: string }[] }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const sid = String(row[0] || '').trim();
    if (!TARGET_IDS.includes(sid)) continue;

    const count = parseInt(String(row[3] || '0'));
    const dates: { start: string; end: string }[] = [];
    for (let j = 0; j < count; j++) {
      const s = row[4 + j * 2];
      const e = row[4 + j * 2 + 1];
      if (typeof s === 'number' && typeof e === 'number') {
        dates.push({ start: fmtDate(serialToDate(s)), end: fmtDate(serialToDate(e)) });
      } else if (typeof s === 'string' && typeof e === 'string') {
        dates.push({ start: s, end: e });
      }
    }
    sheetData.set(sid, { count, dates });
  }

  // 2. Read DB invoices
  const dbInvoices: any[] = await prisma.$queryRaw`
    SELECT e.sheets_id, i.start_date::text, i.end_date::text, i.status, i.amount
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = ANY(${TARGET_IDS})
    ORDER BY e.sheets_id::int, i.start_date
  `;

  // Group DB by sheetsId
  const dbData = new Map<string, { start: string; end: string; status: string }[]>();
  for (const inv of dbInvoices) {
    if (!dbData.has(inv.sheets_id)) dbData.set(inv.sheets_id, []);
    dbData.get(inv.sheets_id)!.push({
      start: inv.start_date,
      end: inv.end_date,
      status: inv.status,
    });
  }

  // 3. Compare
  console.log('\n' + '═'.repeat(100));
  console.log('  Sheet vs DB 日期比對（剛回寫的 13 個學生）');
  console.log('═'.repeat(100));

  let issues = 0;

  for (const sid of TARGET_IDS) {
    const sheet = sheetData.get(sid);
    const db = dbData.get(sid);

    console.log(`\n📋 ID ${sid}  Sheet: ${sheet?.count || 0} 筆  DB: ${db?.length || 0} 筆`);

    if (!sheet || !db) {
      console.log('  ❌ 資料缺失');
      issues++;
      continue;
    }

    // Compare last N entries (the ones we just synced)
    const maxLen = Math.max(sheet.dates.length, db.length);
    for (let i = 0; i < maxLen; i++) {
      const s = sheet.dates[i];
      const d = db[i];

      if (!s && d) {
        console.log(`  [${i+1}] ⬜ Sheet無  DB: ${d.start} ~ ${d.end} [${d.status}]`);
        issues++;
      } else if (s && !d) {
        console.log(`  [${i+1}] 🟦 DB無    Sheet: ${s.start} ~ ${s.end}`);
        issues++;
      } else if (s && d) {
        // Normalize dates for comparison
        const sStart = s.start.replace(/\//g, '-');
        const sEnd = s.end.replace(/\//g, '-');
        const dStart = d.start;
        const dEnd = d.end;

        const startMatch = sStart === dStart;
        const endMatch = sEnd === dEnd;

        if (startMatch && endMatch) {
          console.log(`  [${i+1}] ✅ ${s.start} ~ ${s.end}  [${d.status}]`);
        } else {
          console.log(`  [${i+1}] ❌ Sheet: ${s.start} ~ ${s.end}  DB: ${dStart} ~ ${dEnd} [${d.status}]`);
          issues++;
        }
      }
    }
  }

  console.log('\n' + '═'.repeat(100));
  if (issues === 0) {
    console.log('  ✅ 全部一致！');
  } else {
    console.log(`  ⚠️ 有 ${issues} 處不一致`);
  }
  console.log('═'.repeat(100));

  await prisma.$disconnect();
}

main().catch(console.error);
