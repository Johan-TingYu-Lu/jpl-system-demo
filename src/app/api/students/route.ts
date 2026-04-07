/**
 * API: /api/students — 學生查詢 + 新增
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { pushNewStudentToSheets } from '@/lib/sheets-push';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const classCode = searchParams.get('classCode');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    try {
        // Build enrollment filter
        const enrollFilter: Record<string, unknown> = {};
        if (classCode) enrollFilter.classCode = classCode;
        if (status) enrollFilter.status = status;

        const persons = await prisma.person.findMany({
            where: search
                ? { name: { contains: search } }
                : undefined,
            include: {
                enrollments: {
                    where: Object.keys(enrollFilter).length > 0 ? enrollFilter : undefined,
                    include: {
                        attendances: {
                            select: { year: true, month: true, days: true },
                            orderBy: [{ year: 'desc' }, { month: 'desc' }],
                            take: 3,
                        },
                        _count: { select: { invoices: true, payments: true } },
                    },
                },
            },
            take: limit,
            orderBy: { name: 'asc' },
        });

        // Transform data for response
        const result = persons.map(p => ({
            id: p.id,
            name: p.name,
            phone: p.phone,
            riskLevel: p.riskLevel,
            enrollments: p.enrollments.map(e => ({
                id: e.id,
                sheetsId: e.sheetsId,
                classCode: e.classCode,
                subject: e.subject,
                className: e.className,
                status: e.status,
                recentAttendance: e.attendances.map(a => ({
                    year: a.year,
                    month: a.month,
                    totalY: a.days.reduce((s: number, v: number) =>
                        s + (v === 3 ? 2 : v === 2 ? 1 : 0), 0),
                })),
                invoiceCount: e._count.invoices,
                paymentCount: e._count.payments,
            })),
        }));

        return NextResponse.json({ students: result, count: result.length });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { sheetsId, status } = body as { sheetsId: string; status: string };
        if (!sheetsId || !status) {
            return NextResponse.json({ error: 'sheetsId and status required' }, { status: 400 });
        }
        const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
        const oldStatus = enrollment?.status;

        const updated = await prisma.enrollment.updateMany({
            where: { sheetsId },
            data: { status },
        });

        if (enrollment) {
            await createAuditLog({
                tableName: 'enrollments',
                recordId: enrollment.id,
                action: 'UPDATE',
                beforeData: { sheetsId, status: oldStatus },
                afterData: { sheetsId, status },
                changedBy: 'web',
                reason: `Status changed: ${oldStatus} → ${status}`,
            });
        }

        return NextResponse.json({ success: true, updated: updated.count });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, phone, classCode, subject, className, cohort, contactName, contactRelation, contactPhone } = body as {
            name: string;
            phone?: string;
            classCode: string;
            subject: string;
            className?: string;
            cohort?: number;
            contactName?: string;
            contactRelation?: string;
            contactPhone?: string;
        };

        // 自動取號：找出目前最大的 sheetsId（數字），+1
        const allEnrollments = await prisma.enrollment.findMany({
            select: { sheetsId: true },
        });
        const maxId = allEnrollments.reduce((max, e) => {
            const num = parseInt(e.sheetsId, 10);
            return !isNaN(num) && num > max ? num : max;
        }, 0);
        const newSheetsId = String(maxId + 1);

        // 班別名稱：前端傳入完整格式如 "M高一班(117)"，或備援為 classCode + "班"
        const finalClassName = className || `${classCode}班`;

        const person = await prisma.person.create({
            data: {
                name,
                phone: phone || null,
                contactName: contactName || null,
                contactRelation: contactRelation || null,
                contactPhone: contactPhone || null,
                enrollments: {
                    create: {
                        sheetsId: newSheetsId,
                        classCode,
                        subject,
                        className: finalClassName,
                        cohort: cohort || null,
                        status: 'active',
                    },
                },
            },
            include: { enrollments: true },
        });

        await createAuditLog({
            tableName: 'persons',
            recordId: person.id,
            action: 'CREATE',
            afterData: { name, sheetsId: newSheetsId, classCode, subject, className: finalClassName, cohort },
            changedBy: 'web',
            reason: 'New student created',
        });

        // 寫入 Google Sheets 的歷年學生資料總表
        const pushResult = await pushNewStudentToSheets({
            sheetsId: newSheetsId,
            name,
            className: finalClassName,
            phone: phone || '',
            contactName: contactName || '',
            contactRelation: contactRelation || '',
            contactPhone: contactPhone || '',
        });

        if (!pushResult.success) {
            console.error('Failed to push to sheets:', pushResult.error);
            return NextResponse.json({ 
                success: true, 
                person,
                sheetsId: newSheetsId,
                warning: 'Student created in DB, but failed to sync to Google Sheets.' 
            }, { status: 201 });
        }

        return NextResponse.json({ success: true, person, sheetsId: newSheetsId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
