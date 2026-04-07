/**
 * enrollment-status.ts — Enrollment 狀態定義
 *
 * 集中管理所有排除邏輯，新增狀態時只需改這裡。
 */

/** 不再處理的狀態（生成收費單、同步、點名等全部跳過） */
export const EXCLUDED_STATUSES = ['永久停止', '結清'] as const;

/** Prisma where 條件：排除已封存狀態 */
export const ACTIVE_STATUS_FILTER = { status: { notIn: [...EXCLUDED_STATUSES] } };

/** SQL WHERE 條件片段 */
export const ACTIVE_STATUS_SQL = `e.status NOT IN ('永久停止', '結清')`;

/** 判斷 enrollment 是否已封存 */
export function isExcluded(status: string): boolean {
  return (EXCLUDED_STATUSES as readonly string[]).includes(status);
}
