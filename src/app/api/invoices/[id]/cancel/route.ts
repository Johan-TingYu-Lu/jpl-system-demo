/**
 * POST /api/invoices/[id]/cancel — 不再計費（移除待收的 pending invoice）
 *
 * 清除 Sheets 計費日期表的對應日期對，然後刪除 DB invoice。
 * 只允許 pending 狀態的 invoice。
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { revertBillingDates } from '@/lib/sheets-push';
import { calendarYearToAcademicYear } from '@/lib/year-config';

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

  // 1. 如果已推 Sheets，清除計費日期表
  let sheetReverted = false;
  if (inv.sheetPushed) {
    try {
      const calYear = inv.startDate.getUTCFullYear();
      const calMonth = inv.startDate.getUTCMonth() + 1;
      const academicYear = calendarYearToAcademicYear(calYear, calMonth);
      const yearCode = String(inv.startDate.getUTCFullYear()).slice(-2);
      const remainingCount = await prisma.invoice.count({
        where: {
          enrollmentId: inv.enrollmentId,
          serialNumber: { startsWith: `${yearCode}-` },
          id: { not: invoiceId },
        },
      });
      const revertResult = await revertBillingDates({
        sheetsId: inv.enrollment.sheetsId,
        academicYear,
        previousCount: remainingCount,
      });
      sheetReverted = revertResult.success && revertResult.verified;
    } catch (e) {
      console.error(`[cancel] revertBillingDates failed:`, e);
    }
  }

  // 2. 刪除關聯的 payments
  await prisma.payment.deleteMany({ where: { invoiceId } });

  // 3. 刪除 invoice
  await prisma.invoice.delete({ where: { id: invoiceId } });

  // 4. Audit log
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
    },
    afterData: { reason: '不再計費' },
    changedBy: 'web',
    reason: `不再計費: ${inv.serialNumber} (${inv.enrollment.person.name})`,
  });

  return NextResponse.json({
    success: true,
    cancelled: { id: invoiceId, serial: inv.serialNumber },
    sheetReverted,
  });
}
