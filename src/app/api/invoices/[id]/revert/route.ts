/**
 * POST /api/invoices/[id]/revert — 復原收費單
 *
 * 支援狀態：
 *   draft   → 直接刪除（Sheets 沒有，不需清）
 *   pending → 清 Sheets 計費日期後刪除
 *   paid    → 拒絕（需先退費）
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

  // 1. 如果是 pending（已推 Sheets），先清 Sheets 計費日期
  let sheetReverted = false;
  if (inv.status === 'pending' && inv.sheetPushed) {
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
      if (!sheetReverted) {
        console.warn(`[revert] Sheet revert not verified for ${inv.enrollment.sheetsId}: ${revertResult.error}`);
      }
    } catch (e) {
      console.error(`[revert] revertBillingDates failed for ${inv.enrollment.sheetsId}:`, e);
      // Continue with deletion even if sheet revert fails
    }
  }

  // 2. Delete the invoice
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
    sheetReverted,
  });
}
