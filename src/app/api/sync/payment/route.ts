/**
 * POST /api/sync/payment — 從 Sheets 繳費日期表同步繳費狀態
 *
 * 精確配對（startDate + endDate），只更新 pending → paid。
 * 用於老師在 Sheets 填入繳費日期後的同步。
 *
 * body: { sheetsIds?: string[] }  — 可選，限定學生
 */
import { NextResponse } from 'next/server';
import { createSheetsApi } from '@/lib/script-init';
import { syncPaymentStatus } from '@/lib/billing-history-importer';
import { createAuditLog } from '@/lib/audit';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    sheetsIds?: string[];
  };

  try {
    // 確保 Sheets API 已初始化
    await createSheetsApi();

    const result = await syncPaymentStatus({
      sheetsIds: body.sheetsIds,
    });

    // 記錄同步操作
    await createAuditLog({
      tableName: 'sync',
      recordId: 0,
      action: 'UPDATE',
      afterData: { target: 'payment', ...result },
      changedBy: 'system',
      reason: 'syncPaymentStatus from Sheets',
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[sync/payment] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
