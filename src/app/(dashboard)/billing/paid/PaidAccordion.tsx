'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ReprintButton } from './ReprintButton';

export interface PaidInvoiceItem {
  id: number;
  serialNumber: string;
  amount: number;
  dates: string[];
  paymentDate: string | null;
}

export interface PaidStudentGroup {
  sheetsId: string;
  name: string;
  className: string;
  invoices: PaidInvoiceItem[];
}

export default function PaidAccordion({ groups }: { groups: PaidStudentGroup[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        本學年尚無已銷帳的收費單
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map(student => {
        const isOpen = openIds.has(student.sheetsId);
        const total = student.invoices.reduce((s, i) => s + i.amount, 0);

        return (
          <div key={student.sheetsId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div
              className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer select-none"
              onClick={() => toggle(student.sheetsId)}
            >
              <div className="mr-3 text-gray-400">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
              <span className="font-mono text-sm text-gray-500 w-12">{student.sheetsId}</span>
              <Link
                href={`/students/${student.sheetsId}`}
                onClick={e => e.stopPropagation()}
                className="font-medium text-gray-900 hover:text-blue-600 w-24"
              >
                {student.name}
              </Link>
              <span className="text-xs text-gray-500 w-32">{student.className}</span>
              <span className="text-xs text-green-600 font-medium w-16">{student.invoices.length} 張</span>
              <span className="font-mono text-sm font-bold text-green-700 flex-1">${total.toLocaleString()}</span>
            </div>

            {isOpen && (
              <div className="border-t border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">編號</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">收費日期</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-400 text-xs">金額</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">繳費日期</th>
                      <th className="text-center px-4 py-2 font-medium text-gray-400 text-xs">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {student.invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-green-50/20">
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{inv.serialNumber}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {inv.dates.length > 0 ? inv.dates.join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-bold text-green-700">
                          ${inv.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {inv.paymentDate ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <ReprintButton invoiceId={inv.id} serial={inv.serialNumber} />
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
    </div>
  );
}
