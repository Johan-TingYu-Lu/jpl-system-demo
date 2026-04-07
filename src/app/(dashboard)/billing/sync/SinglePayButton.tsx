'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  invoiceId: number;
  serial: string;
}

export function SinglePayButton({ invoiceId, serial }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handlePay() {
    if (!confirm(`確認銷帳 ${serial}？`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'sheet_sync' }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        router.refresh();
      } else {
        alert(`銷帳失敗：${data.error ?? '未知錯誤'}`);
      }
    } catch {
      alert('銷帳失敗：網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="text-xs text-green-600 font-medium">已銷帳</span>;
  }

  return (
    <button
      onClick={handlePay}
      disabled={loading}
      className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 whitespace-nowrap"
    >
      {loading ? '處理中...' : '銷帳'}
    </button>
  );
}
