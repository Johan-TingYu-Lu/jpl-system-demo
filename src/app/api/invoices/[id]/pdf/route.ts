/**
 * POST /api/invoices/[id]/pdf — Generate PDF and return binary directly
 * GET  /api/invoices/[id]/pdf — Download existing PDF from pdfPath
 */
import { NextResponse } from 'next/server';
import { renderInvoicePdf } from '@/lib/pdf-renderer';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import * as fs from 'fs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoiceId = parseInt(id);
  if (isNaN(invoiceId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const result = await renderInvoicePdf(invoiceId);

  await createAuditLog({
    tableName: 'invoices',
    recordId: invoiceId,
    action: 'UPDATE',
    afterData: { action: 'pdf_render', success: result.success, pdfPath: result.pdfPath },
    changedBy: 'web',
    reason: result.success ? 'PDF generated' : `PDF failed: ${result.error}`,
  });

  if (!result.success || !result.pdfPath || !fs.existsSync(result.pdfPath)) {
    return NextResponse.json(
      { error: result.error || 'PDF generation failed', details: result },
      { status: 500 }
    );
  }

  // Read PDF and return as binary
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { serialNumber: true },
  });
  const pdfBuffer = fs.readFileSync(result.pdfPath);
  const filename = invoice?.serialNumber ?? `invoice-${invoiceId}`;

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoiceId = parseInt(id);
  if (isNaN(invoiceId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  // 先檢查有沒有現成 PDF
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { pdfPath: true, serialNumber: true },
  });

  if (invoice?.pdfPath && fs.existsSync(invoice.pdfPath)) {
    const pdfBuffer = fs.readFileSync(invoice.pdfPath);
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.serialNumber}.pdf"`,
      },
    });
  }

  // 沒有現成 PDF → 即時生成
  const result = await renderInvoicePdf(invoiceId);
  if (!result.success || !result.pdfPath || !fs.existsSync(result.pdfPath)) {
    return NextResponse.json(
      { error: result.error || 'PDF generation failed' },
      { status: 500 }
    );
  }

  const pdfBuffer = fs.readFileSync(result.pdfPath);
  const filename = invoice?.serialNumber ?? `invoice-${invoiceId}`;
  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
    },
  });
}
