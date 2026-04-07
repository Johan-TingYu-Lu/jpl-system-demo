/**
 * GET /api/audit?table=invoices&recordId=42
 * Query audit history for a specific record.
 */
import { NextResponse } from 'next/server';
import { getAuditHistory } from '@/lib/audit';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get('table');
  const recordId = searchParams.get('recordId');

  if (!table || !recordId) {
    return NextResponse.json({ error: 'table and recordId required' }, { status: 400 });
  }

  const history = await getAuditHistory(table, parseInt(recordId));
  return NextResponse.json({ history });
}
