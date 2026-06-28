/**
 * invoice-validator.ts — 收費單形態 + 拆分鏈條驗證（純函式，無副作用）
 *
 * 三類功能：
 *   1. classifyShape(records) — 識別 records 是哪一種型態
 *   2. validateInvoice(invoice, prev?) — 單張驗證（含 chain check）
 *   3. validateChain(invoices[]) — 整個 enrollment 的鏈條驗證
 */
import type { BilledRecord, RateConfig } from './billing-engine';

// ============================================================================
// Types
// ============================================================================

/**
 * Invoice records 的形態：
 *   - STANDARD_5YY: 5 個全堂 YY，無拆分（最常見）
 *   - SPLIT_BRIDGE: Y + 4×YY + Y（帶入 + 4 全堂 + 帶出，6 筆）— 標準拆分鏈條
 *   - SPLIT_HEAD: 4×YY + Y（無帶入，僅帶出，5 筆）— 鏈條頭
 *   - SPLIT_TAIL: Y + 5×YY 或 Y + 4×YY（有帶入，無帶出）— 鏈條尾或不到結算
 *   - WITH_HALF: 含 Y (status=2 老師標的) — 如 4 YY + 1 Y + ...
 *   - IRREGULAR: 其他不符標準的（如 6 YY, 1 YY, 半堂超量等）
 */
export type InvoiceShape =
  | 'STANDARD_5YY'
  | 'SPLIT_BRIDGE'
  | 'SPLIT_HEAD'
  | 'SPLIT_TAIL'
  | 'WITH_HALF'
  | 'IRREGULAR';

export interface ShapeInfo {
  shape: InvoiceShape;
  hasCarriedIn: boolean;
  hasCarriedOut: boolean;
  /** 完整 YY 數（不含拆分） */
  fullYYCount: number;
  /** 拆分數（isSplit=true） */
  splitCount: number;
  /** 老師標的 Y 數（status=2, isSplit=false） */
  halfStatusCount: number;
  /** 該形態的描述（用於 UI 提示） */
  description: string;
}

/** 鏈條銜接問題類型 */
export type ChainIssueType =
  | 'CHAIN_BROKEN'           // 上張帶出但下一張沒帶入
  | 'ORPHAN_BROUGHT_IN'      // 下張帶入但上張沒帶出
  | 'DATE_MISMATCH';         // 帶入帶出日期不一致

export interface ChainIssue {
  type: ChainIssueType;
  prevSerial: string | null;
  currSerial: string;
  detail: string;
}

export interface InvoiceLite {
  id: number;
  serialNumber: string;
  amount: number;
  totalY: number;
  yyCount: number;
  yCount: number;
  records: BilledRecord[];
  note: string | null;
  status: string;
}

// ============================================================================
// 1. 形態分類
// ============================================================================

export function classifyShape(records: BilledRecord[]): ShapeInfo {
  const recs = records ?? [];
  const fullYYCount = recs.filter(r => r.status === 3 && !r.isSplit).length;
  const splitCount = recs.filter(r => r.isSplit).length;
  const halfStatusCount = recs.filter(r => r.status === 2 && !r.isSplit).length;
  const hasCarriedIn = !!recs[0]?.isSplit;
  const hasCarriedOut = !!recs[recs.length - 1]?.isSplit && recs.length > 1;

  // 判斷 shape
  let shape: InvoiceShape;
  let description: string;

  if (recs.length === 5 && fullYYCount === 5 && splitCount === 0 && halfStatusCount === 0) {
    shape = 'STANDARD_5YY';
    description = '標準 5 全堂 (5 YY = 10Y)';
  } else if (recs.length === 6 && fullYYCount === 4 && splitCount === 2 && hasCarriedIn && hasCarriedOut) {
    shape = 'SPLIT_BRIDGE';
    description = '拆分鏈條 (Y+4×YY+Y = 10Y)';
  } else if (recs.length === 5 && fullYYCount === 4 && splitCount === 1 && hasCarriedOut && !hasCarriedIn) {
    shape = 'SPLIT_HEAD';
    description = '鏈條頭 (4×YY+Y 帶出，無帶入)';
  } else if (recs.length === 5 && fullYYCount === 4 && splitCount === 1 && hasCarriedIn && !hasCarriedOut) {
    shape = 'SPLIT_TAIL';
    description = '鏈條尾 (Y+4×YY 帶入，無帶出)';
  } else if (halfStatusCount > 0) {
    shape = 'WITH_HALF';
    description = `含老師標 Y 半堂 (${halfStatusCount} 筆)`;
  } else {
    shape = 'IRREGULAR';
    description = `異常形態：${recs.length} 筆 (${fullYYCount} 全 + ${splitCount} 拆 + ${halfStatusCount} 半)`;
  }

  return { shape, hasCarriedIn, hasCarriedOut, fullYYCount, splitCount, halfStatusCount, description };
}

/** 判斷 shape 是否屬於拆分系列（給 UI 標示） */
export function isSplitShape(shape: InvoiceShape): boolean {
  return shape === 'SPLIT_BRIDGE' || shape === 'SPLIT_HEAD' || shape === 'SPLIT_TAIL';
}

/** 判斷 shape 是否為異常（給 UI 紅字） */
export function isIrregularShape(shape: InvoiceShape): boolean {
  return shape === 'IRREGULAR';
}

// ============================================================================
// 2. 單張驗證（金額、totalY 等等）
// ============================================================================

export interface SingleIssue {
  field: string;
  detail: string;
}

export function validateSingle(invoice: InvoiceLite, rateConfig: RateConfig): SingleIssue[] {
  const issues: SingleIssue[] = [];
  const recs = invoice.records ?? [];
  const settlementY = rateConfig.settlementSessions * 2;

  // amount 對得上 records 加總
  const recSum = recs.reduce((s, r) => s + r.fee, 0);
  if (recSum !== invoice.amount) {
    issues.push({ field: 'amount', detail: `records 加總 $${recSum} ≠ amount $${invoice.amount}` });
  }
  // totalY 對得上 records yUsed 加總
  const yUsedSum = recs.reduce((s, r) => s + r.yUsed, 0);
  if (yUsedSum !== invoice.totalY) {
    issues.push({ field: 'totalY', detail: `records yUsed 加總 ${yUsedSum} ≠ totalY ${invoice.totalY}` });
  }
  // totalY 應 = settlementY（除非 force 模式 / 鏈條尾）
  if (yUsedSum > settlementY) {
    issues.push({ field: 'totalY', detail: `totalY ${yUsedSum} 超過結算 ${settlementY}（應該拆分）` });
  }

  return issues;
}

// ============================================================================
// 3. 鏈條驗證（單筆 prev → curr）
// ============================================================================

/** 解析 note 中的「帶入 / 帶出」日期 */
export function parseNoteDates(note: string | null): { broughtIn?: string; broughtOut?: string } {
  if (!note) return {};
  const inM = note.match(/(\d{4}\/\d{2}\/\d{2})\s*帶入/);
  const outM = note.match(/(\d{4}\/\d{2}\/\d{2})\s*帶出/);
  return { broughtIn: inM?.[1], broughtOut: outM?.[1] };
}

export function validateChainLink(prev: InvoiceLite | null, curr: InvoiceLite): ChainIssue[] {
  const issues: ChainIssue[] = [];
  const currRecs = curr.records ?? [];
  const prevRecs = prev?.records ?? [];

  const prevLast = prevRecs[prevRecs.length - 1];
  const currFirst = currRecs[0];

  const prevCarriedOut = prev && prevLast?.isSplit ? prevLast.date : null;
  const currCarriedIn = currFirst?.isSplit ? currFirst.date : null;

  // CHAIN_BROKEN: 上張帶出，本張第一筆不是帶入
  if (prevCarriedOut && !currCarriedIn) {
    issues.push({
      type: 'CHAIN_BROKEN',
      prevSerial: prev?.serialNumber ?? null,
      currSerial: curr.serialNumber,
      detail: `上張帶出 ${prevCarriedOut}，本張第一筆 ${currFirst?.date ?? '(無)'} 沒帶入`,
    });
  }

  // ORPHAN_BROUGHT_IN: 本張第一筆帶入，但上張沒帶出
  if (currCarriedIn && !prevCarriedOut) {
    issues.push({
      type: 'ORPHAN_BROUGHT_IN',
      prevSerial: prev?.serialNumber ?? null,
      currSerial: curr.serialNumber,
      detail: prev
        ? `本張第一筆 ${currCarriedIn} 帶入，但上張 ${prev.serialNumber} 最後一筆 ${prevLast?.date} isSplit=${!!prevLast?.isSplit}`
        : `本張第一筆 ${currCarriedIn} 帶入，但這是該 enrollment 第一張`,
    });
  }

  // DATE_MISMATCH: 兩邊都有但日期不對
  if (prevCarriedOut && currCarriedIn && prevCarriedOut !== currCarriedIn) {
    issues.push({
      type: 'DATE_MISMATCH',
      prevSerial: prev?.serialNumber ?? null,
      currSerial: curr.serialNumber,
      detail: `上張帶出 ${prevCarriedOut} ≠ 本張帶入 ${currCarriedIn}`,
    });
  }

  return issues;
}

// ============================================================================
// 4. 整鏈條驗證
// ============================================================================

export interface ChainAuditResult {
  enrollmentId?: number;
  invoices: { invoice: InvoiceLite; shape: ShapeInfo; singleIssues: SingleIssue[] }[];
  chainIssues: ChainIssue[];
}

export function validateChain(
  invoices: InvoiceLite[],
  rateConfig: RateConfig,
): ChainAuditResult {
  const sorted = [...invoices]; // 假設已經依時間排序
  const result: ChainAuditResult = { invoices: [], chainIssues: [] };

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;

    result.invoices.push({
      invoice: curr,
      shape: classifyShape(curr.records),
      singleIssues: validateSingle(curr, rateConfig),
    });
    result.chainIssues.push(...validateChainLink(prev, curr));
  }

  return result;
}

// ============================================================================
// 5. UI helper：單張 invoice 是否該標粗體
// ============================================================================

export interface UIFlags {
  /** 拆分系列：粗體 */
  isSplit: boolean;
  /** 異常：紅字粗體 */
  isIrregular: boolean;
  /** 有鏈條問題：橘字 */
  hasChainIssue: boolean;
}

export function uiFlags(
  invoice: InvoiceLite,
  prev: InvoiceLite | null = null,
): UIFlags {
  const shape = classifyShape(invoice.records);
  const chainIssues = validateChainLink(prev, invoice);
  return {
    isSplit: isSplitShape(shape.shape),
    isIrregular: isIrregularShape(shape.shape),
    hasChainIssue: chainIssues.length > 0,
  };
}
