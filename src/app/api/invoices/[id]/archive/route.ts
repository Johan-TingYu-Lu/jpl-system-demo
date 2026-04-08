/**
 * POST /api/invoices/[id]/archive — 封存收費單（不再計費）
 *
 * 將 pending invoice 改為 archived 狀態。
 * 封存後不出現在待收清單，但資料保留在 DB。
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
  if (inv.status !== 'pending') {
    return NextResponse.json({ error: `只能封存 pending 狀態，目前: ${inv.status}` }, { status: 400 });
  }

  // 改為 archived
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'archived' },
  });

  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'UPDATE',
    beforeData: { status: 'pending' },
    afterData: { status: 'archived' },
    changedBy: 'web',
    reason: `封存: ${inv.serialNumber} (${inv.enrollment.person.name})`,
  });

  return NextResponse.json({
    success: true,
    archived: { id: invoiceId, serial: inv.serialNumber },
  });
}
