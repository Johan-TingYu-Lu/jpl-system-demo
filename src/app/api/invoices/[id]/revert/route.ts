/**
 * POST /api/invoices/[id]/revert — 復原收費單
 *
 * 只刪除 DB invoice。Sheets 復原需手動處理（revert 待重寫）。
 *   draft   → 直接刪除
 *   pending → 刪除，提示需手動清 Sheets
 *   paid    → 拒絕（需先退費）
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { enrollment: { select: { sheetsId: true } } },
  });
  if (!inv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (inv.status === 'paid') {
    return NextResponse.json(
      { error: '已繳費的收費單不能直接復原，請先退費' },
      { status: 403 },
    );
  }

  // 1. Delete the invoice
  await prisma.invoice.delete({ where: { id: invoiceId } });

  // 2. Audit log
  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'DELETE',
    beforeData: {
      serial: inv.serialNumber,
      amount: inv.amount,
      status: inv.status,
      sheetPushed: inv.sheetPushed,
      startDate: inv.startDate,
      endDate: inv.endDate,
    },
    changedBy: 'web',
    reason: `復原收費單: ${inv.serialNumber} (was ${inv.status})`,
  });

  return NextResponse.json({
    success: true,
    reverted: { id: invoiceId, serial: inv.serialNumber, previousStatus: inv.status },
    sheetRevertNeeded: inv.sheetPushed,
  });
}
