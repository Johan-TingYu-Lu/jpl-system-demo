/**
 * POST /api/invoices/force-generate
 * Body: { enrollmentId: number } OR { sheetsId: string }
 * Force generates invoice regardless of settlement point.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateInvoice } from '@/lib/invoice-generator';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { enrollmentId, sheetsId } = body as {
      enrollmentId?: number;
      sheetsId?: string;
    };

    let targetId = enrollmentId;
    if (!targetId && sheetsId) {
      const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
      if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      targetId = enrollment.id;
    }
    if (!targetId) return NextResponse.json({ error: 'enrollmentId or sheetsId required' }, { status: 400 });

    const result = await generateInvoice({ enrollmentId: targetId, mode: 'force' });
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
