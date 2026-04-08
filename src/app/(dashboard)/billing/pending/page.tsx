import prisma from '@/lib/prisma';
import { Banknote } from 'lucide-react';
import Link from 'next/link';
import { PendingAccordion } from './PendingAccordion';

export default async function PendingPage() {
  // 查詢所有 pending 狀態的收費單（已推 Sheets，待收費）
  const invoices = await prisma.invoice.findMany({
    where: { status: 'pending' },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
    orderBy: [{ startDate: 'asc' }],
  });

  // 按 sheetsId 分組
  const grouped = new Map<string, {
    sheetsId: string;
    name: string;
    className: string;
    invoices: {
      id: number;
      serialNumber: string;
      amount: number;
      startDate: string;
      endDate: string;
      dates: string[];
      createdAt: string;
    }[];
  }>();

  for (const inv of invoices) {
    const sid = inv.enrollment.sheetsId;
    if (!grouped.has(sid)) {
      grouped.set(sid, {
        sheetsId: sid,
        name: inv.enrollment.person.name,
        className: inv.enrollment.className,
        invoices: [],
      });
    }
    const records = (inv.records || []) as { date: string }[];
    const dates = records.map(r => r.date.replace(/^\d{4}\//, ''));
    grouped.get(sid)!.invoices.push({
      id: inv.id,
      serialNumber: inv.serialNumber,
      amount: inv.amount,
      startDate: inv.startDate.toISOString().slice(0, 10),
      endDate: inv.endDate.toISOString().slice(0, 10),
      dates,
      createdAt: inv.createdAt.toISOString().slice(0, 10),
    });
  }

  // 按 sheetsId 排序
  const students = [...grouped.values()].sort(
    (a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId)
  );

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Banknote className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">未銷帳</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {students.length} 人 / {invoices.length} 張 / ${totalAmount.toLocaleString()}
          </span>
          <Link href="/billing" className="text-sm text-blue-600 hover:underline">
            ← 返回收費管理
          </Link>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          目前沒有待收費的收費單
        </div>
      ) : (
        <div className="space-y-2">
          <PendingAccordion students={students} />
        </div>
      )}
    </div>
  );
}
