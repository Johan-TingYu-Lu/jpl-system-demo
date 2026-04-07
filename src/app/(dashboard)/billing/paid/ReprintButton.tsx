'use client';

import { useState } from 'react';

export function ReprintButton({ invoiceId, serial }: { invoiceId: number; serial: string }) {
  const [loading, setLoading] = useState(false);

  async function handleReprint() {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`補印失敗: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${serial}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`補印失敗: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleReprint}
      disabled={loading}
      className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
    >
      {loading ? '生成中...' : '📄 補印'}
    </button>
  );
}
