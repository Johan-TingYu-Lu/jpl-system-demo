import prisma from '@/lib/prisma';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import { extractBillableDates, formatDateUTC } from '@/lib/attendance-utils';
import { calculateBilling, type BilledRecord } from '@/lib/billing-engine';
import { resolveAllRateConfigs } from '@/lib/rate-resolver';
import { classifyShape, type InvoiceShape } from '@/lib/invoice-validator';
import BillingTable, { type StudentRow } from './BillingTable';

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
        select: { id: true, serialNumber: true, amount: true, status: true, endDate: true, records: true },
      },
      attendances: {
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      },
      _count: { select: { invoices: true } },
    },
    orderBy: [{ classCode: 'asc' }, { sheetsId: 'asc' }],
  });

  // 2. 載入 draft + pending + archived 收費單
  //    draft = 已生成但 Sheet 推送失敗，需要老師手動觸發重推
  //    pending = 已在 Sheet 上、等待繳費
  //    archived = 已封存
  const allInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['draft', 'pending', 'archived'] } },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
    orderBy: [{ startDate: 'asc' }],
  });

  // 分組函式（含 shape 分類 + status）
  function groupByStudent(invoices: typeof allInvoices) {
    const map = new Map<string, {
      sheetsId: string; name: string; className: string;
      invoices: {
        id: number; serialNumber: string; amount: number;
        startDate: string; endDate: string; dates: string[]; createdAt: string;
        shape: InvoiceShape;
        status: string;
      }[];
    }>();
    for (const inv of invoices) {
      const sid = inv.enrollment.sheetsId;
      if (!map.has(sid)) {
        map.set(sid, { sheetsId: sid, name: inv.enrollment.person.name, className: inv.enrollment.className, invoices: [] });
      }
      const records = (inv.records || []) as unknown as BilledRecord[];
      const shape = classifyShape(records).shape;
      map.get(sid)!.invoices.push({
        id: inv.id, serialNumber: inv.serialNumber, amount: inv.amount,
        startDate: inv.startDate.toISOString().slice(0, 10),
        endDate: inv.endDate.toISOString().slice(0, 10),
        dates: records.map(r => `${r.date.replace(/^\d{4}\//, '')}${r.isSplit ? '*' : ''}`),
        createdAt: inv.createdAt.toISOString().slice(0, 10),
        shape,
        status: inv.status,
      });
    }
    return [...map.values()].sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));
  }

  // draft + pending 合進「未銷帳」tab（前端用 status 分顯按鈕）
  const unpaidInvoices = allInvoices.filter(i => i.status === 'draft' || i.status === 'pending');
  const archivedInvoices = allInvoices.filter(i => i.status === 'archived');
  const pendingGroups = groupByStudent(unpaidInvoices);
  const archivedGroups = groupByStudent(archivedInvoices);

  const draftCount = allInvoices.filter(i => i.status === 'draft').length;
  const pendingOnlyCount = allInvoices.filter(i => i.status === 'pending').length;

  // 3. 批次解析費率
  const rateMap = await resolveAllRateConfigs();

  // 3b. canGenerate 統一由 billing-engine 計算，不再依賴 Sheets P 欄

  // 4. 計算每位學生的 Y 進度（僅用於「未生成」tab）
  const rows: StudentRow[] = enrollments.map(e => {
    const latest = e.invoices[0];
    // FLAG: 優先用 records 最後一天，fallback 用 endDate
    let lastEndDate: Date | null = latest?.endDate ?? null;
    let carriedFromPrev: { date: string } | undefined;
    if (latest) {
      const recs = latest.records as { date: string; isSplit?: boolean }[] | null;
      if (recs && Array.isArray(recs) && recs.length > 0) {
        const lastRecObj = recs[recs.length - 1];
        const [y, m, d] = lastRecObj.date.split('/').map(Number);
        lastEndDate = new Date(Date.UTC(y, m - 1, d));
        // 拆分鏈條：上張帶出 1Y → 估算也要帶入，否則「未生成」進度/預估金額會跟實際生成對不上
        if (lastRecObj.isSplit) carriedFromPrev = { date: lastRecObj.date };
      }
    }
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
        const billing = calculateBilling(filtered, rateConfig, 'normal', carriedFromPrev);
        currentY = billing.totalY;

        canGenerate = billing.canGenerate;

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
      pendingGroups={pendingGroups}
      archivedGroups={archivedGroups}
      pendingCount={pendingOnlyCount}
      draftCount={draftCount}
      archivedCount={archivedInvoices.length}
      currentYear={currentYear}
    />
  );
}
