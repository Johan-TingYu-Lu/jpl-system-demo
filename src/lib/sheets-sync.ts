/**
 * sheets-sync.ts — DB→Sheets 推送同步
 *
 * 反方向的 sync-engine.ts（Sheets→DB）。
 * 將收費單狀態、學生狀態、出勤紀錄回寫到 Google Sheets。
 */
import prisma from './prisma';
import { writeSheet, readSheet, listSheetNames } from './sheets';
import { getYearConfig, calendarYearToAcademicYear } from './year-config';
import { ACTIVE_STATUS_FILTER } from './enrollment-status';

/**
 * Sync invoice status back to Google Sheets (學費收支總表).
 */
export async function syncInvoiceStatus(): Promise<{ updated: number }> {
  const rows = await readSheet("'學費收支總表'!A:M");
  const rowMap = new Map<string, number>();
  for (let r = 1; r < rows.length; r++) {
    const sid = String((rows[r] as unknown[])[0] || '').trim();
    if (sid) rowMap.set(sid, r);
  }

  const enrollments = await prisma.enrollment.findMany({
    where: ACTIVE_STATUS_FILTER,
    select: {
      sheetsId: true,
      invoices: {
        select: { status: true, amount: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  let updated = 0;
  for (const e of enrollments) {
    const rowIdx = rowMap.get(e.sheetsId);
    if (rowIdx === undefined) continue;

    const totalInvoices = e.invoices.length;
    const paidCount = e.invoices.filter(i => i.status === 'paid').length;
    const pendingCount = e.invoices.filter(i => i.status === 'pending').length;

    await writeSheet(
      `'學費收支總表'!K${rowIdx + 1}:M${rowIdx + 1}`,
      [[totalInvoices, paidCount, pendingCount]]
    );
    updated++;
  }

  return { updated };
}

// ============================================================================
// 出勤紀錄回寫 Sheets
// ============================================================================

function codeToSheetValue(code: number): string {
  switch (code) {
    case 3: return 'YY';
    case 2: return 'Y';
    case 1: return 'V';
    default: return '';
  }
}

/**
 * 將單日點名結果回寫到 Google Sheets 的 YYYY/MM上課紀錄 工作表。
 *
 * @param year  西元年（如 2026）
 * @param month 月份（如 3）
 * @param day   日（如 19）
 * @param entries 每位學生的出勤狀態 [{ sheetsId, status }]
 */
export async function pushAttendanceToSheets(
  year: number,
  month: number,
  day: number,
  entries: { sheetsId: string; status: number }[]
): Promise<{ updated: number; sheetName: string }> {
  // 1. 決定學年 → 取 spreadsheetId
  const academicYear = calendarYearToAcademicYear(year, month);
  const config = getYearConfig(academicYear);
  if (!config) throw new Error(`No config for academic year ${academicYear}`);

  // 2. 構建工作表名稱 "YYYY/MM上課紀錄"
  const sheetName = `${year}/${String(month).padStart(2, '0')}上課紀錄`;

  // 3. 確認工作表存在
  const allSheets = await listSheetNames(config.spreadsheetId);
  if (!allSheets.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in spreadsheet ${academicYear}`);
  }

  // 4. 讀取工作表內容以建立 row/col mapping
  const rows = await readSheet(`'${sheetName}'!A:BZ`, config.spreadsheetId);
  if (rows.length < 4) throw new Error(`Sheet "${sheetName}" has insufficient rows`);

  // 5. 找 header row（識別碼/識別號）
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const val = String(rows[r]?.[config.attendance.idCol] || '').trim();
    if (val === '識別碼' || val === '識別號') {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error(`Header row not found in "${sheetName}"`);

  // 6. 建立 day → column index 映射
  const headerRow = rows[headerRowIdx];
  let dayCol = -1;
  for (let c = config.attendance.dayColStart; c < (headerRow?.length || 0); c++) {
    const val = headerRow[c];
    const num = typeof val === 'number' ? val : parseInt(String(val || ''));
    if (num === day) {
      dayCol = c;
      break;
    }
  }
  if (dayCol === -1) throw new Error(`Day column for day ${day} not found in "${sheetName}"`);

  // 7. 建立 sheetsId → row index 映射
  const idRowMap = new Map<string, number>();
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const sid = String(rows[r]?.[config.attendance.idCol] || '').trim();
    if (sid && /^\d+$/.test(sid)) {
      idRowMap.set(sid, r);
    }
  }

  // 8. 逐筆回寫
  let updated = 0;
  // 將 column index 轉成 A1 notation 的欄位字母
  const colLetter = columnToLetter(dayCol);

  for (const entry of entries) {
    const rowIdx = idRowMap.get(entry.sheetsId);
    if (rowIdx === undefined) continue;

    const cellRef = `'${sheetName}'!${colLetter}${rowIdx + 1}`;
    const displayValue = codeToSheetValue(entry.status);
    await writeSheet(cellRef, [[displayValue]], config.spreadsheetId);
    updated++;
  }

  return { updated, sheetName };
}

/** 將 0-based column index 轉成 A1 notation 字母（A, B, ..., Z, AA, AB, ...） */
function columnToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

// ============================================================================
// 學生狀態回寫
// ============================================================================

/**
 * Sync student enrollment status back to Sheets.
 */
export async function syncStudentStatus(): Promise<{ updated: number }> {
  const rows = await readSheet("'114學生資料表'!A:V");
  const enrollments = await prisma.enrollment.findMany({
    select: { sheetsId: true, status: true },
  });

  const statusMap = new Map(enrollments.map(e => [e.sheetsId, e.status]));
  let updated = 0;

  for (let r = 1; r < rows.length; r++) {
    const sid = String((rows[r] as unknown[])[0] || '').trim();
    const dbStatus = statusMap.get(sid);
    if (!dbStatus) continue;

    await writeSheet(`'114學生資料表'!C${r + 1}`, [[dbStatus]]);
    updated++;
  }

  return { updated };
}
