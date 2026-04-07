/**
 * GET /api/invoices/list?sheetsId=686
 * Temporary debug endpoint to list all invoices for a student
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sheetsId = searchParams.get('sheetsId');
  if (!sheetsId) {
    return NextResponse.json({ error: 'sheetsId required' }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { sheetsId },
    select: { id: true, sheetsId: true, person: { select: { name: true } } },
  });
  if (!enrollment) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { endDate: 'asc' },
    select: {
      id: true,
      serialNumber: true,
      amount: true,
      status: true,
      startDate: true,
      endDate: true,
      records: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    student: { sheetsId, name: enrollment.person.name },
    invoices: invoices.map(inv => ({
      id: inv.id,
      serial: inv.serialNumber,
      amount: inv.amount,
      status: inv.status,
      startDate: inv.startDate?.toISOString().slice(0, 10),
      endDate: inv.endDate?.toISOString().slice(0, 10),
      createdAt: inv.createdAt?.toISOString().slice(0, 10),
      recordDates: Array.isArray(inv.records)
        ? (inv.records as any[]).map((r: any) => r.date)
        : [],
    })),
  });
}
