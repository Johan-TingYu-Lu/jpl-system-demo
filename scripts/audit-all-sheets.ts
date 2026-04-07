/**
 * audit-all-sheets.ts — 全學年 Sheets vs DB 同步檢核 + 視覺化報表
 *
 * 步驟 1：從 9 個學年 Sheets 拉「計費日期表」，彙總每個學生的收費筆數/日期
 * 步驟 2：從 DB 拉 invoices，比對差異
 * 步驟 3：輸出視覺化矩陣，列出每個學生每筆 invoice 的狀態
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

// ============================================================================
// Config
// ============================================================================

const ALL_SHEETS: Record<string, string> = {
  '106': '1G90xbpj9JC-_3X2vv4i0lfDUmIPrBZsZ94-LKQj_-FE',
  '107': '13iwro7zS4Da_Z6Xnopn6nHlMfOYil-Id5ib2HyUrH2E',
  '108': '1RLv3XuGjeDZd3CEQOh-0Cn2azIJmozkwnI7gDliXC3U',
  '109': '1G7_Y7pDE__l3cpoG8TTbduweRQmIoQIlO7Q9010tb68',
  '110': '1zdzsxq2j17VVjY7gpETBX0kvkrQBAnFuv6MRztkFqa0',
  '111': '1GjCfmj1PiVdqITR1YuqYIf0AP5jHp5inTMoRpbcUGME',
  '112': '1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU',
  '113': '1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps',
  '114': process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
};

// 106 學年格式特殊：col D 不是「應發單次數」而可能是日期
// 106 用「識別碼」, 107 也用「識別碼」+「發單次數」
// 108+ 用「識別號」+「應發單次數」

function serialToDate(serial: number): Date {
  return new Date((serial - 25569) * 86400 * 1000);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function fmtShort(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================================
// Sheet Reader
// ============================================================================

interface SheetInvoice {
  startDate: Date;
  endDate: Date;
}

interface SheetStudentRecord {
  sheetsId: string;
  name: string;
  classInfo: string;
  year: string;           // 學年
  invoiceCount: number;   // 宣告的收費次數
  invoices: SheetInvoice[];
}

async function readAllSheetsData(): Promise<SheetStudentRecord[]> {
  const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const allRecords: SheetStudentRecord[] = [];

  for (const [year, spreadsheetId] of Object.entries(ALL_SHEETS)) {
    console.log(`  讀取 ${year} 學年...`);

    const r = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: "'計費日期表'!A:AZ",
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = r.data.values || [];

    // Detect format by checking header
    const header = rows[0] || [];
    // 106: [識別碼, 姓名, 班別, 1, 1, 2, 2, ...] — no invoiceCount col
    // 107: [識別碼, 姓名, 班別, 發單次數, 1, 1, 2, 2, ...]
    // 108+: [識別號/空, 姓名, 班別, 應發單次數, 1, 1, 2, 2, ...]
    const hasCountCol = typeof header[3] === 'string' &&
      (header[3].includes('次數') || header[3].includes('發單'));
    // For 106: header[3] is just "1" (number), no count column
    const is106Format = !hasCountCol && year === '106';

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const sheetsId = String(row[0] || '').trim();
      if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

      const name = String(row[1] || '').trim();
      const classInfo = String(row[2] || '').trim();

      let invoiceCount: number;
      let dateStartCol: number;

      if (is106Format) {
        // 106: No count column. Dates start at col 3. Count by scanning pairs.
        dateStartCol = 3;
        invoiceCount = 0;
        for (let c = dateStartCol; c < row.length; c += 2) {
          if (typeof row[c] === 'number' && (row[c] as number) > 0 &&
              typeof row[c + 1] === 'number' && (row[c + 1] as number) > 0) {
            invoiceCount++;
          } else {
            break;
          }
        }
      } else {
        // 107+: col 3 = invoice count, dates start at col 4
        invoiceCount = parseInt(String(row[3] || '0'));
        dateStartCol = 4;
      }

      if (invoiceCount <= 0) continue;

      const invoices: SheetInvoice[] = [];
      for (let j = 0; j < invoiceCount; j++) {
        const startSerial = row[dateStartCol + j * 2];
        const endSerial = row[dateStartCol + j * 2 + 1];
        if (typeof startSerial !== 'number' || typeof endSerial !== 'number') continue;
        if (startSerial <= 0 || endSerial <= 0) continue;
        invoices.push({
          startDate: serialToDate(startSerial),
          endDate: serialToDate(endSerial),
        });
      }

      if (invoices.length > 0) {
        allRecords.push({ sheetsId, name, classInfo, year, invoiceCount, invoices });
      }
    }

    console.log(`    → ${allRecords.filter(r => r.year === year).length} 人有收費紀錄`);
  }

  return allRecords;
}

// ============================================================================
// DB Reader
// ============================================================================

interface DbInvoice {
  sheetsId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  amount: number;
  status: string;
}

async function readDbInvoices(): Promise<DbInvoice[]> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const rows: any[] = await prisma.$queryRaw`
    SELECT e.sheets_id, p.name, i.start_date, i.end_date, i.amount, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    ORDER BY e.sheets_id::int, i.start_date
  `;

  await prisma.$disconnect();

  return rows.map(r => ({
    sheetsId: r.sheets_id,
    name: r.name,
    startDate: new Date(r.start_date),
    endDate: new Date(r.end_date),
    amount: r.amount,
    status: r.status,
  }));
}

// ============================================================================
// Comparison & Report
// ============================================================================

interface StudentAudit {
  sheetsId: string;
  name: string;
  classInfo: string;
  sheetEntries: { year: string; startDate: Date; endDate: Date }[];
  dbEntries: { startDate: Date; endDate: Date; amount: number; status: string }[];
}

function buildAudit(sheetData: SheetStudentRecord[], dbData: DbInvoice[]): StudentAudit[] {
  // Group by sheetsId
  const map = new Map<string, StudentAudit>();

  for (const rec of sheetData) {
    let audit = map.get(rec.sheetsId);
    if (!audit) {
      audit = { sheetsId: rec.sheetsId, name: rec.name, classInfo: rec.classInfo, sheetEntries: [], dbEntries: [] };
      map.set(rec.sheetsId, audit);
    }
    // Update name/class to latest
    audit.name = rec.name;
    audit.classInfo = rec.classInfo;
    for (const inv of rec.invoices) {
      audit.sheetEntries.push({ year: rec.year, startDate: inv.startDate, endDate: inv.endDate });
    }
  }

  for (const inv of dbData) {
    let audit = map.get(inv.sheetsId);
    if (!audit) {
      audit = { sheetsId: inv.sheetsId, name: inv.name, classInfo: '?', sheetEntries: [], dbEntries: [] };
      map.set(inv.sheetsId, audit);
    }
    audit.dbEntries.push({ startDate: inv.startDate, endDate: inv.endDate, amount: inv.amount, status: inv.status });
  }

  // Sort by ID
  return [...map.values()].sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function printReport(audits: StudentAudit[]) {
  let totalSheetOnly = 0;
  let totalDbOnly = 0;
  let totalMatch = 0;
  let totalMismatch = 0;
  let studentsWithIssues = 0;

  const lines: string[] = [];

  lines.push('');
  lines.push('═'.repeat(120));
  lines.push('  全學年 Sheets vs DB 同步檢核報表');
  lines.push('═'.repeat(120));

  for (const a of audits) {
    // Match sheet entries to DB entries by startDate+endDate
    const sheetKeys = a.sheetEntries.map(e => `${dateKey(e.startDate)}|${dateKey(e.endDate)}`);
    const dbKeys = a.dbEntries.map(e => `${dateKey(e.startDate)}|${dateKey(e.endDate)}`);

    const sheetSet = new Set(sheetKeys);
    const dbSet = new Set(dbKeys);

    const onlyInSheet = sheetKeys.filter(k => !dbSet.has(k));
    const onlyInDb = dbKeys.filter(k => !sheetSet.has(k));
    const matched = sheetKeys.filter(k => dbSet.has(k));

    totalSheetOnly += onlyInSheet.length;
    totalDbOnly += onlyInDb.length;
    totalMatch += matched.length;

    const hasIssue = onlyInSheet.length > 0 || onlyInDb.length > 0;
    if (hasIssue) studentsWithIssues++;

    // Always show the student (full visual)
    const flag = hasIssue ? '❌' : '✅';
    lines.push('');
    lines.push(`${flag} ID ${a.sheetsId.padStart(3)} ${a.name.padEnd(8)} ${a.classInfo.padEnd(20)} Sheet:${a.sheetEntries.length} DB:${a.dbEntries.length}`);

    // Build timeline: merge all entries, show status
    const timeline: { date: string; type: 'sheet' | 'db' | 'both'; year?: string; amount?: number; status?: string; start: string; end: string }[] = [];

    for (const e of a.sheetEntries) {
      const key = `${dateKey(e.startDate)}|${dateKey(e.endDate)}`;
      const inDb = dbSet.has(key);
      timeline.push({
        date: dateKey(e.startDate),
        type: inDb ? 'both' : 'sheet',
        year: e.year,
        start: fmtDate(e.startDate),
        end: fmtDate(e.endDate),
      });
    }

    for (const e of a.dbEntries) {
      const key = `${dateKey(e.startDate)}|${dateKey(e.endDate)}`;
      if (!sheetSet.has(key)) {
        timeline.push({
          date: dateKey(e.startDate),
          type: 'db',
          amount: e.amount,
          status: e.status,
          start: fmtDate(e.startDate),
          end: fmtDate(e.endDate),
        });
      } else {
        // Supplement matched entries with DB data
        const existing = timeline.find(t => t.start === fmtDate(e.startDate) && t.end === fmtDate(e.endDate));
        if (existing) {
          existing.amount = e.amount;
          existing.status = e.status;
        }
      }
    }

    timeline.sort((a, b) => a.date.localeCompare(b.date));

    for (const t of timeline) {
      let icon: string;
      let detail: string;
      if (t.type === 'both') {
        icon = '  ✓';
        detail = `${t.start} ~ ${t.end}  [${t.year}]  $${t.amount ?? '?'}  ${t.status ?? ''}`;
      } else if (t.type === 'sheet') {
        icon = '  ⬜ Sheet only';
        detail = `${t.start} ~ ${t.end}  [${t.year}]  ← 未匯入DB`;
      } else {
        icon = '  🟦 DB only';
        detail = `${t.start} ~ ${t.end}  $${t.amount}  ${t.status}  ← Sheet無此筆`;
      }
      lines.push(`${icon}  ${detail}`);
    }
  }

  // Summary
  lines.push('');
  lines.push('═'.repeat(120));
  lines.push('  摘要統計');
  lines.push('═'.repeat(120));
  lines.push(`  學生總數:          ${audits.length}`);
  lines.push(`  有問題的學生:      ${studentsWithIssues}`);
  lines.push(`  完全一致:          ${audits.length - studentsWithIssues}`);
  lines.push(`  Sheet ∩ DB 匹配:   ${totalMatch} 筆`);
  lines.push(`  僅在 Sheet:        ${totalSheetOnly} 筆 ← 需匯入DB`);
  lines.push(`  僅在 DB:           ${totalDbOnly} 筆 ← Sheet無對應`);
  lines.push('');

  // Year breakdown
  const yearStats = new Map<string, { sheet: number; matched: number }>();
  for (const a of audits) {
    const dbKeys = new Set(a.dbEntries.map(e => `${dateKey(e.startDate)}|${dateKey(e.endDate)}`));
    for (const e of a.sheetEntries) {
      const key = `${dateKey(e.startDate)}|${dateKey(e.endDate)}`;
      const stat = yearStats.get(e.year) || { sheet: 0, matched: 0 };
      stat.sheet++;
      if (dbKeys.has(key)) stat.matched++;
      yearStats.set(e.year, stat);
    }
  }

  lines.push('  各學年匯入狀態:');
  for (const [year, stat] of [...yearStats.entries()].sort()) {
    const pct = stat.sheet > 0 ? Math.round(stat.matched / stat.sheet * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    lines.push(`    ${year} 學年: ${bar} ${pct}%  (${stat.matched}/${stat.sheet})`);
  }
  lines.push('');

  // Write to file and console
  const output = lines.join('\n');
  console.log(output);

  const reportPath = 'reports/audit-all-sheets.txt';
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(reportPath, output, 'utf-8');
  console.log(`\n📄 報表已寫入 ${reportPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('📋 步驟 1/3: 讀取 9 個學年 Google Sheets...');
  const sheetData = await readAllSheetsData();
  console.log(`  → 共 ${sheetData.length} 筆學生-學年記錄`);

  console.log('\n📋 步驟 2/3: 讀取 DB invoices...');
  const dbData = await readDbInvoices();
  console.log(`  → 共 ${dbData.length} 筆 DB invoices`);

  console.log('\n📋 步驟 3/3: 比對 & 生成報表...');
  const audits = buildAudit(sheetData, dbData);
  printReport(audits);
}

main().catch(console.error);
