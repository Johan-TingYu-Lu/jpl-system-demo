import prisma from '@/lib/prisma';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import { ReprintButton } from './ReprintButton';

export default async function PaidPage() {
  const now = new Date();
  const currentYear = calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);
  const serialPrefix = currentYear === 114 ? '26-' : `${currentYear - 100}-`;

  // 查詢當學年所有 paid 狀態的收費單
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

  // 按 sheetsId 數字排序，同 ID 按 endDate 排序
  invoices.sort((a, b) => {
    const idDiff = parseInt(a.enrollment.sheetsId) - parseInt(b.enrollment.sheetsId);
    if (idDiff !== 0) return idDiff;
    return a.endDate.getTime() - b.endDate.getTime();
  });

  // 計算總金額
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
            {currentYear} 學年 · {invoices.length} 筆 · 總計 ${totalAmount.toLocaleString()}
          </span>
          <Link href="/billing" className="text-sm text-blue-600 hover:underline">
            ← 返回收費管理
          </Link>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          本學年尚無已銷帳的收費單
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">姓名</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">班級</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">收費單編號</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">收費日期</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">金額</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">繳費日期</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(inv => {
                  const records = (inv.records || []) as { date: string }[];
                  const dates = records.map(r => r.date.replace(/^\d{4}\//, ''));
                  return (
                    <tr key={inv.id} className="hover:bg-green-50/30">
                      <td className="px-4 py-3 font-mono text-gray-500">{inv.enrollment.sheetsId}</td>
                      <td className="px-4 py-3">
                        <Link href={`/students/${inv.enrollment.sheetsId}`} className="font-medium text-gray-900 hover:text-blue-600">
                          {inv.enrollment.person.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{inv.enrollment.className}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.serialNumber}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {dates.length > 0 ? dates.join(', ') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-green-700">
                        ${inv.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {inv.payments[0]?.paymentDate ? inv.payments[0].paymentDate.toISOString().slice(0, 10) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ReprintButton invoiceId={inv.id} serial={inv.serialNumber} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
