import prisma from '@/lib/prisma';
import { Banknote } from 'lucide-react';
import Link from 'next/link';
import { PayButton } from './PayButton';
import { CancelButton } from './CancelButton';

export default async function PendingPage() {
  // 查詢所有 pending 狀態的收費單（已推 Sheets，待收費）
  const invoices = await prisma.invoice.findMany({
    where: { status: 'pending' },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
    orderBy: [{ enrollment: { sheetsId: 'asc' } }],
  });

  // 按 sheetsId 數字排序
  invoices.sort((a, b) => parseInt(a.enrollment.sheetsId) - parseInt(b.enrollment.sheetsId));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Banknote className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">銷帳流程</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            {invoices.length} 筆待收費
          </span>
          <Link href="/billing" className="text-sm text-blue-600 hover:underline">
            ← 返回收費管理
          </Link>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          目前沒有待收費的收費單
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
                  <th className="text-left px-4 py-3 font-medium text-gray-500">建立日期</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(inv => {
                  const records = (inv.records || []) as { date: string }[];
                  const dates = records.map(r => r.date.replace(/^\d{4}\//, ''));
                  return (
                    <tr key={inv.id} className="hover:bg-amber-50/30">
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
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold text-amber-700">
                        ${inv.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {inv.createdAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <PayButton invoiceId={inv.id} serial={inv.serialNumber} amount={inv.amount} />
                          <CancelButton invoiceId={inv.id} serial={inv.serialNumber} name={inv.enrollment.person.name} />
                        </div>
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
