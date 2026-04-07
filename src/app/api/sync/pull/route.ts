/**
 * API: /api/sync/pull — 從 Google Sheets 拉取資料到 DB
 */
import { NextResponse } from 'next/server';
import { pullAll, pullStudents, pullAttendance, pullBillingHistory } from '@/lib/sync-engine';
import { createAuditLog } from '@/lib/audit';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const target = (body as { target?: string }).target || 'all';

        let result;

        switch (target) {
            case 'students':
                const studentResult = await pullStudents();
                result = { ...studentResult, target: 'students' };
                break;
            case 'attendance':
                const vectors = await pullAttendance();
                result = { attendanceVectors: vectors, target: 'attendance' };
                break;
            case 'billing':
                const billingResult = await pullBillingHistory();
                result = { ...billingResult, target: 'billing' };
                break;
            case 'all':
            default:
                result = await pullAll();
                break;
        }

        await createAuditLog({
            tableName: 'sync',
            recordId: 0,
            action: 'UPDATE',
            afterData: { target, ...result },
            changedBy: 'web',
            reason: `Sync pull: ${target}`,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('Sync error:', error);
        return NextResponse.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
}
