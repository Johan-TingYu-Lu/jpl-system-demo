'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────

export interface StudentRow {
  id: number;
  sheetsId: string;
  name: string;
  className: string;
  invoiceCount: number;
  latestInvoiceId: number | null;
  latestSerial: string | null;
  latestAmount: number | null;
  latestStatus: string | null;
  currentY: number;
  targetY: number;
  canGenerate: boolean;
  plan: string;
  billingDates: string[];
  estimatedFee: number | null;
}

export interface DraftInvoice {
  id: number;
  sheetsId: string;
  name: string;
  className: string;
  serialNumber: string;
  amount: number;
  dates: string[];
  createdAt: string;
}

type Tab = 'pending' | 'generate';
type JobStatus = 'idle' | 'generating' | 'pdf' | 'done' | 'error';

interface JobResult {
  sheetsId: string;
  status: JobStatus;
  invoiceId?: number;
  serial?: string;
  amount?: number;
  error?: string;
}

// ── Component ──────────────────────────────────────────

export default function BillingTable({
  rows,
  readyCount,
  draftInvoices,
  currentYear,
}: {
  rows: StudentRow[];
  readyCount: number;
  draftInvoices: DraftInvoice[];
  currentYear: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(draftInvoices.length > 0 ? 'pending' : 'generate');

  // ── Generate tab state ──
  const readyRows = rows.filter(r => r.canGenerate);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allReadySelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.sheetsId));
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [jobs, setJobs] = useState<Map<string, JobResult>>(new Map());
  const [batchSummary, setBatchSummary] = useState<string | null>(null);

  // ── Pending tab state ──
  const [paying, setPaying] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState<Set<number>>(new Set());
  const [paidSet, setPaidSet] = useState<Set<number>>(new Set());
  const [batchPayRunning, setBatchPayRunning] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);

  // ── Shared helpers ──

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDownloadPdf(invoiceId: number, serial: string) {
    setDownloading(prev => new Set(prev).add(invoiceId));
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { method: 'POST' });
      if (res.ok && res.headers.get('Content-Type')?.includes('application/pdf')) {
        const blob = await res.blob();
        triggerDownload(blob, `${serial}.pdf`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`PDF 生成失敗: ${err.error || res.statusText}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setDownloading(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
    }
  }

  // ── Pending tab handlers ──

  async function handlePay(invoiceId: number, serial: string, amount: number) {
    if (!confirm(`確認銷帳 ${serial}，金額 $${amount.toLocaleString()}？`)) return;

    setPaying(prev => new Set(prev).add(invoiceId));
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'cash' }),
      });
      const data = await res.json();
      if (data.success) {
        setPaidSet(prev => new Set(prev).add(invoiceId));
        router.refresh();
      } else {
        alert(`銷帳失敗: ${data.error}`);
      }
    } catch {
      alert('網路錯誤');
    } finally {
      setPaying(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
    }
  }

  async function handleRevert(invoiceId: number, serial: string) {
    if (!confirm(`確定要復原收費單 ${serial}？\n將刪除此收費單並清除 Google Sheets 上的記錄。`)) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/revert`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        router.refresh();
      } else {
        alert(`復原失敗: ${data.error}`);
      }
    } catch {
      alert('網路錯誤');
    }
  }

  async function handleBatchPay() {
    const unpaid = draftInvoices.filter(d => !paidSet.has(d.id));
    if (unpaid.length === 0) return;
    const total = unpaid.reduce((s, d) => s + d.amount, 0);
    if (!confirm(`將銷帳 ${unpaid.length} 張待收費的收費單（共 $${total.toLocaleString()}），確定？`)) return;

    setBatchPayRunning(true);
    setPendingSummary(null);
    let ok = 0, fail = 0;

    for (const inv of unpaid) {
      try {
        const res = await fetch(`/api/invoices/${inv.id}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'cash' }),
        });
        const data = await res.json();
        if (data.success) {
          setPaidSet(prev => new Set(prev).add(inv.id));
          ok++;
        } else { fail++; }
      } catch { fail++; }
    }

    setPendingSummary(`批次銷帳完成！成功 ${ok} 張${fail > 0 ? `，失敗 ${fail} 張` : ''}`);
    setBatchPayRunning(false);
    router.refresh();
  }

  async function handleBatchDownloadPdf() {
    const unpaid = draftInvoices.filter(d => !paidSet.has(d.id));
    if (unpaid.length === 0) return;
    if (!confirm(`將下載 ${unpaid.length} 張待收費的 PDF，確定？`)) return;
    for (const inv of unpaid) {
      await handleDownloadPdf(inv.id, inv.serialNumber);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ── Generate tab handlers ──

  const toggleOne = useCallback((sheetsId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sheetsId)) next.delete(sheetsId);
      else next.add(sheetsId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allReadySelected) setSelected(new Set());
    else setSelected(new Set(readyRows.map(r => r.sheetsId)));
  }, [allReadySelected, readyRows]);

  async function handleSingleGenerate(row: StudentRow) {
    if (!confirm(`確認為 ${row.name}（${row.sheetsId}）生成收費單？\n預估金額：$${row.estimatedFee?.toLocaleString() ?? '?'}`)) return;

    const newJobs = new Map(jobs);
    newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'generating' });
    setJobs(newJobs);

    try {
      const genRes = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsId: row.sheetsId }),
      });
      const data = await genRes.json();

      if (data.success) {
        const updated = new Map(jobs);
        updated.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'pdf', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
        setJobs(updated);

        const pdfRes = await fetch(`/api/invoices/${data.invoiceId}/pdf`, { method: 'POST' });
        if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
          triggerDownload(await pdfRes.blob(), `${data.serialNumber}.pdf`);
          const done = new Map(jobs);
          done.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'done', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
          setJobs(done);
        } else {
          const err = await pdfRes.json().catch(() => ({}));
          const errJobs = new Map(jobs);
          errJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: `PDF失敗: ${err.error || ''}` });
          setJobs(errJobs);
        }
      } else {
        const errJobs = new Map(jobs);
        errJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: data.error || '生成失敗' });
        setJobs(errJobs);
      }
    } catch {
      const errJobs = new Map(jobs);
      errJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: '網路錯誤' });
      setJobs(errJobs);
    }
    router.refresh();
  }

  async function handleBatchGenerate() {
    const toGenerate = readyRows.filter(r => selected.has(r.sheetsId));
    if (toGenerate.length === 0) return;
    if (!confirm(`將為 ${toGenerate.length} 位學生生成收費單。確定？`)) return;

    setIsBatchRunning(true);
    setBatchSummary(null);
    const newJobs = new Map<string, JobResult>();

    setIsSyncing(true);
    try {
      const syncRes = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'attendance' }),
      });
      if (!syncRes.ok) {
        setBatchSummary('同步失敗，請重試');
        setIsBatchRunning(false);
        setIsSyncing(false);
        return;
      }
    } catch {
      setBatchSummary('同步失敗（網路錯誤）');
      setIsBatchRunning(false);
      setIsSyncing(false);
      return;
    }
    setIsSyncing(false);

    let ok = 0, fail = 0;
    for (const row of toGenerate) {
      newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'generating' });
      setJobs(new Map(newJobs));

      try {
        const genRes = await fetch('/api/invoices/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetsId: row.sheetsId }),
        });
        const data = await genRes.json();

        if (data.success) {
          newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'pdf', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
          setJobs(new Map(newJobs));

          const pdfRes = await fetch(`/api/invoices/${data.invoiceId}/pdf`, { method: 'POST' });
          if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
            triggerDownload(await pdfRes.blob(), `${data.serialNumber}.pdf`);
            newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'done', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
            ok++;
          } else {
            const err = await pdfRes.json().catch(() => ({}));
            newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: `PDF失敗: ${err.error || ''}` });
            fail++;
          }
        } else {
          newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: data.error || '生成失敗' });
          fail++;
        }
      } catch {
        newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: '網路錯誤' });
        fail++;
      }
      setJobs(new Map(newJobs));
    }

    setBatchSummary(`完成！成功 ${ok} 張${fail > 0 ? `，失敗 ${fail} 張` : ''}`);
    setIsBatchRunning(false);
    setSelected(new Set());
    router.refresh();
  }

  const selectedCount = readyRows.filter(r => selected.has(r.sheetsId)).length;
  const unpaidCount = draftInvoices.filter(d => !paidSet.has(d.id)).length;

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">📋 收費管理</h1>
        <span className="text-sm text-gray-400">
          {currentYear} 學年 · {rows.length} 位學生
        </span>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setTab('pending')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'pending'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          💰 未銷帳
          {unpaidCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
              {unpaidCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('generate')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'generate'
              ? 'border-blue-500 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          🔄 未生成
          {readyCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
              {readyCount}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════
          Tab 1: 未銷帳（Draft invoices）
         ══════════════════════════════════════════════════ */}
      {tab === 'pending' && (
        <>
          {/* Batch action bar */}
          {unpaidCount > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
              <span className="text-sm text-gray-600">
                共 <strong className="text-amber-700">{unpaidCount}</strong> 筆待銷帳，
                金額合計 <strong className="text-amber-700">
                  ${draftInvoices.filter(d => !paidSet.has(d.id)).reduce((s, d) => s + d.amount, 0).toLocaleString()}
                </strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBatchDownloadPdf}
                  className="text-sm px-4 py-2 rounded-lg bg-amber-50 text-amber-700 font-medium hover:bg-amber-100"
                >
                  🖨️ 批次補印 ({unpaidCount})
                </button>
                <button
                  onClick={handleBatchPay}
                  disabled={batchPayRunning}
                  className="text-sm px-4 py-2 rounded-lg bg-green-500 text-white font-medium hover:bg-green-600 disabled:opacity-50"
                >
                  💰 批次銷帳 ({unpaidCount})
                </button>
              </div>
            </div>
          )}

          {pendingSummary && (
            <div className={`rounded-lg p-3 mb-4 text-sm font-medium ${pendingSummary.includes('失敗') ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
              {pendingSummary}
            </div>
          )}

          {unpaidCount === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              目前沒有待銷帳的收費單
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">姓名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">班級</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">收費單編號</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">收費日期</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">金額</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">建立日期</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {draftInvoices.map(inv => {
                      if (paidSet.has(inv.id)) {
                        return (
                          <tr key={inv.id} className="bg-green-50/30">
                            <td className="px-4 py-3 font-mono text-gray-400">{inv.sheetsId}</td>
                            <td className="px-4 py-3 text-gray-400">{inv.name}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{inv.className}</td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-400">{inv.serialNumber}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{inv.dates.join(', ') || '—'}</td>
                            <td className="px-4 py-3 text-right font-mono text-sm text-gray-400">${inv.amount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-xs text-gray-400">{inv.createdAt}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-medium">已銷帳 ✓</span>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={inv.id} className="hover:bg-amber-50/30">
                          <td className="px-4 py-3 font-mono text-gray-500">{inv.sheetsId}</td>
                          <td className="px-4 py-3">
                            <Link href={`/students/${inv.sheetsId}`} className="font-medium text-gray-900 hover:text-blue-600">
                              {inv.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{inv.className}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.serialNumber}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {inv.dates.length > 0 ? inv.dates.join(', ') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-bold text-amber-700">
                            ${inv.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{inv.createdAt}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center gap-1.5 justify-center">
                              <button
                                onClick={() => handleDownloadPdf(inv.id, inv.serialNumber)}
                                disabled={downloading.has(inv.id)}
                                className="text-xs px-2.5 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap font-medium"
                              >
                                {downloading.has(inv.id) ? 'PDF中...' : '🖨️ 補印'}
                              </button>
                              <button
                                onClick={() => handlePay(inv.id, inv.serialNumber, inv.amount)}
                                disabled={paying.has(inv.id) || batchPayRunning}
                                className="text-xs px-2.5 py-1 rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 whitespace-nowrap font-medium"
                              >
                                {paying.has(inv.id) ? '處理中...' : '💰 銷帳'}
                              </button>
                              <button
                                onClick={() => handleRevert(inv.id, inv.serialNumber)}
                                className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 whitespace-nowrap"
                              >
                                復原
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════
          Tab 2: 未生成（Generate invoices）
         ══════════════════════════════════════════════════ */}
      {tab === 'generate' && (
        <>
          {/* Batch action bar */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {readyCount > 0 && (
                <>
                  <span className="text-sm text-gray-600">
                    已選 <strong className="text-blue-600">{selectedCount}</strong> / {readyCount} 待開單
                  </span>
                  <button
                    onClick={toggleAll}
                    className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    {allReadySelected ? '取消全選' : '全選待開單'}
                  </button>
                </>
              )}
              {readyCount === 0 && (
                <span className="text-sm text-gray-400">目前沒有可開單的學生</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedCount > 0 && (
                <button
                  onClick={handleBatchGenerate}
                  disabled={isBatchRunning}
                  className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSyncing ? '同步中...' : isBatchRunning ? '生成中...' : `🔄 批次生成 (${selectedCount})`}
                </button>
              )}
            </div>
          </div>

          {batchSummary && (
            <div className={`rounded-lg p-3 mb-4 text-sm font-medium ${batchSummary.includes('失敗') ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
              {batchSummary}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="w-8 px-3 py-3">
                      {readyCount > 0 && (
                        <input type="checkbox" checked={allReadySelected} onChange={toggleAll} className="rounded border-gray-300" />
                      )}
                    </th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">ID</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">姓名</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">班級</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">方案</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Y 進度</th>
                    <th className="text-left px-3 py-3 font-medium text-gray-500">預計收費日期</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500">預估金額</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">狀態</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => {
                    const pct = Math.min(100, Math.round((r.currentY / r.targetY) * 100));
                    const job = jobs.get(r.sheetsId);
                    const isJobRunning = job && (job.status === 'generating' || job.status === 'pdf');

                    // 只顯示可開單或有進度的學生（排除已有 draft / paid 的）
                    if (!r.canGenerate && r.currentY === 0) return null;

                    return (
                      <tr
                        key={r.id}
                        className={
                          isJobRunning ? 'bg-yellow-50/50' :
                          job?.status === 'done' ? 'bg-green-50/50' :
                          job?.status === 'error' ? 'bg-red-50/50' :
                          r.canGenerate ? 'bg-blue-50/50 hover:bg-blue-50' :
                          'hover:bg-gray-50'
                        }
                      >
                        <td className="w-8 px-3 py-3">
                          {r.canGenerate && (
                            <input
                              type="checkbox"
                              checked={selected.has(r.sheetsId)}
                              onChange={() => toggleOne(r.sheetsId)}
                              disabled={isBatchRunning}
                              className="rounded border-gray-300"
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-gray-500">{r.sheetsId}</td>
                        <td className="px-3 py-3">
                          <Link href={`/students/${r.sheetsId}`} className="font-medium text-gray-900 hover:text-blue-600">
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-gray-600 text-xs">{r.className}</td>
                        <td className="px-3 py-3 text-gray-500 text-xs">{r.plan}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-[60px]">
                              <div
                                className={`h-2 rounded-full transition-all ${r.canGenerate ? 'bg-blue-500' : pct >= 80 ? 'bg-yellow-400' : 'bg-gray-400'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className={`text-xs font-mono whitespace-nowrap ${r.canGenerate ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>
                              {r.currentY}/{r.targetY}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">
                          {r.billingDates.length > 0 ? (
                            <span className={r.canGenerate ? 'text-blue-700 font-medium' : 'text-gray-500'}>
                              {r.billingDates.join(', ')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs">
                          {r.estimatedFee ? (
                            <span className={r.canGenerate ? 'text-blue-700 font-bold' : 'text-gray-500'}>
                              ${r.estimatedFee.toLocaleString()}
                            </span>
                          ) : '—'}
                        </td>
                        {/* Status */}
                        <td className="px-3 py-3 text-center">
                          {job?.status === 'generating' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 animate-pulse">生成中...</span>
                          ) : job?.status === 'pdf' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 animate-pulse">PDF中...</span>
                          ) : job?.status === 'done' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">✓ ${job.amount?.toLocaleString()}</span>
                          ) : job?.status === 'error' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600" title={job.error}>✗ 失敗</span>
                          ) : r.canGenerate ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">可開單</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">累積中</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center gap-1 justify-center flex-wrap">
                            {r.canGenerate && !job && (
                              <button
                                onClick={() => handleSingleGenerate(r)}
                                disabled={isBatchRunning}
                                className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                🔄 生成
                              </button>
                            )}
                            {job?.status === 'done' && job.invoiceId && (
                              <button
                                onClick={() => handleDownloadPdf(job.invoiceId!, job.serial ?? '')}
                                disabled={downloading.has(job.invoiceId!)}
                                className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                {downloading.has(job.invoiceId!) ? 'PDF中...' : '📥 再下載'}
                              </button>
                            )}
                            {job?.status === 'error' && (
                              <span className="text-xs text-red-500 max-w-[100px] truncate" title={job.error}>{job.error}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
