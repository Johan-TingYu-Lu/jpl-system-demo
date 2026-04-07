/**
 * API: /api/attendance — 出席紀錄查詢 + 更新
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

const CODE_LABELS: Record<number, string> = { 0: 'N', 1: 'V', 2: 'Y', 3: 'YY' };

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const enrollmentId = searchParams.get('enrollmentId');
    const sheetsId = searchParams.get('sheetsId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    try {
        // Build filter
        const where: Record<string, unknown> = {};

        if (enrollmentId) {
            where.enrollmentId = parseInt(enrollmentId);
        } else if (sheetsId) {
            const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
            if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
            where.enrollmentId = enrollment.id;
        }

        if (year) where.year = parseInt(year);
        if (month) where.month = parseInt(month);

        const records = await prisma.monthlyAttendance.findMany({
            where,
            include: {
                enrollment: {
                    select: {
                        sheetsId: true,
                        classCode: true,
                        subject: true,
                        person: { select: { name: true } },
                    },
                },
            },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });

        // Transform: expand vector into readable format
        const result = records.map(r => {
            const daysDetail = r.days
                .map((v: number, idx: number) => v > 0 ? { day: idx + 1, status: CODE_LABELS[v], code: v } : null)
                .filter(Boolean);

            const totalY = r.days.reduce((s: number, v: number) =>
                s + (v === 3 ? 2 : v === 2 ? 1 : 0), 0);

            return {
                id: r.id,
                sheetsId: r.enrollment.sheetsId,
                name: r.enrollment.person.name,
                classCode: r.enrollment.classCode,
                subject: r.enrollment.subject,
                year: r.year,
                month: r.month,
                days: r.days,
                daysDetail,
                totalY,
            };
        });

        return NextResponse.json({ attendance: result, count: result.length });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

/**
 * POST: 更新單月出席向量
 * Body: { enrollmentId|sheetsId, year, month, day, status: 0|1|2|3 }
 * 或整批: { enrollmentId|sheetsId, year, month, days: int[31] }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { enrollmentId: eid, sheetsId, year, month, day, status, days } = body as {
            enrollmentId?: number;
            sheetsId?: string;
            year: number;
            month: number;
            day?: number;
            status?: number;
            days?: number[];
        };

        // Resolve enrollment
        let enrollmentId = eid;
        if (!enrollmentId && sheetsId) {
            const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
            if (!enrollment) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
            enrollmentId = enrollment.id;
        }
        if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId or sheetsId required' }, { status: 400 });

        let newDays: number[];

        if (days) {
            // Batch update: replace entire vector
            newDays = days;
        } else if (day !== undefined && status !== undefined) {
            // Single day update: modify one element
            const existing = await prisma.monthlyAttendance.findUnique({
                where: { enrollmentId_year_month: { enrollmentId, year, month } },
            });
            newDays = existing ? [...existing.days] : new Array(31).fill(0);
            newDays[day - 1] = status;
        } else {
            return NextResponse.json({ error: 'Provide either days[] or (day + status)' }, { status: 400 });
        }

        const result = await prisma.monthlyAttendance.upsert({
            where: { enrollmentId_year_month: { enrollmentId, year, month } },
            update: { days: newDays },
            create: { enrollmentId, year, month, days: newDays },
        });

        const totalY = result.days.reduce((s: number, v: number) =>
            s + (v === 3 ? 2 : v === 2 ? 1 : 0), 0);

        return NextResponse.json({ success: true, totalY, id: result.id });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
