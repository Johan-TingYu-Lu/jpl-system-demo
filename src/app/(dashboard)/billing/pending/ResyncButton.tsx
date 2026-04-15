'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

interface ResyncResult {
  success: boolean;
  deleted?: string;
  deletedAmount?: number;
  newSerial?: string;
  newAmount?: number;
  newInvoiceId?: number;
  pdfGenerated?: boolean;
  sheetPushed?: boolean;
  error?: string;
}

export function ResyncButton({ invoiceId, serial }: { invoiceId: number; serial: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResyncResult | null>(null);

  async function handleResync() {
    if (!confirm(`確認重算 ${serial}？\n\n將刪除此收費單，重新從出勤紀錄計算到滿額後生成新的收費單。`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/resync`, {
        method: 'POST',
      });
      const data: ResyncResult = await res.json();
      setResult(data);
      if (data.success) {
        // Download PDF if available
        if (data.newInvoiceId && data.pdfGenerated) {
          try {
            const pdfRes = await fetch(`/api/invoices/${data.newInvoiceId}/pdf`, { method: 'POST' });
            if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
              const blob = await pdfRes.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${data.newSerial}.pdf`;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch { /* PDF download failure is non-fatal */ }
        }
        router.refresh();
      }
    } catch {
      setResult({ success: false, error: '網路錯誤' });
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    if (result.success) {
      return (
        <span className="text-xs text-green-600">
          {result.newSerial} ${result.newAmount?.toLocaleString()}
          <button onClick={() => setResult(null)} className="ml-1 underline text-gray-400">OK</button>
        </span>
      );
    }
    return (
      <span className="text-xs text-red-500">
        {result.error}
        <button onClick={() => setResult(null)} className="ml-1 underline text-gray-400">OK</button>
      </span>
    );
  }

  return (
    <button
      onClick={handleResync}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-50 transition-colors"
      title="刪除此收費單，重新從出勤紀錄計算到滿額"
    >
      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
      {loading ? '重算中...' : '重算'}
    </button>
  );
}
