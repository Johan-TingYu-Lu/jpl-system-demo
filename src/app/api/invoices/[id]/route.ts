/**
 * PATCH /api/invoices/[id] — 修正收費單 records/日期（管理用）
 * DELETE /api/invoices/[id] — 刪除 draft 收費單
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json();
  const update: Record<string, unknown> = {};

  if (body.records) update.records = body.records;
  if (body.startDate) update.startDate = new Date(body.startDate);
  if (body.endDate) update.endDate = new Date(body.endDate);
  if (body.amount !== undefined) update.amount = body.amount;
  if (body.yCount !== undefined) update.yCount = body.yCount;
  if (body.totalY !== undefined) update.totalY = body.totalY;

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: update,
  });

  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'UPDATE',
    beforeData: { serial: inv.serialNumber, endDate: inv.endDate, amount: inv.amount },
    afterData: update,
    changedBy: 'web',
    reason: body.reason || 'Manual update',
  });

  return NextResponse.json({ success: true, invoice: { id: updated.id, serial: updated.serialNumber } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (inv.status !== 'draft') {
    return NextResponse.json(
      { error: `Cannot delete invoice with status "${inv.status}", only draft allowed` },
      { status: 403 },
    );
  }

  await prisma.invoice.delete({ where: { id: invoiceId } });

  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'DELETE',
    beforeData: { serial: inv.serialNumber, amount: inv.amount, status: inv.status },
    changedBy: 'web',
    reason: 'Delete draft invoice',
  });

  return NextResponse.json({
    success: true,
    deleted: { id: invoiceId, serial: inv.serialNumber },
  });
}
