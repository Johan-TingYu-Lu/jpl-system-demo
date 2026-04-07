/**
 * 比對 DB 與 Google Sheets 的 2026/04 出勤紀錄
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { google } from 'googleapis';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

function codeToLabel(code: number): string {
  if (code === 3) return 'YY';
  if (code === 2) return 'Y';
  if (code === 1) return 'V';
  return '';
}

async function go() {
  const year = 2026;
  const month = 4;
  const sheetName = `${year}/${String(month).padStart(2, '0')}上課紀錄`;

  console.log('='.repeat(70));
  console.log(`📋 DB vs Sheets 同步比對：${sheetName}`);
  console.log('='.repeat(70));

  // 1. 讀 Google Sheets
  let sheetRows: unknown[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SID,
      range: `'${sheetName}'!A:BZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    sheetRows = (res.data.values as unknown[][]) || [];
  } catch (err) {
    console.error(`❌ 找不到工作表 "${sheetName}":`, err);
    return;
  }

  // 2. 找 header row
  let headerIdx = -1;
  for (let r = 0; r < Math.min(10, sheetRows.length); r++) {
    const val = String(sheetRows[r]?.[0] || '').trim();
    if (val === '識別碼' || val === '識別號') { headerIdx = r; break; }
  }
  if (headerIdx === -1) { console.error('❌ 找不到 header row'); return; }

  // 3. 建立 day → col 映射
  const headerRow = sheetRows[headerIdx];
  const dayColMap = new Map<number, number>(); // col → day
  for (let c = 8; c < (headerRow?.length || 0); c++) {
    const val = headerRow[c];
    const num = typeof val === 'number' ? val : parseInt(String(val || ''));
    if (!isNaN(num) && num >= 1 && num <= 31) dayColMap.set(c, num);
  }
  const uniqueDays = [...new Set(dayColMap.values())].sort((a, b) => a - b);
  console.log(`\nSheets 日期欄: ${uniqueDays.map(d => d + '號').join(', ')}`);

  // 4. 建立 Sheets 資料 map
  const sheetsData = new Map<string, Map<number, string>>(); // sheetsId → { day → status }
  for (let r = headerIdx + 1; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    const sid = String(row[0] || '').trim();
    if (!sid || !/^\d+$/.test(sid)) continue;

    const dayMap = new Map<number, string>();
    for (const [col, day] of dayColMap) {
      const val = String(row[col] || '').trim().toUpperCase();
      if (val === 'YY' || val === 'Y' || val === 'V') dayMap.set(day, val);
    }
    sheetsData.set(sid, dayMap);
  }

  // 5. 讀 DB
  const dbRecords = await prisma.monthlyAttendance.findMany({
    where: { year, month },
    include: { enrollment: { select: { sheetsId: true, person: { select: { name: true } }, className: true, status: true } } },
  });

  console.log(`\nDB 筆數: ${dbRecords.length}`);
  console.log(`Sheets 筆數: ${sheetsData.size}`);

  // 6. 比對
  let matchCount = 0;
  let mismatchCount = 0;
  const mismatches: string[] = [];

  for (const rec of dbRecords) {
    const sid = rec.enrollment.sheetsId;
    const name = rec.enrollment.person.name;
    const sheetDays = sheetsData.get(sid);

    if (!sheetDays) {
      // DB 有但 Sheets 沒有
      const dbNonZero = rec.days.map((v, i) => v > 0 ? `${i+1}日=${codeToLabel(v)}` : null).filter(Boolean);
      if (dbNonZero.length > 0) {
        mismatches.push(`⚠️ ${sid} ${name}: DB有紀錄但Sheets找不到 (DB: ${dbNonZero.join(', ')})`);
        mismatchCount++;
      }
      continue;
    }

    // 比對每天
    for (const day of uniqueDays) {
      const dbVal = codeToLabel(rec.days[day - 1] || 0);
      const sheetVal = sheetDays.get(day) || '';

      if (dbVal !== sheetVal) {
        mismatches.push(`❌ ${sid} ${name} ${day}號: DB=${dbVal || '缺席'} vs Sheets=${sheetVal || '缺席'}`);
        mismatchCount++;
      } else if (dbVal) {
        matchCount++;
      }
    }
  }

  // 7. Sheets 有但 DB 沒有
  for (const [sid, dayMap] of sheetsData) {
    const inDb = dbRecords.find(r => r.enrollment.sheetsId === sid);
    if (!inDb && dayMap.size > 0) {
      const entries = [...dayMap.entries()].map(([d, v]) => `${d}號=${v}`).join(', ');
      mismatches.push(`⚠️ ${sid}: Sheets有紀錄但DB沒有 (${entries})`);
      mismatchCount++;
    }
  }

  console.log(`\n✅ 一致: ${matchCount} 筆`);
  console.log(`❌ 不一致: ${mismatchCount} 筆`);

  if (mismatches.length > 0) {
    console.log('\n--- 差異明細 ---');
    mismatches.forEach(m => console.log(m));
  } else {
    console.log('\n🎉 DB 與 Sheets 完全同步！');
  }

  console.log('\n' + '='.repeat(70));
}

go()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
