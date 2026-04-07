/**
 * serial-utils.ts — 流水號工具
 *
 * 收費單流水號格式：{年碼}-{學號末3碼}-{月份}-{科目代碼}-{序號}
 * 範例：26-542-03-N-01
 *
 * 歷年差異：
 *   - 114 學年：年碼 = "26"（2026 末兩碼）
 *   - 歷年匯入：年碼由 year-config.ts 的 serialYearCode 決定
 *   - 歷史 invoices 不生成 PDF，僅需 DB 紀錄用流水號
 */
import * as crypto from 'crypto';
import { getYearConfig, inferAcademicYear } from './year-config';

// ============================================================================
// Types
// ============================================================================

export interface ParsedSerial {
  yearCode: string;      // "26"
  studentCode: string;   // "542"
  month: string;         // "03"
  classCode: string;     // "N" or "M"
  sequence: string;      // "01"
}

// ============================================================================
// Parse
// ============================================================================

/**
 * 解析流水號字串
 * 格式: YY-SSS-MM-C-NN
 */
export function parseSerial(serial: string): ParsedSerial | null {
  const parts = serial.split('-');
  if (parts.length !== 5) return null;

  const [yearCode, studentCode, month, classCode, sequence] = parts;

  if (!/^\d{2}$/.test(yearCode)) return null;
  if (!/^\d{2,3}$/.test(studentCode)) return null;
  if (!/^\d{2}$/.test(month)) return null;
  if (!/^[A-Z]$/.test(classCode)) return null;
  if (!/^\d{2}$/.test(sequence)) return null;

  return { yearCode, studentCode, month, classCode, sequence };
}

// ============================================================================
// Generate
// ============================================================================

/**
 * 生成流水號
 *
 * @param yearCode    - 年碼（如 "26"）
 * @param sheetsId    - 學號（如 "542"）
 * @param month       - 月份（如 3）
 * @param classCode   - 科目（如 "N"）
 * @param sequence    - 序號（如 1）
 */
export function makeSerial(
  yearCode: string,
  sheetsId: string,
  month: number,
  classCode: string,
  sequence: number
): string {
  const shortId = sheetsId.slice(-3).padStart(3, '0');
  const monthStr = String(month).padStart(2, '0');
  const seqStr = String(sequence).padStart(2, '0');
  return `${yearCode}-${shortId}-${monthStr}-${classCode}-${seqStr}`;
}

/**
 * 根據日期自動推斷年碼後生成流水號
 */
export function makeSerialFromDate(
  startDate: Date,
  sheetsId: string,
  classCode: string,
  sequence: number
): string {
  const academicYear = inferAcademicYear(startDate);
  const config = getYearConfig(academicYear);
  const yearCode = config?.serialYearCode ?? String(startDate.getFullYear() % 100).padStart(2, '0');
  const month = startDate.getMonth() + 1;
  return makeSerial(yearCode, sheetsId, month, classCode, sequence);
}

/**
 * 為歷史匯入的 invoice 生成流水號
 * 歷史 invoice 沒有流水號，用 "H{年碼}-{學號}-{序號}" 格式
 */
export function makeHistoricalSerial(
  academicYear: number,
  sheetsId: string,
  classCode: string,
  sequence: number
): string {
  const config = getYearConfig(academicYear);
  const yearCode = config?.serialYearCode ?? String((academicYear + 1911) % 100).padStart(2, '0');
  const shortId = sheetsId.slice(-3).padStart(3, '0');
  const seqStr = String(sequence).padStart(2, '0');
  return `H${yearCode}-${shortId}-${classCode}-${seqStr}`;
}

// ============================================================================
// Hash
// ============================================================================

/**
 * 生成防偽 hash（SHA-256 前 8 碼大寫）
 */
export function makeHash(
  serial: string,
  sheetsId: string,
  amount: number,
  subject: string
): string {
  const data = `${serial}|${sheetsId}|${amount}|${subject}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 8).toUpperCase();
}

// ============================================================================
// Validation
// ============================================================================

/**
 * 驗證流水號格式是否合法
 */
export function isValidSerial(serial: string): boolean {
  return parseSerial(serial) !== null || /^H\d{2}-\d{3}-[A-Z]-\d{2}$/.test(serial);
}

/**
 * 判斷是否為歷史匯入流水號
 */
export function isHistoricalSerial(serial: string): boolean {
  return serial.startsWith('H');
}
