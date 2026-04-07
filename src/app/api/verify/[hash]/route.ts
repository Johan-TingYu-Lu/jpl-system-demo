/**
 * API: /api/verify/[hash] — QR code 驗證收費單
 * GET  = 查看收費單資訊（家長掃碼，唯讀）
 * POST = 標記已繳（老師掃碼，需 action: 'mark_paid'）
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { pushPayment } from '@/lib/sheets-push';
import { calendarYearToAcademicYear } from '@/lib/year-config';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ hash: string }> }
) {
    const { hash } = await params;

    try {
        const invoice = await prisma.invoice.findFirst({
            where: { hashCode: hash },
            include: {
                enrollment: {
                    include: { person: { select: { name: true } } },
                },
            },
        });

        if (!invoice) {
            return NextResponse.json(
                { valid: false, message: '找不到此收費單' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            valid: true,
            invoice: {
                serialNumber: invoice.serialNumber,
                hashCode: invoice.hashCode,
                studentName: invoice.enrollment.person.name,
                subject: invoice.enrollment.subject,
                classCode: invoice.enrollment.classCode,
                amount: invoice.amount,
                totalY: invoice.totalY,
                startDate: invoice.startDate,
                endDate: invoice.endDate,
                status: invoice.status,
                records: invoice.records,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ hash: string }> }
) {
    const { hash } = await params;
    const body = await request.json().catch(() => ({}));
    const { action, method, transferRef } = body as {
        action?: string;
        method?: string;
        transferRef?: string;
    };

    try {
        const invoice = await prisma.invoice.findFirst({
            where: { hashCode: hash },
            include: { enrollment: { select: { id: true, sheetsId: true } } },
        });

        if (!invoice) {
            return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
        }

        if (action === 'mark_paid') {
            if (invoice.status === 'paid') {
                return NextResponse.json({ error: 'Already paid' }, { status: 409 });
            }
            if (invoice.status !== 'pending') {
                return NextResponse.json(
                    { error: `只能銷帳 pending 狀態的收費單，目前狀態: ${invoice.status}` },
                    { status: 400 },
                );
            }

            const paymentDate = new Date();

            const payment = await prisma.payment.create({
                data: {
                    enrollmentId: invoice.enrollmentId,
                    invoiceId: invoice.id,
                    amount: invoice.amount,
                    paymentDate,
                    method: method || 'qr_scan',
                    transferRef: transferRef || null,
                },
            });

            await prisma.invoice.update({
                where: { id: invoice.id },
                data: { status: 'paid', paidDate: paymentDate },
            });

            await createAuditLog({
                tableName: 'invoices',
                recordId: invoice.id,
                action: 'UPDATE',
                beforeData: { status: 'pending' },
                afterData: { status: 'paid', paymentId: payment.id, method: method || 'qr_scan' },
                changedBy: 'teacher_qr_scan',
                reason: 'Marked paid via QR scan',
            });

            // 推送到 Sheets 繳費金額表 + 繳費日期表
            let sheetPushed = false;
            try {
                const calYear = invoice.startDate.getUTCFullYear();
                const calMonth = invoice.startDate.getUTCMonth() + 1;
                const academicYear = calendarYearToAcademicYear(calYear, calMonth);
                const allInvoices = await prisma.invoice.findMany({
                    where: { enrollmentId: invoice.enrollmentId, serialNumber: { startsWith: '26-' } },
                    orderBy: [{ startDate: 'asc' }, { serialNumber: 'asc' }],
                    select: { id: true },
                });
                const position = allInvoices.findIndex(i => i.id === invoice.id) + 1;
                const pushResult = await pushPayment({
                    sheetsId: invoice.enrollment.sheetsId,
                    academicYear,
                    amount: invoice.amount,
                    paymentDate,
                    paymentCount: position,
                });
                sheetPushed = pushResult.success && pushResult.verified;
                if (!sheetPushed) {
                    console.warn(`[verify] Sheet push not verified for ${invoice.enrollment.sheetsId}: ${pushResult.error}`);
                }
            } catch (e) {
                console.error(`[verify] pushPayment failed for ${invoice.enrollment.sheetsId}:`, e);
            }

            if (sheetPushed) {
                await prisma.invoice.update({
                    where: { id: invoice.id },
                    data: { sheetPushed: true },
                });
            }

            return NextResponse.json({
                success: true,
                paymentId: payment.id,
                invoiceStatus: 'paid',
                sheetPushed,
            });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
