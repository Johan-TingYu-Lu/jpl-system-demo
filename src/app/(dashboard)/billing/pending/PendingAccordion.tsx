'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Archive } from 'lucide-react';
import { PayButton } from './PayButton';

interface InvoiceItem {
  id: number;
  serialNumber: string;
  amount: number;
  startDate: string;
  endDate: string;
  dates: string[];
  createdAt: string;
}

interface StudentGroup {
  sheetsId: string;
  name: string;
  className: string;
  invoices: InvoiceItem[];
}

export function PendingAccordion({ students }: { students: StudentGroup[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState<Set<string>>(new Set());
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const router = useRouter();

  function toggle(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleArchive(student: StudentGroup) {
    const count = student.invoices.length;
    const total = student.invoices.reduce((s, i) => s + i.amount, 0);
    if (!confirm(
      `封存 ${student.name} (${student.sheetsId}) 的 ${count} 張待收費單，共 $${total.toLocaleString()}？\n\n封存後不再出現在待收清單中。`
    )) return;

    setArchiving(prev => new Set(prev).add(student.sheetsId));

    let success = true;
    for (const inv of student.invoices) {
      try {
        const res = await fetch(`/api/invoices/${inv.id}/archive`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
          alert(`封存 ${inv.serialNumber} 失敗: ${data.error}`);
          success = false;
          break;
        }
      } catch {
        alert('網路錯誤');
        success = false;
        break;
      }
    }

    setArchiving(prev => {
      const next = new Set(prev);
      next.delete(student.sheetsId);
      return next;
    });

    if (success) {
      setArchived(prev => new Set(prev).add(student.sheetsId));
      router.refresh();
    }
  }

  return (
    <>
      {students.map(student => {
        if (archived.has(student.sheetsId)) return null;

        const isOpen = openIds.has(student.sheetsId);
        const isArchiving = archiving.has(student.sheetsId);
        const total = student.invoices.reduce((s, i) => s + i.amount, 0);

        return (
          <div key={student.sheetsId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Header - 手風琴外層 */}
            <div className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer select-none"
              onClick={() => toggle(student.sheetsId)}>
              <div className="mr-3 text-gray-400">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
              <span className="font-mono text-sm text-gray-500 w-12">{student.sheetsId}</span>
              <span className="font-medium text-gray-900 w-24">{student.name}</span>
              <span className="text-xs text-gray-500 w-28">{student.className}</span>
              <span className="text-xs text-amber-600 font-medium w-16">{student.invoices.length} 張</span>
              <span className="font-mono text-sm font-bold text-amber-700 flex-1">${total.toLocaleString()}</span>

              {/* Archive 按鈕 */}
              <button
                onClick={(e) => { e.stopPropagation(); handleArchive(student); }}
                disabled={isArchiving}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-500 hover:bg-red-50 hover:border-red-300 hover:text-red-500 disabled:opacity-50 transition-colors"
                title="封存：不再計費，從待收清單移除"
              >
                <Archive className="w-3.5 h-3.5" />
                {isArchiving ? '封存中...' : '封存'}
              </button>
            </div>

            {/* Body - 展開的收費單列表 */}
            {isOpen && (
              <div className="border-t border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">編號</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">計費區間</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">收費日期</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-400 text-xs">金額</th>
                      <th className="text-center px-4 py-2 font-medium text-gray-400 text-xs">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {student.invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-amber-50/20">
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{inv.serialNumber}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{inv.startDate} ~ {inv.endDate}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {inv.dates.length > 0 ? inv.dates.join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-bold text-amber-700">
                          ${inv.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <PayButton invoiceId={inv.id} serial={inv.serialNumber} amount={inv.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
