/**
 * POST /api/invoices/[id]/unarchive — 取消封存（archived → pending）
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
  if (isNaN(invoiceId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (inv.status !== 'archived') {
    return NextResponse.json({ error: `只能取消封存 archived 狀態，目前: ${inv.status}` }, { status: 400 });
  }

  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'pending' } });

  await createAuditLog({
    tableName: 'invoices', recordId: invoiceId, action: 'UPDATE',
    beforeData: { status: 'archived' }, afterData: { status: 'pending' },
    changedBy: 'web', reason: `取消封存: ${inv.serialNumber}`,
  });

  return NextResponse.json({ success: true });
}
