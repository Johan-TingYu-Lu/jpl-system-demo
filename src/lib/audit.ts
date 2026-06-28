/**
 * audit.ts — 審計日誌模組（回朔功能）
 */
import prisma from './prisma';

export interface AuditLogInput {
  tableName: string;
  recordId: number;
  // PUSH_FAILED: Sheet 推送失敗（保留 draft 狀態），用於追蹤推送錯誤
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'PUSH_FAILED';
  beforeData?: unknown;
  afterData?: unknown;
  changedBy?: string;
  reason?: string;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tableName: input.tableName,
      recordId: input.recordId,
      action: input.action,
      beforeData: input.beforeData ? (input.beforeData as object) : undefined,
      afterData: input.afterData ? (input.afterData as object) : undefined,
      changedBy: input.changedBy || 'system',
      reason: input.reason || null,
    },
  });
}

/**
 * Query audit log for a specific record.
 * Used for rollback capability and change history.
 */
export async function getAuditHistory(tableName: string, recordId: number) {
  return prisma.auditLog.findMany({
    where: { tableName, recordId },
    orderBy: { createdAt: 'desc' },
  });
}
