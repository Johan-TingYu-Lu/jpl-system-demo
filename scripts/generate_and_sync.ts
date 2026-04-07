/**
 * generate_and_sync.ts
 *
 * 用法:
 *   npx tsx scripts/generate_and_sync.ts generate     # 步驟 1: 生成 PDF
 *   npx tsx scripts/generate_and_sync.ts sync          # 步驟 2: 確認後同步 Sheets
 *
 * 流程:
 *   1. generate: 找所有 status='draft' 且 pdf_path 為空的 invoice → 生成 PDF
 *   2. 老師手動校對 PDF
 *   3. sync: 將已校對的 draft invoice 寫入計費日期表
 */

import * as dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';
const KEY_FILE = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-info-sys-4755479c1e25.json`;
const TEMPLATE_PATH = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-app\templates\invoice.tex`;
const OUTPUT_DIR = String.raw`C:\Users\johan\Documents\NEW_SYSTEM\jpl-app\generated_invoices_latex`;
const STAMP_TAX = 'C:/Users/johan/Documents/NEW_SYSTEM/Stamp/印花稅 (1).jpg';
const STAMP_LARGE = 'C:/Users/johan/Documents/NEW_SYSTEM/Stamp/大印數位檔.jpg';
const XELATEX_PATH = 'C:/Users/johan/AppData/Local/Programs/MiKTeX/miktex/bin/x64/xelatex.exe';
const BASE_URL = process.env.VERIFY_BASE_URL || 'https://jpl.app/verify';

function escTex(s: string): string {
  return s.replace(/[&%$#_{}~^\\]/g, c => {
    if (c === '~') return '\\textasciitilde{}';
    if (c === '^') return '\\textasciicircum{}';
    if (c === '\\') return '\\textbackslash{}';
    return `\\${c}`;
  });
}

/**
 * Expand records into display date slots.
 * - 5×YY (no splits): 5 dates, single row, no duplication
 * - Split case: YY=2 slots, Y=1 slot → 10 slots, 2 rows
 */
function expandRecordsToDateSlots(records: { date: string; yUsed: number; isSplit?: boolean }[]): string[] {
  const hasSplit = records.some(r => r.isSplit);
  if (!hasSplit) {
    return records.map(r => r.date);
  }
  const slots: string[] = [];
  for (const r of records) {
    slots.push(r.date);
    if (r.yUsed === 2) {
      slots.push(r.date);
    }
  }
  return slots;
}

function buildDateTable(dateSlots: string[], includeHeader: boolean): string {
  const displayDates = [...dateSlots];
  while (displayDates.length % 5 !== 0) displayDates.push('');

  let rows = '';
  for (let i = 0; i < displayDates.length; i += 5) {
    rows += displayDates.slice(i, i + 5)
      .map(d => d ? `\\large\\textbf{${d}}` : '')
      .join(' & ') + ' \\\\\n\\hline\n';
  }

  const header = includeHeader
    ? '\\multicolumn{5}{|c|}{\\Large\\textbf{上課紀錄}} \\\\\n\\hline\n'
    : '';

  return `\\begin{tabular}{|*{5}{>{\\centering\\arraybackslash}p{3.1cm}|}}\n\\hline\n${header}${rows}\\end{tabular}`;
}

/**
 * Generate split note text.
 * Only note the END split (remainder goes to next period).
 * START split (carried from previous) does NOT need a note.
 */
function buildSplitNote(records: { date: string; yUsed: number; isSplit?: boolean }[]): string | null {
  const lastRec = records[records.length - 1];

  if (lastRec.isSplit) {
    const mm_dd = lastRec.date.split('/').slice(1).join('/');
    return `(註：${mm_dd}上課3小時，計費1.5hr，尚有1.5hr未記入本次收費，下次收取)`;
  }

  return null;
}

async function generatePdfs() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Find all draft invoices without pdf_path
  const { rows: invoices } = await client.query(`
    SELECT i.id, i.serial_number, i.hash_code, i.start_date, i.end_date,
           i.amount, i.records, i.note, i.issued_date,
           e.sheets_id, e.class_code, e.subject,
           p.name as student_name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.status = 'draft' AND (i.pdf_path IS NULL OR i.pdf_path = '')
    ORDER BY e.sheets_id::int, e.class_code
  `);

  if (invoices.length === 0) {
    console.log('沒有需要生成的 PDF');
    await client.end();
    return;
  }

  console.log(`找到 ${invoices.length} 張待生成 PDF:\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  let success = 0;
  let failed = 0;

  for (const inv of invoices) {
    const records = inv.records as { date: string; status: number; yUsed: number; fee: number; isSplit?: boolean }[];
    if (!records || records.length === 0) {
      console.log(`  ⚠️ ${inv.sheets_id}_${inv.class_code}: 沒有 records，跳過`);
      failed++;
      continue;
    }

    const dates = records.map(r => r.date);
    const months = [...new Set(dates.map(d => d.split('/')[1]))].sort();
    const billYear = dates[0].split('/')[0];
    const billMonth = months.length > 1 ? `${months[0]}-${months[months.length - 1]}` : months[0];

    // Always 5次15H (10Y = 5 sessions × 3hr)
    const sessionInfoText = '5次15H';

    // Expand records to date slots: YY=2 slots, Y=1 slot
    const dateSlots = expandRecordsToDateSlots(records);

    // Generate split note
    const splitNote = buildSplitNote(records);

    const issuedDate = new Date().toISOString().slice(0, 10).replace(/-/g, '/');

    const receiptText = `茲\\hspace{0.5em}收到\\hspace{0.3em}貴子弟\\hspace{0.3em}\\textbf{${escTex(inv.student_name)}}，${billYear}年 ${billMonth} 月 課程費用 ${inv.amount} 元整。`;

    let tex = template;
    const replacements: [string, string][] = [
      ['<<SERIAL>>', escTex(inv.serial_number)],
      ['<<HASH>>', inv.hash_code],
      ['<<NAME>>', escTex(inv.student_name)],
      ['<<SUBJECT>>', escTex(inv.subject)],
      ['<<BILLING_DATE>>', issuedDate],
      ['<<TOTAL_FEE>>', `${inv.amount}`],
      ['<<SESSION_INFO>>', sessionInfoText],
      ['<<RECEIPT_TEXT>>', receiptText],
      ['<<BILL_YEAR>>', billYear],
      ['<<QR_URL>>', `${BASE_URL}/${inv.hash_code}`],
      ['<<STAMP_TAX_PATH>>', STAMP_TAX],
      ['<<STAMP_LARGE_PATH>>', STAMP_LARGE],
    ];

    for (const [ph, val] of replacements) {
      tex = tex.replaceAll(ph, val);
    }

    tex = tex.replace('<<DATE_TABLE_TOP>>', buildDateTable(dateSlots, true));
    tex = tex.replace('<<DATE_TABLE_BOTTOM>>', buildDateTable(dateSlots, false));

    // Split note (auto-generated) takes priority, fallback to DB note
    const noteText = splitNote || (inv.note ? inv.note : null);
    if (noteText) {
      tex = tex.replace('% <<NOTE_PLACEHOLDER>>', `\\vspace{2mm}\n\\begin{center}\\large ${escTex(noteText)}\\end{center}`);
    } else {
      tex = tex.replace('% <<NOTE_PLACEHOLDER>>', '');
    }

    const baseName = `${inv.sheets_id}_${inv.class_code}_${issuedDate.replace(/\//g, '')}`;
    const texPath = path.join(OUTPUT_DIR, `${baseName}.tex`);
    const pdfPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);

    fs.writeFileSync(texPath, tex, 'utf-8');

    try {
      execSync(
        `"${XELATEX_PATH}" -interaction=nonstopmode -output-directory="${OUTPUT_DIR}" "${texPath}"`,
        { timeout: 120000, stdio: 'pipe' }
      );
      // Clean aux files
      for (const ext of ['.aux', '.log', '.out']) {
        const f = path.join(OUTPUT_DIR, `${baseName}${ext}`);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }

      // Update DB with pdf_path
      await client.query('UPDATE invoices SET pdf_path = $1 WHERE id = $2', [pdfPath, inv.id]);

      console.log(`  ✅ ${inv.sheets_id}_${inv.class_code} → ${baseName}.pdf`);
      for (const r of records) {
        const label = r.isSplit ? '(拆分)' : '';
        console.log(`     ${r.date} ${r.status === 3 ? 'YY' : 'Y'} $${r.fee} ${label}`);
      }
      success++;
    } catch (e: any) {
      const logPath = path.join(OUTPUT_DIR, `${baseName}.log`);
      const logTail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-500) : 'no log';
      console.log(`  ❌ ${inv.sheets_id}_${inv.class_code}: 編譯失敗`);
      console.log(`     ${logTail.split('\n').slice(-5).join('\n     ')}`);
      failed++;
    }
  }

  console.log(`\n結果: ${success} 成功, ${failed} 失敗`);
  console.log(`輸出目錄: ${OUTPUT_DIR}`);
  console.log('\n請校對 PDF 後執行: npx tsx scripts/generate_and_sync.ts sync');

  await client.end();
}

async function syncToSheets(onlyIds?: string[]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Find draft invoices WITH pdf_path that haven't been synced yet
  // We check by looking at invoices whose pdf_path exists and status is still 'draft'
  const { rows: invoices } = await client.query(`
    SELECT i.id, i.serial_number, i.start_date, i.end_date, i.amount, i.pdf_path,
           e.sheets_id, e.class_code
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    WHERE i.status = 'draft' AND i.pdf_path IS NOT NULL AND i.pdf_path != ''
    ORDER BY e.sheets_id::int, e.class_code
  `);

  if (invoices.length === 0) {
    console.log('沒有需要同步的 invoice');
    await client.end();
    return;
  }

  // Read 計費日期表
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: '計費日期表!A:Z',
  });
  const sheetRows = res.data.values || [];

  // Build map: sheetsId -> { rowIdx, currentCount, existingDates }
  const sheetMap = new Map<string, { rowIdx: number; currentCount: number; existingDates: string[] }>();
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const sheetsId = row[0]?.toString().trim();
    if (!sheetsId) continue;
    const count = parseInt(row[3]) || 0;
    const dates = row.slice(4).filter((d: string) => d && d.trim());
    sheetMap.set(sheetsId, { rowIdx: i, currentCount: count, existingDates: dates });
  }

  const updates: { range: string; values: any[][] }[] = [];
  let synced = 0;
  const colLetter = (n: number) => {
    let s = '';
    n++;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  };

  for (const inv of invoices) {
    // --only filter: skip if not in the list
    if (onlyIds && !onlyIds.includes(inv.sheets_id)) continue;

    const entry = sheetMap.get(inv.sheets_id);
    if (!entry) {
      console.log(`  ⚠️ ${inv.sheets_id}_${inv.class_code}: 不在計費日期表中`);
      continue;
    }

    // 用本地時間避免 UTC 時區偏差（台灣 UTC+8）
    const toLocalStr = (d: Date | string): string => {
      const dt = d instanceof Date ? d : new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}/${m}/${day}`;
    };
    const startStr = toLocalStr(inv.start_date);
    const endStr = toLocalStr(inv.end_date);

    // Check if already synced
    if (entry.existingDates.includes(endStr)) {
      console.log(`  skip ${inv.sheets_id}_${inv.class_code}: ${endStr} already in sheet`);
      continue;
    }

    const newCount = entry.currentCount + 1;
    const colOffset = 4 + entry.existingDates.length;
    const rowNum = entry.rowIdx + 1;

    updates.push({
      range: `計費日期表!D${rowNum}`,
      values: [[newCount]],
    });
    updates.push({
      range: `計費日期表!${colLetter(colOffset)}${rowNum}:${colLetter(colOffset + 1)}${rowNum}`,
      values: [[startStr, endStr]],
    });

    console.log(`  ✅ ${inv.sheets_id}_${inv.class_code}: row=${rowNum} count=${entry.currentCount}→${newCount} ${startStr}~${endStr}`);
    synced++;
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
    console.log(`\n✅ Sheets 同步完成: ${synced} 筆, ${updates.length} cells`);
  } else {
    console.log('\n全部已同步，無需更新');
  }

  await client.end();
}

// Main
const command = process.argv[2];
if (command === 'generate') {
  generatePdfs().catch(console.error);
} else if (command === 'sync') {
  // --only 546,579,611 → only sync these sheets_ids
  const onlyIdx = process.argv.indexOf('--only');
  const onlyIds = onlyIdx !== -1 && process.argv[onlyIdx + 1]
    ? process.argv[onlyIdx + 1].split(',').map(s => s.trim())
    : undefined;
  if (onlyIds) {
    console.log(`篩選模式: 只同步 ${onlyIds.join(', ')}\n`);
  }
  syncToSheets(onlyIds).catch(console.error);
} else {
  console.log('用法:');
  console.log('  npx tsx scripts/generate_and_sync.ts generate          # 生成 PDF');
  console.log('  npx tsx scripts/generate_and_sync.ts sync               # 同步全部到 Sheets');
  console.log('  npx tsx scripts/generate_and_sync.ts sync --only 546,579  # 只同步指定 sheets_id');
}
