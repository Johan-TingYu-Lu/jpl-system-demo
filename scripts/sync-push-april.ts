/**
 * DB → Sheets 出勤紀錄重新推送 (2026/04)
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { google } from 'googleapis';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

function codeToSheetValue(code: number): string {
  if (code === 3) return 'YY';
  if (code === 2) return 'Y';
  if (code === 1) return 'V';
  return '';
}

function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

async function go() {
  const year = 2026;
  const month = 4;
  const sheetName = `${year}/${String(month).padStart(2, '0')}上課紀錄`;

  console.log('='.repeat(70));
  console.log(`🔄 DB → Sheets 重新推送: ${sheetName}`);
  console.log('='.repeat(70));

  // 1. 讀 Sheets header 建立映射
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SID,
    range: `'${sheetName}'!A:BZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const sheetRows = (res.data.values as unknown[][]) || [];

  let headerIdx = -1;
  for (let r = 0; r < Math.min(10, sheetRows.length); r++) {
    const val = String(sheetRows[r]?.[0] || '').trim();
    if (val === '識別碼' || val === '識別號') { headerIdx = r; break; }
  }
  if (headerIdx === -1) { console.error('❌ 找不到 header row'); return; }

  // day → col mapping
  const headerRow = sheetRows[headerIdx];
  const dayToCol = new Map<number, number>(); // day → colIndex
  for (let c = 8; c < (headerRow?.length || 0); c++) {
    const val = headerRow[c];
    const num = typeof val === 'number' ? val : parseInt(String(val || ''));
    if (!isNaN(num) && num >= 1 && num <= 31) {
      if (!dayToCol.has(num)) dayToCol.set(num, c); // 取第一個匹配的欄位
    }
  }

  // sheetsId → rowIndex (1-based)
  const idRowMap = new Map<string, number>();
  for (let r = headerIdx + 1; r < sheetRows.length; r++) {
    const sid = String(sheetRows[r]?.[0] || '').trim();
    if (sid && /^\d+$/.test(sid)) idRowMap.set(sid, r + 1);
  }

  console.log(`\nSheets 日期欄: ${[...dayToCol.keys()].sort((a,b) => a-b).join(', ')}`);
  console.log(`Sheets 學生數: ${idRowMap.size}`);

  // 2. 讀 DB
  const dbRecords = await prisma.monthlyAttendance.findMany({
    where: { year, month },
    include: { enrollment: { select: { sheetsId: true, person: { select: { name: true } } } } },
  });
  console.log(`DB 筆數: ${dbRecords.length}`);

  // 3. 推送
  let pushed = 0;
  let skipped = 0;

  for (const rec of dbRecords) {
    const sid = rec.enrollment.sheetsId;
    const name = rec.enrollment.person.name;
    const row = idRowMap.get(sid);
    if (!row) {
      console.log(`  ⚠️ ${sid} ${name}: Sheets 找不到此學生，跳過`);
      skipped++;
      continue;
    }

    for (const [day, col] of dayToCol) {
      const dbCode = rec.days[day - 1] || 0;
      const displayVal = codeToSheetValue(dbCode);
      
      // 只推送有值的（避免把 Sheets 上有的值清掉）
      if (dbCode > 0) {
        const cellRef = `'${sheetName}'!${colToLetter(col)}${row}`;
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId: SID,
          range: cellRef,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[displayVal]] },
        });
        pushed++;
      }
    }
    
    const nonZero = rec.days.map((v, i) => v > 0 ? `${i+1}日=${codeToSheetValue(v)}` : null).filter(Boolean);
    if (nonZero.length > 0) {
      console.log(`  ✅ ${sid} ${name}: ${nonZero.join(', ')}`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 推送完成！寫入 ${pushed} 個儲存格，跳過 ${skipped} 位學生`);
  console.log('='.repeat(70));
}

go()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
