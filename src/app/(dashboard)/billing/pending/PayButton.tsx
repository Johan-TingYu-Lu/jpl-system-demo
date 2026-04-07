'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PayButton({ invoiceId, serial, amount }: { invoiceId: number; serial: string; amount: number }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handlePay() {
    if (!confirm(`確認銷帳 ${serial}，金額 $${amount.toLocaleString()}？`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'cash' }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        router.refresh();
      } else {
        alert(`銷帳失敗: ${data.error}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="text-xs px-2 py-1 rounded bg-green-50 text-green-600">已銷帳 ✓</span>;
  }

  return (
    <button
      onClick={handlePay}
      disabled={loading}
      className="text-xs px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
    >
      {loading ? '處理中...' : '銷帳'}
    </button>
  );
}
