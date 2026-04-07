'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  invoiceIds: number[];
}

export function BatchPushButton({ invoiceIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);
  const router = useRouter();

  if (invoiceIds.length === 0) return null;

  async function handleBatchPush() {
    if (!confirm(`確認推送 ${invoiceIds.length} 筆繳費紀錄到 Sheet？`)) return;

    setLoading(true);
    let success = 0;
    let failed = 0;

    for (const id of invoiceIds) {
      try {
        const res = await fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: id, target: 'payment' }),
        });
        const data = await res.json();
        if (data.success) {
          success++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    setResults({ success, failed });
    setLoading(false);
    router.refresh();
  }

  if (results) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-green-700">
          完成：{results.success} 筆推送成功
          {results.failed > 0 && `，${results.failed} 筆失敗`}
        </span>
        <button
          onClick={() => router.refresh()}
          className="text-xs px-3 py-1.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
        >
          重新整理
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleBatchPush}
      disabled={loading}
      className="px-4 py-2 rounded-lg bg-green-500 text-white font-medium text-sm hover:bg-green-600 disabled:opacity-50"
    >
      {loading ? '推送中...' : `批次推送 Sheet (${invoiceIds.length} 筆)`}
    </button>
  );
}
