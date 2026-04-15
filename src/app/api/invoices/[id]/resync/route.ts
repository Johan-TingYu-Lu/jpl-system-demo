/**
 * POST /api/invoices/[id]/resync
 *
 * 從 DB 出勤資料重新計算該張收費單的 records、金額。
 * Body: { dryRun?: boolean }  預設 dryRun=false（直接更新）
 */
import { NextResponse } from 'next/server';
import { resyncInvoice } from '@/lib/invoice-resyncer';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let dryRun = false;
  try {
    const body = await request.json();
    dryRun = body.dryRun === true;
  } catch {
    // no body is fine, default dryRun=false
  }

  try {
    const result = await resyncInvoice({ invoiceId, dryRun });
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
