import prisma from '@/lib/prisma';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import { extractBillableDates, formatDateUTC } from '@/lib/attendance-utils';
import { calculateBilling } from '@/lib/billing-engine';
import { resolveAllRateConfigs } from '@/lib/rate-resolver';
import BillingTable, { type StudentRow, type DraftInvoice } from './BillingTable';

export default async function BillingPage() {
  const now = new Date();
  const currentYear = calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);

  // 1. 載入在學學生 + latest invoice + attendance
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'active' },
    include: {
      person: { select: { name: true } },
      invoices: {
        orderBy: { endDate: 'desc' },
        take: 1,
        select: { id: true, serialNumber: true, amount: true, status: true, endDate: true },
      },
      attendances: {
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      },
      _count: { select: { invoices: true } },
    },
    orderBy: [{ classCode: 'asc' }, { sheetsId: 'asc' }],
  });

  // 2. 載入所有 pending 收費單（已推 Sheets，待收費）
  const draftInvoices = await prisma.invoice.findMany({
    where: { status: 'pending' },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
    orderBy: [{ enrollment: { sheetsId: 'asc' } }],
  });

  // 按 sheetsId 排序
  draftInvoices.sort((a, b) => parseInt(a.enrollment.sheetsId) - parseInt(b.enrollment.sheetsId));

  const drafts: DraftInvoice[] = draftInvoices.map(inv => {
    const records = (inv.records || []) as { date: string }[];
    const dates = records.map(r => r.date.replace(/^\d{4}\//, ''));
    return {
      id: inv.id,
      sheetsId: inv.enrollment.sheetsId,
      name: inv.enrollment.person.name,
      className: inv.enrollment.className,
      serialNumber: inv.serialNumber,
      amount: inv.amount,
      dates,
      createdAt: inv.createdAt.toISOString().slice(0, 10),
    };
  });

  // 3. 批次解析費率
  const rateMap = await resolveAllRateConfigs();

  // 4. 計算每位學生的 Y 進度（僅用於「未生成」tab）
  const rows: StudentRow[] = enrollments.map(e => {
    const latest = e.invoices[0];
    const lastEndDate = latest?.endDate ?? null;
    const resolved = rateMap.get(e.sheetsId);
    const rateConfig = resolved?.config;

    let currentY = 0;
    let targetY = 10;
    let canGenerate = false;
    let billingDates: string[] = [];
    let estimatedFee: number | null = null;

    if (rateConfig) {
      targetY = rateConfig.settlementSessions * 2;
      const billable = extractBillableDates(e.attendances, { useUTC: false, validateDate: true });
      const afterStr = lastEndDate ? formatDateUTC(lastEndDate) : null;
      const filtered = billable
        .filter(b => !afterStr || b.dateStr > afterStr)
        .map(b => ({ date: b.dateStr, status: b.code as 2 | 3 }));

      if (filtered.length > 0) {
        const billing = calculateBilling(filtered, rateConfig, 'normal');
        currentY = billing.totalY;
        canGenerate = billing.canGenerate;

        // 如果該學生已有 pending（待收）invoice，先收完再開新的
        if (canGenerate && latest?.status === 'pending') {
          canGenerate = false;
        }

        if (billing.records.length > 0) {
          billingDates = billing.records.map(r => r.date.replace(/^\d{4}\//, ''));
          estimatedFee = billing.totalFee;
        }
      }
    }

    return {
      id: e.id,
      sheetsId: e.sheetsId,
      name: e.person.name,
      className: e.className,
      invoiceCount: e._count.invoices,
      latestInvoiceId: latest?.id ?? null,
      latestSerial: latest?.serialNumber ?? null,
      latestAmount: latest?.amount ?? null,
      latestStatus: latest?.status ?? null,
      currentY,
      targetY,
      canGenerate,
      plan: resolved?.planName ?? '?',
      billingDates,
      estimatedFee,
    };
  });

  // 5. 排序：Y 進度高 → 同進度照 ID 小到大
  rows.sort((a, b) => {
    if (a.currentY !== b.currentY) return b.currentY - a.currentY;
    return parseInt(a.sheetsId) - parseInt(b.sheetsId);
  });

  const readyCount = rows.filter(r => r.canGenerate).length;

  return (
    <BillingTable
      rows={rows}
      readyCount={readyCount}
      draftInvoices={drafts}
      currentYear={currentYear}
    />
  );
}
