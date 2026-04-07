/**
 * POST /api/enrollments/[id]/settle — 結清學生
 * DELETE /api/enrollments/[id]/settle — 取消結清（恢復 active）
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const enrollmentId = parseInt(id, 10);
  if (isNaN(enrollmentId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { person: { select: { name: true } } },
  });
  if (!enrollment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (enrollment.status === '結清') {
    return NextResponse.json({ error: 'Already settled' }, { status: 400 });
  }

  const previousStatus = enrollment.status;

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { status: '結清' },
  });

  await createAuditLog({
    tableName: 'enrollments',
    recordId: enrollmentId,
    action: 'UPDATE',
    beforeData: { status: previousStatus },
    afterData: { status: '結清' },
    changedBy: 'web',
    reason: `結清: ${enrollment.sheetsId} ${enrollment.person.name}`,
  });

  return NextResponse.json({
    success: true,
    enrollment: { id: enrollmentId, sheetsId: enrollment.sheetsId, status: '結清' },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const enrollmentId = parseInt(id, 10);
  if (isNaN(enrollmentId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { person: { select: { name: true } } },
  });
  if (!enrollment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (enrollment.status !== '結清') {
    return NextResponse.json({ error: 'Not settled' }, { status: 400 });
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { status: 'active' },
  });

  await createAuditLog({
    tableName: 'enrollments',
    recordId: enrollmentId,
    action: 'UPDATE',
    beforeData: { status: '結清' },
    afterData: { status: 'active' },
    changedBy: 'web',
    reason: `取消結清: ${enrollment.sheetsId} ${enrollment.person.name}`,
  });

  return NextResponse.json({
    success: true,
    enrollment: { id: enrollmentId, sheetsId: enrollment.sheetsId, status: 'active' },
  });
}
