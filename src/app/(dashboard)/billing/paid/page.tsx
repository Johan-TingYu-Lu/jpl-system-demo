import prisma from '@/lib/prisma';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import PaidAccordion, { type PaidStudentGroup } from './PaidAccordion';

export default async function PaidPage() {
  const now = new Date();
  const currentYear = calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);
  const serialPrefix = currentYear === 114 ? '26-' : `${currentYear - 100}-`;

  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'paid',
      serialNumber: { startsWith: serialPrefix },
    },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
      payments: {
        orderBy: { paymentDate: 'desc' },
        take: 1,
        select: { paymentDate: true },
      },
    },
  });

  // 按 sheetsId 分組
  const groupMap = new Map<string, PaidStudentGroup>();
  for (const inv of invoices) {
    const sid = inv.enrollment.sheetsId;
    if (!groupMap.has(sid)) {
      groupMap.set(sid, {
        sheetsId: sid,
        name: inv.enrollment.person.name,
        className: inv.enrollment.className,
        invoices: [],
      });
    }
    const records = (inv.records || []) as { date: string }[];
    const dates = records.map(r => r.date.replace(/^\d{4}\//, ''));
    groupMap.get(sid)!.invoices.push({
      id: inv.id,
      serialNumber: inv.serialNumber,
      amount: inv.amount,
      dates,
      paymentDate: inv.payments[0]?.paymentDate
        ? inv.payments[0].paymentDate.toISOString().slice(0, 10)
        : null,
    });
  }

  // 組內按 serialNumber 排序，組間按 sheetsId 數字排序
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));
  for (const g of groups) {
    g.invoices.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  }

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-500" />
          <h1 className="text-2xl font-bold text-gray-900">已銷帳收費單</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            {currentYear} 學年 · {groups.length} 人 · {invoices.length} 筆 · 總計 ${totalAmount.toLocaleString()}
          </span>
          <Link href="/billing" className="text-sm text-blue-600 hover:underline">
            ← 返回收費管理
          </Link>
        </div>
      </div>

      <PaidAccordion groups={groups} />
    </div>
  );
}
