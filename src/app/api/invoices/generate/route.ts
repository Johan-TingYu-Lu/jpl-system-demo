/**
 * POST /api/invoices/generate
 * Body: { enrollmentId: number } OR { sheetsId: string } OR { all: true }
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateInvoice, generateAllInvoices } from '@/lib/invoice-generator';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { enrollmentId, sheetsId, all } = body as {
      enrollmentId?: number;
      sheetsId?: string;
      all?: boolean;
    };

    if (all) {
      const result = await generateAllInvoices();
      return NextResponse.json({
        success: true,
        generated: result.generated.length,
        skipped: result.skipped,
        results: result.generated,
      });
    }

    let targetId = enrollmentId;
    if (!targetId && sheetsId) {
      const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
      if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      targetId = enrollment.id;
    }
    if (!targetId) return NextResponse.json({ error: 'enrollmentId or sheetsId required' }, { status: 400 });

    const result = await generateInvoice({ enrollmentId: targetId, mode: 'normal' });
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
