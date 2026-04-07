/**
 * POST /api/invoices/[id]/pay — 銷帳（標記已收款）
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { pushPayment } from '@/lib/sheets-push';
import { calendarYearToAcademicYear } from '@/lib/year-config';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { enrollment: { select: { id: true, sheetsId: true, person: { select: { name: true } } } } },
  });
  if (!inv) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (inv.status === 'paid') {
    return NextResponse.json({ error: 'Already paid' }, { status: 400 });
  }
  if (inv.status !== 'pending') {
    return NextResponse.json(
      { error: `只能銷帳 pending 狀態的收費單，目前狀態: ${inv.status}` },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({})) as {
    method?: string;
    notes?: string;
    paymentDate?: string;
  };

  const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();

  // 1. Update invoice status
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'paid',
      paidDate: paymentDate,
    },
  });

  // 2. Create payment record
  const payment = await prisma.payment.create({
    data: {
      enrollmentId: inv.enrollmentId,
      invoiceId: invoiceId,
      amount: inv.amount,
      paymentDate: paymentDate,
      method: body.method || 'cash',
      notes: body.notes || null,
    },
  });

  // 3. Audit log
  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'UPDATE',
    beforeData: { status: inv.status },
    afterData: { status: 'paid', paymentId: payment.id, method: body.method || 'cash' },
    changedBy: 'web',
    reason: `銷帳: ${inv.serialNumber}`,
  });

  // 4. Push payment to Google Sheets（繳費金額表 + 繳費日期表）with verify + retry
  let sheetPushed = false;
  try {
    const calYear = inv.startDate.getUTCFullYear();
    const calMonth = inv.startDate.getUTCMonth() + 1;
    const academicYear = calendarYearToAcademicYear(calYear, calMonth);
    // 找此 invoice 在同學年中按時間序的位置（1-based）
    // Sheet 的繳費金額/日期欄位是按計費日期表的順序排列，不是按已繳數量
    const allInvoices = await prisma.invoice.findMany({
      where: { enrollmentId: inv.enrollmentId, serialNumber: { startsWith: '26-' } },
      orderBy: [{ startDate: 'asc' }, { serialNumber: 'asc' }],
      select: { id: true },
    });
    const position = allInvoices.findIndex(i => i.id === invoiceId) + 1;
    const pushResult = await pushPayment({
      sheetsId: inv.enrollment.sheetsId,
      academicYear,
      amount: inv.amount,
      paymentDate,
      paymentCount: position,
    });
    sheetPushed = pushResult.success && pushResult.verified;
    if (!sheetPushed) {
      console.warn(`[pay] Sheet push not verified for ${inv.enrollment.sheetsId}: ${pushResult.error}`);
    }
  } catch (e) {
    console.error(`[pay] pushPayment failed for ${inv.enrollment.sheetsId}:`, e);
  }

  // 5. Update sheetPushed in DB
  if (sheetPushed) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { sheetPushed: true },
    });
  }

  return NextResponse.json({
    success: true,
    invoice: { id: invoiceId, serial: inv.serialNumber, status: 'paid' },
    payment: { id: payment.id },
    sheetPushed,
  });
}
