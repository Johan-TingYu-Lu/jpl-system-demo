/**
 * POST /api/invoices/[id]/cancel — 不再計費（移除待收的 pending invoice）
 *
 * 刪除 DB invoice。Sheets 復原需手動處理（revert 待重寫）。
 * 只允許 pending 或 draft 狀態的 invoice。
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
    include: { enrollment: { select: { sheetsId: true, person: { select: { name: true } } } } },
  });
  if (!inv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (inv.status === 'paid') {
    return NextResponse.json({ error: '已繳費的不能取消，請先退費' }, { status: 403 });
  }

  // 1. 刪除關聯的 payments
  await prisma.payment.deleteMany({ where: { invoiceId } });

  // 2. 刪除 invoice
  await prisma.invoice.delete({ where: { id: invoiceId } });

  // 3. Audit log
  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'DELETE',
    beforeData: {
      serial: inv.serialNumber,
      amount: inv.amount,
      status: inv.status,
      sheetsId: inv.enrollment.sheetsId,
      name: inv.enrollment.person.name,
      sheetPushed: inv.sheetPushed,
    },
    afterData: { reason: '不再計費' },
    changedBy: 'web',
    reason: `不再計費: ${inv.serialNumber} (${inv.enrollment.person.name})`,
  });

  return NextResponse.json({
    success: true,
    cancelled: { id: invoiceId, serial: inv.serialNumber },
    sheetRevertNeeded: inv.sheetPushed,
  });
}
