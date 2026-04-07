/**
 * sheets-push.ts — 推送計費/繳費資料回 Google Sheets
 *
 * 功能：
 * 1. pushBillingDates()  — 生成收費單後，寫入計費日期表（起始/結束日期）
 * 2. pushPayment()       — 銷帳後，寫入繳費金額表 + 繳費日期表
 * 3. revertBillingDates() — 復原時，清除計費日期表最後一筆
 * 4. revertPayment()      — 復原銷帳時，清除繳費金額表 + 繳費日期表最後一筆
 *
 * 每個推送函式都包含：
 * - 合併寫入（一次 API call 寫多格，確保原子性）
 * - 寫入後驗證（讀回比對）
 * - 失敗自動重試 1 次
 */

import { readSheet, writeSheet } from './sheets';
import { getYearConfig } from './year-config';

export interface PushResult {
  success: boolean;
  verified: boolean;
  error?: string;
}

// ============================================================================
// Date conversion: JS Date → Excel serial number
// ============================================================================

/** Date → Excel serial number (inverse of serialToDate) */
function dateToSerial(d: Date): number {
  const utcDays = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  return utcDays + 25569;
}

// ============================================================================
// Helper: find student row in a sheet
// ============================================================================

async function findStudentRow(
  sheetName: string,
  sheetsId: string,
  spreadsheetId: string,
  idCol: number = 0,
): Promise<{ rowIndex: number; rowData: unknown[] } | null> {
  const rows = await readSheet(`'${sheetName}'!A:BZ`, spreadsheetId);
  for (let i = 0; i < rows.length; i++) {
    const cellVal = String(rows[i][idCol] ?? '').trim();
    if (cellVal === sheetsId) {
      return { rowIndex: i, rowData: rows[i] };
    }
  }
  return null;
}

/** Convert column index to A1 notation (0=A, 1=B, ..., 25=Z, 26=AA, ...) */
function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

// ============================================================================
// Helper: delay
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Helper: write + verify + retry
// ============================================================================

/**
 * 寫入一段連續範圍，驗證讀回值，失敗重試 1 次。
 * @param range  A1 範圍（如 '計費日期表'!E5:F5）
 * @param values 寫入值（單行，如 [[46093, 46114]]）
 * @param spreadsheetId
 * @returns PushResult
 */
async function writeAndVerify(
  range: string,
  values: unknown[][],
  spreadsheetId: string,
): Promise<PushResult> {
  const maxRetries = 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 寫入
      await writeSheet(range, values, spreadsheetId);

      // 延遲後讀回驗證
      await delay(500);
      const readBack = await readSheet(range, spreadsheetId);
      const expected = values[0];
      const actual = readBack[0] ?? [];

      // 比對每個 cell
      let match = true;
      for (let i = 0; i < expected.length; i++) {
        const exp = expected[i];
        const act = actual[i];
        // 空值清除：expected '' 對應 actual undefined/null/''
        if (exp === '' || exp === null) {
          if (act !== undefined && act !== null && act !== '') {
            match = false;
            break;
          }
        } else if (Number(exp) !== Number(act)) {
          match = false;
          break;
        }
      }

      if (match) {
        return { success: true, verified: true };
      }

      // 驗證失敗，重試前等 1 秒
      if (attempt < maxRetries) {
        console.warn(`[sheets-push] Verify mismatch for ${range}, retrying... (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
        await delay(1000);
      } else {
        return {
          success: true,
          verified: false,
          error: `Verify failed after retry: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        };
      }
    } catch (e) {
      if (attempt < maxRetries) {
        console.warn(`[sheets-push] Write failed for ${range}, retrying...`, e);
        await delay(1000);
      } else {
        return { success: false, verified: false, error: String(e) };
      }
    }
  }

  return { success: false, verified: false, error: 'Unexpected: exited retry loop' };
}

// ============================================================================
// 1. Push billing dates after invoice generation
// ============================================================================

export async function pushBillingDates(params: {
  sheetsId: string;
  academicYear: number;
  startDate: Date;
  endDate: Date;
  invoiceCount: number;  // 這是新的總次數（含此次）
}): Promise<PushResult> {
  const config = getYearConfig(params.academicYear);
  if (!config) return { success: false, verified: false, error: `No config for year ${params.academicYear}` };

  const fmt = config.billingDate;
  const sheetName = '計費日期表';

  const found = await findStudentRow(sheetName, params.sheetsId, config.spreadsheetId, fmt.idCol);
  if (!found) return { success: false, verified: false, error: `Student ${params.sheetsId} not found in ${sheetName}` };

  const row = found.rowIndex + 1;

  // 合併寫入：一次寫入 startDate + endDate（連續兩格）
  const pairIndex = params.invoiceCount - 1;
  const startCol = fmt.datePairsStartCol + pairIndex * 2;
  const endCol = startCol + 1;

  const startSerial = dateToSerial(params.startDate);
  const endSerial = dateToSerial(params.endDate);

  const range = `'${sheetName}'!${colToLetter(startCol)}${row}:${colToLetter(endCol)}${row}`;
  return writeAndVerify(range, [[startSerial, endSerial]], config.spreadsheetId);
}

// ============================================================================
// 2. Push payment after 銷帳
// ============================================================================

export async function pushPayment(params: {
  sheetsId: string;
  academicYear: number;
  amount: number;
  paymentDate: Date;
  paymentCount: number;
}): Promise<PushResult> {
  const config = getYearConfig(params.academicYear);
  if (!config) return { success: false, verified: false, error: `No config for year ${params.academicYear}` };

  const spreadsheetId = config.spreadsheetId;

  // --- 繳費金額表 ---
  const amtFmt = config.feeAmount;
  const amtSheet = '繳費金額表';
  const amtFound = await findStudentRow(amtSheet, params.sheetsId, spreadsheetId, amtFmt.idCol);
  if (!amtFound) return { success: false, verified: false, error: `Student ${params.sheetsId} not found in ${amtSheet}` };

  const amtRow = amtFound.rowIndex + 1;
  const amtCol = amtFmt.amountsStartCol + (params.paymentCount - 1);
  const amtRange = `'${amtSheet}'!${colToLetter(amtCol)}${amtRow}`;
  const amtResult = await writeAndVerify(amtRange, [[params.amount]], spreadsheetId);
  if (!amtResult.success) return amtResult;

  // --- 繳費日期表 ---
  const dateFmt = config.paymentDate;
  const dateSheet = '繳費日期表';
  const dateFound = await findStudentRow(dateSheet, params.sheetsId, spreadsheetId, dateFmt.idCol);
  if (!dateFound) return { success: false, verified: false, error: `Student ${params.sheetsId} not found in ${dateSheet}` };

  const dateRow = dateFound.rowIndex + 1;
  const dateCol = dateFmt.datesStartCol + (params.paymentCount - 1);
  const dateRange = `'${dateSheet}'!${colToLetter(dateCol)}${dateRow}`;
  const paySerial = dateToSerial(params.paymentDate);
  const dateResult = await writeAndVerify(dateRange, [[paySerial]], spreadsheetId);

  // 兩個都要成功才算 verified
  return {
    success: true,
    verified: amtResult.verified && dateResult.verified,
    error: !dateResult.verified ? dateResult.error : undefined,
  };
}

// ============================================================================
// 3. Revert billing dates (復原收費單)
// ============================================================================

export async function revertBillingDates(params: {
  sheetsId: string;
  academicYear: number;
  previousCount: number;
}): Promise<PushResult> {
  const config = getYearConfig(params.academicYear);
  if (!config) return { success: false, verified: false, error: `No config for year ${params.academicYear}` };

  const fmt = config.billingDate;
  const sheetName = '計費日期表';

  const found = await findStudentRow(sheetName, params.sheetsId, config.spreadsheetId, fmt.idCol);
  if (!found) return { success: false, verified: false, error: `Student ${params.sheetsId} not found in ${sheetName}` };

  const row = found.rowIndex + 1;

  // 合併清除：一次寫入空值到連續兩格
  const pairIndex = params.previousCount;
  const startCol = fmt.datePairsStartCol + pairIndex * 2;
  const endCol = startCol + 1;

  const range = `'${sheetName}'!${colToLetter(startCol)}${row}:${colToLetter(endCol)}${row}`;
  return writeAndVerify(range, [['', '']], config.spreadsheetId);
}

// ============================================================================
// 4. Revert payment (復原銷帳)
// ============================================================================

export async function revertPayment(params: {
  sheetsId: string;
  academicYear: number;
  previousCount: number;
}): Promise<PushResult> {
  const config = getYearConfig(params.academicYear);
  if (!config) return { success: false, verified: false, error: `No config for year ${params.academicYear}` };

  const spreadsheetId = config.spreadsheetId;

  // --- 繳費金額表 ---
  const amtFmt = config.feeAmount;
  const amtSheet = '繳費金額表';
  const amtFound = await findStudentRow(amtSheet, params.sheetsId, spreadsheetId, amtFmt.idCol);
  let amtVerified = true;
  if (amtFound) {
    const amtRow = amtFound.rowIndex + 1;
    const amtCol = amtFmt.amountsStartCol + params.previousCount;
    const amtRange = `'${amtSheet}'!${colToLetter(amtCol)}${amtRow}`;
    const amtResult = await writeAndVerify(amtRange, [['']], spreadsheetId);
    amtVerified = amtResult.verified;
  }

  // --- 繳費日期表 ---
  const dateFmt = config.paymentDate;
  const dateSheet = '繳費日期表';
  const dateFound = await findStudentRow(dateSheet, params.sheetsId, spreadsheetId, dateFmt.idCol);
  let dateVerified = true;
  if (dateFound) {
    const dateRow = dateFound.rowIndex + 1;
    const dateCol = dateFmt.datesStartCol + params.previousCount;
    const dateRange = `'${dateSheet}'!${colToLetter(dateCol)}${dateRow}`;
    const dateResult = await writeAndVerify(dateRange, [['']], spreadsheetId);
    dateVerified = dateResult.verified;
  }

  return { success: true, verified: amtVerified && dateVerified };
}

// ============================================================================
// 5. Add new student to master sheet
// ============================================================================

export async function pushNewStudentToSheets(data: {
  sheetsId: string;
  name: string;
  className: string;
  phone?: string;
  englishName?: string;
  nickname?: string;
  birthday?: string;
  gender?: string;
  fb?: string;
  lineId?: string;
  contactName?: string;
  contactRelation?: string;
  contactPhone?: string;
  contactFb?: string;
  highSchool?: string;
  highSchoolYear?: string;
  juniorHigh?: string;
  juniorHighYear?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { appendSheet } = await import('./sheets');

    const row = [
      data.sheetsId,                // [A] 識別號
      data.name,                    // [B] 姓名
      data.className,               // [C] 班別
      data.englishName || '',       // [D] 英文名
      data.nickname || '',          // [E] 暱稱
      data.birthday || '',          // [F] 生日
      data.gender || '',            // [G] 性別
      data.phone || '',             // [H] 連絡電話
      data.fb || '',                // [I] FB
      data.lineId || '',            // [J] LINE
      '',                           // [K] (空)
      data.contactName || '',       // [L] 第一聯絡人
      data.contactRelation || '',   // [M] 關係
      data.contactPhone || '',      // [N] 電話
      data.contactFb || '',         // [O] FB
      data.highSchool || '',        // [P] 高中
      data.highSchoolYear || '',    // [Q] 高中屆次
      data.juniorHigh || '',        // [R] 國中
      data.juniorHighYear || '',    // [S] 國中屆次
      data.notes || '',             // [T] 註記
      '',                           // [U] (空)
      ''                            // [V] 高一班級
    ];

    await appendSheet(`'歷年學生資料總表'!A:V`, [row]);

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
