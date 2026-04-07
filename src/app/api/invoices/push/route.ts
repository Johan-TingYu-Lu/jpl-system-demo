/**
 * POST /api/invoices/push — 批次推送 draft → Sheets 計費日期表 → pending
 *
 * body: { invoiceIds: number[] }  — 指定推送
 *     或 { all: true }            — 推所有 draft
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { pushInvoiceToSheets } from '@/lib/invoice-generator';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    invoiceIds?: number[];
    all?: boolean;
  };

  let invoiceIds: number[];

  if (body.all) {
    const drafts = await prisma.invoice.findMany({
      where: { status: 'draft' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    invoiceIds = drafts.map(d => d.id);
  } else if (body.invoiceIds && body.invoiceIds.length > 0) {
    invoiceIds = body.invoiceIds;
  } else {
    return NextResponse.json({ error: 'Provide invoiceIds or { all: true }' }, { status: 400 });
  }

  const results: { invoiceId: number; success: boolean; error?: string }[] = [];

  for (const id of invoiceIds) {
    const result = await pushInvoiceToSheets(id);
    results.push({
      invoiceId: id,
      success: result.success && result.verified,
      error: result.error,
    });
  }

  const pushed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({
    total: invoiceIds.length,
    pushed,
    failed,
    results,
  });
}
