/**
 * POST /api/sync/push
 * Body: { target: 'invoices' | 'students' | 'all' }
 * Push DB data back to Google Sheets.
 */
import { NextResponse } from 'next/server';
import { syncInvoiceStatus, syncStudentStatus } from '@/lib/sheets-sync';
import { createAuditLog } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const target = (body as { target?: string }).target || 'all';

    const results: Record<string, unknown> = {};

    if (target === 'invoices' || target === 'all') {
      results.invoices = await syncInvoiceStatus();
    }
    if (target === 'students' || target === 'all') {
      results.students = await syncStudentStatus();
    }

    await createAuditLog({
      tableName: 'sync',
      recordId: 0,
      action: 'UPDATE',
      afterData: { target, ...results },
      changedBy: 'web',
      reason: `Sync push: ${target}`,
    });

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
