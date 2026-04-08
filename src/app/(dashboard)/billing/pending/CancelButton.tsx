'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CancelButton({ invoiceId, serial, name }: { invoiceId: number; serial: string; name: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    if (!confirm(`確定將 ${name} 的 ${serial} 設為「不再計費」？\n\n此操作會刪除此收費單並清除 Sheets 上的計費日期。`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        router.refresh();
      } else {
        alert(`操作失敗: ${data.error}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">已移除</span>;
  }

  return (
    <button
      onClick={handleCancel}
      disabled={loading}
      className="text-xs px-2 py-1 rounded border border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-50"
      title="不再計費：移除此收費單"
    >
      {loading ? '...' : '不再計費'}
    </button>
  );
}
