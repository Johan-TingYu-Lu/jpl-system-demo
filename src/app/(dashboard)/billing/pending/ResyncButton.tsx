'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

interface ResyncDiff {
  field: string;
  before: unknown;
  after: unknown;
}

interface ResyncResult {
  success: boolean;
  serialNumber: string;
  diffs: ResyncDiff[];
  applied: boolean;
  error?: string;
}

const FIELD_LABELS: Record<string, string> = {
  records: '出勤日',
  amount: '金額',
  totalY: 'Y合計',
  yyCount: 'YY次',
  yCount: 'Y次',
};

export function ResyncButton({ invoiceId, serial }: { invoiceId: number; serial: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResyncResult | null>(null);

  async function handleResync(dryRun: boolean) {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/resync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const data: ResyncResult = await res.json();
      setResult(data);

      if (data.applied) {
        router.refresh();
      }
    } catch {
      setResult({ success: false, serialNumber: serial, diffs: [], applied: false, error: '網路錯誤' });
    } finally {
      setLoading(false);
    }
  }

  // Show diff dialog
  if (result && result.diffs.length > 0 && !result.applied) {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 text-left max-w-xs">
          <div className="font-medium text-blue-800 mb-1">差異預覽</div>
          {result.diffs.map((d, i) => (
            <div key={i} className="text-xs">
              <span className="text-gray-500">{FIELD_LABELS[d.field] || d.field}: </span>
              <span className="text-red-500 line-through">{String(d.before)}</span>
              <span className="mx-1">→</span>
              <span className="text-green-600">{String(d.after)}</span>
            </div>
          ))}
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => handleResync(false)}
              disabled={loading}
              className="bg-green-600 text-white text-xs px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? '更新中...' : '確認更新'}
            </button>
            <button
              onClick={() => setResult(null)}
              className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded hover:bg-gray-300"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show result message
  if (result) {
    const msg = result.applied
      ? '已更新'
      : result.diffs.length === 0
        ? '無差異'
        : result.error || '失敗';
    const color = result.applied ? 'text-green-600' : result.error ? 'text-red-500' : 'text-gray-500';
    return (
      <span className={`text-xs ${color}`}>
        {msg}
        <button onClick={() => setResult(null)} className="ml-1 underline text-gray-400">
          OK
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => handleResync(true)}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-50 transition-colors"
      title="從出勤紀錄重新計算此收費單"
    >
      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
      {loading ? '計算中...' : '重算'}
    </button>
  );
}
