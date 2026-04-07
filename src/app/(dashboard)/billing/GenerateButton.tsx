'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'idle' | 'syncing' | 'generating' | 'rendering' | 'done' | 'error';

/** 單一學生的「生成收費單」按鈕 */
export function GenerateOneButton({ sheetsId }: { sheetsId: string }) {
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setStep('syncing');
    setMessage(null);

    try {
      // Step 1: 同步 Sheets → DB（出勤 + FLAG）
      const syncRes = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'all' }),
      });
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}));
        setStep('error');
        setMessage(`同步失敗: ${err.error || syncRes.statusText}`);
        return;
      }

      // Step 2: 生成收費單
      setStep('generating');
      const genRes = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsId }),
      });
      const data = await genRes.json();

      if (data.success) {
        // Step 3: 生成 PDF 並直接下載
        setStep('rendering');
        const pdfRes = await fetch(`/api/invoices/${data.invoiceId}/pdf`, { method: 'POST' });
        if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
          const blob = await pdfRes.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${data.serialNumber}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setStep('done');
          setMessage(`$${data.billing?.totalFee?.toLocaleString() ?? '?'}`);
        } else {
          const errData = await pdfRes.json().catch(() => ({}));
          setStep('error');
          setMessage(`PDF失敗: ${errData.error || pdfRes.statusText}`);
        }
        router.refresh();
      } else {
        setStep('done');
        setMessage(data.error || '未達門檻');
      }
    } catch {
      setStep('error');
      setMessage('網路錯誤');
    }
  }

  const isLoading = step === 'syncing' || step === 'generating' || step === 'rendering';

  const label = {
    idle: '生成',
    syncing: '同步中...',
    generating: '計算中...',
    rendering: 'PDF生成中...',
    done: message ?? '完成',
    error: '重試',
  }[step];

  const color = {
    idle: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
    syncing: 'bg-yellow-50 text-yellow-600',
    generating: 'bg-yellow-50 text-yellow-600',
    rendering: 'bg-yellow-50 text-yellow-600',
    done: message?.startsWith('$') ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500',
    error: 'bg-red-50 text-red-600 hover:bg-red-100',
  }[step];

  function handleRetry() {
    setStep('idle');
    setMessage(null);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={step === 'error' ? handleRetry : handleClick}
        disabled={isLoading}
        className={`text-xs px-2 py-1 rounded disabled:opacity-50 whitespace-nowrap ${color}`}
      >
        {label}
      </button>
      {message && step === 'error' && (
        <span className="text-xs text-red-500 max-w-[120px] truncate" title={message}>{message}</span>
      )}
    </div>
  );
}

/** 下載 PDF 按鈕 — 已生成的 draft 收費單重新生成/下載 PDF */
export function DownloadPdfButton({ invoiceId, serial }: { invoiceId: number; serial: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { method: 'POST' });
      if (res.ok && res.headers.get('Content-Type')?.includes('application/pdf')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${serial}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`PDF 生成失敗: ${err.error || res.statusText}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
    >
      {loading ? 'PDF中...' : '下載PDF'}
    </button>
  );
}

/** 復原按鈕 — 刪除 draft 收費單 + 清 Sheet */
export function RevertButton({ invoiceId, serial }: { invoiceId: number; serial: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleRevert() {
    if (!confirm(`確定要復原收費單 ${serial}？\n將刪除此收費單並清除 Google Sheets 上的記錄。`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/revert`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        router.refresh();
      } else {
        alert(`復原失敗: ${data.error}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  if (done) return <span className="text-xs text-gray-400">已復原</span>;

  return (
    <button
      onClick={handleRevert}
      disabled={loading}
      className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
    >
      {loading ? '復原中...' : '復原'}
    </button>
  );
}

/** 全部生成按鈕（Sync → Generate All） */
export function GenerateAllButton() {
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    if (!confirm('將先同步 Google Sheets 出勤資料，再為所有達門檻的學生生成收費單。確定？')) return;

    setStep('syncing');
    setMessage(null);

    try {
      // Step 1: 同步 Sheets → DB
      const syncRes = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'all' }),
      });
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}));
        setStep('error');
        setMessage(`同步失敗: ${err.error || syncRes.statusText}`);
        return;
      }
      const syncData = await syncRes.json();

      // Step 2: 全部生成收費單（generateAllInvoices 內部也會再 pullBillingHistory）
      setStep('generating');
      const genRes = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await genRes.json();

      if (data.success !== false) {
        setStep('done');
        setMessage(`同步完成，生成 ${data.generated} 張收費單`);
        router.refresh();
      } else {
        setStep('error');
        setMessage(data.error || '生成失敗');
      }
    } catch {
      setStep('error');
      setMessage('網路錯誤');
    }
  }

  const isLoading = step === 'syncing' || step === 'generating';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {step === 'syncing' ? '同步 Sheets 中...' :
         step === 'generating' ? '生成收費單中...' :
         '同步 & 生成收費單'}
      </button>
      {message && (
        <span className={`text-xs ${step === 'error' ? 'text-red-500' : 'text-green-600'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
