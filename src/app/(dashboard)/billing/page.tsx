import prisma from '@/lib/prisma';
import { calendarYearToAcademicYear, getYearConfig } from '@/lib/year-config';
import { extractBillableDates, formatDateUTC } from '@/lib/attendance-utils';
import { calculateBilling } from '@/lib/billing-engine';
import { resolveAllRateConfigs } from '@/lib/rate-resolver';
import { readSheet } from '@/lib/sheets';
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
        select: { id: true, serialNumber: true, amount: true, status: true, endDate: true },
      },
      attendances: {
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      },
      _count: { select: { invoices: true } },
    },
    orderBy: [{ classCode: 'asc' }, { sheetsId: 'asc' }],
  });

  // 2. 載入 pending + archived 收費單
  const allInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['pending', 'archived'] } },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
    orderBy: [{ startDate: 'asc' }],
  });

  // 分組函式
  function groupByStudent(invoices: typeof allInvoices) {
    const map = new Map<string, {
      sheetsId: string; name: string; className: string;
      invoices: { id: number; serialNumber: string; amount: number; startDate: string; endDate: string; dates: string[]; createdAt: string }[];
    }>();
    for (const inv of invoices) {
      const sid = inv.enrollment.sheetsId;
      if (!map.has(sid)) {
        map.set(sid, { sheetsId: sid, name: inv.enrollment.person.name, className: inv.enrollment.className, invoices: [] });
      }
      const records = (inv.records || []) as { date: string }[];
      map.get(sid)!.invoices.push({
        id: inv.id, serialNumber: inv.serialNumber, amount: inv.amount,
        startDate: inv.startDate.toISOString().slice(0, 10),
        endDate: inv.endDate.toISOString().slice(0, 10),
        dates: records.map(r => r.date.replace(/^\d{4}\//, '')),
        createdAt: inv.createdAt.toISOString().slice(0, 10),
      });
    }
    return [...map.values()].sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));
  }

  const pendingInvoices = allInvoices.filter(i => i.status === 'pending');
  const archivedInvoices = allInvoices.filter(i => i.status === 'archived');
  const pendingGroups = groupByStudent(pendingInvoices);
  const archivedGroups = groupByStudent(archivedInvoices);

  // 3. 批次解析費率
  const rateMap = await resolveAllRateConfigs();

  // 3b. 讀 Sheets 學費收支總表 P 欄（應製單數），作為 canGenerate 的真理來源
  const sheetsPMap = new Map<string, number>();
  try {
    const config = getYearConfig(currentYear);
    if (config) {
      const rows = await readSheet("'學費收支總表'!A2:P300", config.spreadsheetId);
      for (const row of rows) {
        const id = String(row[0] || '');
        const P = parseInt(String(row[15] || '0'));
        if (id) sheetsPMap.set(id, P);  // 包含 P=0 的，這樣 fallback 不會誤判
      }
    }
  } catch (e) {
    console.error('[billing] Failed to read Sheets P column, falling back to DB:', e);
  }

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

        // canGenerate 以 Sheets P 欄為準（真理來源）
        // sheetsPMap 有此學生 → 用 Sheets P 值；沒有（Sheets 讀取失敗）→ fallback billing engine
        if (sheetsPMap.has(e.sheetsId)) {
          canGenerate = (sheetsPMap.get(e.sheetsId) ?? 0) > 0;
        } else {
          canGenerate = billing.canGenerate;
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
      pendingGroups={pendingGroups}
      archivedGroups={archivedGroups}
      pendingCount={pendingInvoices.length}
      archivedCount={archivedInvoices.length}
      currentYear={currentYear}
    />
  );
}
