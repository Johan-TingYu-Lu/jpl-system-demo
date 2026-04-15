/**
 * POST /api/invoices/[id]/resync
 *
 * 「重算」：刪除目前的 draft/pending 收費單，重新從最後一張 paid 的 endDate 開始
 * 用 billing engine 計算到滿額，生成新收費單 + PDF + 推送 Sheets。
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateInvoice, pushInvoiceToSheets } from '@/lib/invoice-generator';
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

  // 1. Load old invoice
  const oldInv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { enrollment: { select: { sheetsId: true } } },
  });
  if (!oldInv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (oldInv.status === 'paid') {
    return NextResponse.json({ error: '已銷帳的收費單不能重算' }, { status: 403 });
  }

  const enrollmentId = oldInv.enrollmentId;
  const oldSerial = oldInv.serialNumber;
  const oldAmount = oldInv.amount;

  // 2. Delete old invoice
  await prisma.invoice.delete({ where: { id: invoiceId } });
  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'DELETE',
    beforeData: { serial: oldSerial, amount: oldAmount, status: oldInv.status },
    changedBy: 'resync',
    reason: `重算：刪除舊收費單 ${oldSerial}`,
  });

  // 3. Re-generate invoice from scratch
  const genResult = await generateInvoice({ enrollmentId, mode: 'normal' });
  if (!genResult.success || !genResult.invoiceId) {
    return NextResponse.json({
      success: false,
      deleted: oldSerial,
      error: genResult.error || '重新生成失敗',
    }, { status: 422 });
  }

  // 4. Generate PDF
  let pdfOk = false;
  try {
    const { renderInvoicePdf } = await import('@/lib/pdf-renderer');
    const pdfResult = await renderInvoicePdf(genResult.invoiceId);
    pdfOk = pdfResult.success;
  } catch { /* PDF failure is non-fatal */ }

  // 5. Push to Sheets (draft → pending)
  let pushOk = false;
  try {
    const pushResult = await pushInvoiceToSheets(genResult.invoiceId);
    pushOk = pushResult.success && pushResult.verified;
  } catch { /* push failure is non-fatal */ }

  // 6. If push failed, still upgrade to pending so it shows in the UI
  if (!pushOk) {
    await prisma.invoice.update({
      where: { id: genResult.invoiceId },
      data: { status: 'pending' },
    });
  }

  return NextResponse.json({
    success: true,
    deleted: oldSerial,
    deletedAmount: oldAmount,
    newInvoiceId: genResult.invoiceId,
    newSerial: genResult.serialNumber,
    newAmount: genResult.billing?.totalFee,
    pdfGenerated: pdfOk,
    sheetPushed: pushOk,
  });
}
