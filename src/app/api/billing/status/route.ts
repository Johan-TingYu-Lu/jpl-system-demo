/**
 * GET /api/billing/status — 收費狀況總覽
 *
 * Query params:
 *   class — 篩選班級名稱（e.g., "M高一班(117)"）
 *   classCode — 篩選科目代碼（"M" 或 "N"）
 *
 * 回傳各班級、各學生的收費狀況：
 *   - 收費單統計（total/paid/pending/draft）
 *   - FLAG（最後收費單結束日）
 *   - 目前可計費出席與 Y 累計
 *   - 是否已滿期可生成新收費單
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getBillableAttendance } from '@/lib/attendance-reader';
import { resolveAllRateConfigs } from '@/lib/rate-resolver';
import { calculateBilling } from '@/lib/billing-engine';
import { EXCLUDED_STATUSES } from '@/lib/enrollment-status';

interface StudentStatus {
  sheetsId: string;
  name: string;
  classCode: string;
  className: string;
  plan: string;
  enrollmentStatus: string;
  invoices: { total: number; paid: number; pending: number; draft: number };
  lastInvoiceEndDate: string | null;
  billable: {
    attendanceCount: number;
    currentY: number;
    targetY: number;
    canGenerate: boolean;
  } | null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const classFilter = url.searchParams.get('class');
    const classCodeFilter = url.searchParams.get('classCode');

    // 1. Load all non-permanently-stopped enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: { notIn: [...EXCLUDED_STATUSES] },
        ...(classFilter ? { className: classFilter } : {}),
        ...(classCodeFilter ? { classCode: classCodeFilter } : {}),
      },
      include: {
        person: { select: { name: true } },
        invoices: {
          select: { status: true, endDate: true },
          orderBy: { endDate: 'desc' },
        },
      },
      orderBy: [{ className: 'asc' }, { personId: 'asc' }],
    });

    // 2. Batch resolve rate configs
    const rateMap = await resolveAllRateConfigs();

    // 3. Build per-student status
    const students: StudentStatus[] = [];

    for (const e of enrollments) {
      const lastEndDate = e.invoices.length > 0 ? e.invoices[0].endDate : null;
      const resolved = rateMap.get(e.sheetsId);
      const rateConfig = resolved?.config;

      let billable: StudentStatus['billable'] = null;
      if (rateConfig && e.status === 'active') {
        const attendance = await getBillableAttendance(e.id, lastEndDate);
        if (attendance.length > 0) {
          const billing = calculateBilling(attendance, rateConfig, 'normal');
          billable = {
            attendanceCount: attendance.length,
            currentY: billing.totalY,
            targetY: rateConfig.settlementSessions * 2,
            canGenerate: billing.canGenerate,
          };
        } else {
          billable = {
            attendanceCount: 0,
            currentY: 0,
            targetY: rateConfig.settlementSessions * 2,
            canGenerate: false,
          };
        }
      }

      const paid = e.invoices.filter(i => i.status === 'paid').length;
      const pending = e.invoices.filter(i => i.status === 'pending').length;
      const draft = e.invoices.filter(i => i.status === 'draft').length;

      students.push({
        sheetsId: e.sheetsId,
        name: e.person.name,
        classCode: e.classCode,
        className: e.className,
        plan: resolved?.planName ?? 'unknown',
        enrollmentStatus: e.status,
        invoices: { total: e.invoices.length, paid, pending, draft },
        lastInvoiceEndDate: lastEndDate?.toISOString().slice(0, 10) ?? null,
        billable,
      });
    }

    // 4. Group by className
    const byClass: Record<string, StudentStatus[]> = {};
    for (const s of students) {
      if (!byClass[s.className]) byClass[s.className] = [];
      byClass[s.className].push(s);
    }

    const readyCount = students.filter(s => s.billable?.canGenerate).length;

    return NextResponse.json({
      success: true,
      summary: {
        totalStudents: students.length,
        activeStudents: students.filter(s => s.enrollmentStatus === 'active').length,
        readyToGenerate: readyCount,
        classes: Object.keys(byClass).length,
      },
      byClass,
    });
  } catch (error) {
    console.error('Billing status error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
