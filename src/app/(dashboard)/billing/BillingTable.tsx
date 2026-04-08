'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Archive } from 'lucide-react';

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

export interface InvoiceItem {
  id: number;
  serialNumber: string;
  amount: number;
  startDate: string;
  endDate: string;
  dates: string[];
  createdAt: string;
}

export interface StudentGroup {
  sheetsId: string;
  name: string;
  className: string;
  invoices: InvoiceItem[];
}

type Tab = 'pending' | 'generate' | 'archived';
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
  pendingGroups,
  archivedGroups,
  pendingCount,
  archivedCount,
  currentYear,
}: {
  rows: StudentRow[];
  readyCount: number;
  pendingGroups: StudentGroup[];
  archivedGroups: StudentGroup[];
  pendingCount: number;
  archivedCount: number;
  currentYear: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(pendingCount > 0 ? 'pending' : 'generate');

  // ── Generate tab state ──
  const readyRows = rows.filter(r => r.canGenerate);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allReadySelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.sheetsId));
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [jobs, setJobs] = useState<Map<string, JobResult>>(new Map());
  const [batchSummary, setBatchSummary] = useState<string | null>(null);

  // ── Accordion state ──
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState<Set<string>>(new Set());

  function toggleAccordion(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Shared helpers ──

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  async function handleDownloadPdf(invoiceId: number, serial: string) {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { method: 'POST' });
      if (res.ok && res.headers.get('Content-Type')?.includes('application/pdf')) {
        triggerDownload(await res.blob(), `${serial}.pdf`);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`PDF 生成失敗: ${err.error || res.statusText}`);
      }
    } catch { alert('網路錯誤'); }
  }

  // ── Pending tab: pay ──
  async function handlePay(invoiceId: number, serial: string, amount: number) {
    if (!confirm(`確認銷帳 ${serial}，金額 $${amount.toLocaleString()}？`)) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'cash' }),
      });
      const data = await res.json();
      if (data.success) router.refresh();
      else alert(`銷帳失敗: ${data.error}`);
    } catch { alert('網路錯誤'); }
  }

  // ── Pending tab: archive whole student ──
  async function handleArchive(student: StudentGroup) {
    const total = student.invoices.reduce((s, i) => s + i.amount, 0);
    if (!confirm(`封存 ${student.name}（${student.sheetsId}）的 ${student.invoices.length} 張待收費單，共 $${total.toLocaleString()}？\n\n封存後移至「已封存」分頁。`)) return;

    setArchiving(prev => new Set(prev).add(student.sheetsId));
    for (const inv of student.invoices) {
      try {
        const res = await fetch(`/api/invoices/${inv.id}/archive`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) { alert(`封存 ${inv.serialNumber} 失敗: ${data.error}`); break; }
      } catch { alert('網路錯誤'); break; }
    }
    setArchiving(prev => { const n = new Set(prev); n.delete(student.sheetsId); return n; });
    router.refresh();
  }

  // ── Generate tab handlers ──

  const toggleOne = useCallback((sheetsId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sheetsId)) next.delete(sheetsId); else next.add(sheetsId);
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsId: row.sheetsId }),
      });
      const data = await genRes.json();
      if (data.success) {
        newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'pdf', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
        setJobs(new Map(newJobs));
        const pdfRes = await fetch(`/api/invoices/${data.invoiceId}/pdf`, { method: 'POST' });
        if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
          triggerDownload(await pdfRes.blob(), `${data.serialNumber}.pdf`);
          newJobs.set(row.sheetsId, { ...newJobs.get(row.sheetsId)!, status: 'done' });
        } else {
          newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: 'PDF失敗' });
        }
      } else {
        newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: data.error || '生成失敗' });
      }
    } catch {
      newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: '網路錯誤' });
    }
    setJobs(new Map(newJobs));
    router.refresh();
  }

  async function handleBatchGenerate() {
    const toGenerate = readyRows.filter(r => selected.has(r.sheetsId));
    if (toGenerate.length === 0) return;
    if (!confirm(`將為 ${toGenerate.length} 位學生生成收費單。確定？`)) return;
    setIsBatchRunning(true); setBatchSummary(null);
    setIsSyncing(true);
    try {
      const syncRes = await fetch('/api/sync/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'attendance' }),
      });
      if (!syncRes.ok) { setBatchSummary('同步失敗'); setIsBatchRunning(false); setIsSyncing(false); return; }
    } catch { setBatchSummary('同步失敗'); setIsBatchRunning(false); setIsSyncing(false); return; }
    setIsSyncing(false);
    let ok = 0, fail = 0;
    const newJobs = new Map<string, JobResult>();
    for (const row of toGenerate) {
      newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'generating' });
      setJobs(new Map(newJobs));
      try {
        const genRes = await fetch('/api/invoices/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetsId: row.sheetsId }),
        });
        const data = await genRes.json();
        if (data.success) {
          newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'pdf', invoiceId: data.invoiceId, serial: data.serialNumber, amount: data.billing?.totalFee });
          setJobs(new Map(newJobs));
          const pdfRes = await fetch(`/api/invoices/${data.invoiceId}/pdf`, { method: 'POST' });
          if (pdfRes.ok && pdfRes.headers.get('Content-Type')?.includes('application/pdf')) {
            triggerDownload(await pdfRes.blob(), `${data.serialNumber}.pdf`);
            newJobs.set(row.sheetsId, { ...newJobs.get(row.sheetsId)!, status: 'done' }); ok++;
          } else { newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: 'PDF失敗' }); fail++; }
        } else { newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: data.error || '失敗' }); fail++; }
      } catch { newJobs.set(row.sheetsId, { sheetsId: row.sheetsId, status: 'error', error: '網路錯誤' }); fail++; }
      setJobs(new Map(newJobs));
    }
    setBatchSummary(`完成！成功 ${ok} 張${fail > 0 ? `，失敗 ${fail} 張` : ''}`);
    setIsBatchRunning(false); setSelected(new Set()); router.refresh();
  }

  const selectedCount = readyRows.filter(r => selected.has(r.sheetsId)).length;

  // ── Accordion renderer (shared for pending & archived) ──
  function renderAccordion(groups: StudentGroup[], mode: 'pending' | 'archived') {
    if (groups.length === 0) {
      return (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          {mode === 'pending' ? '目前沒有待收費的收費單' : '沒有已封存的收費單'}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {groups.map(student => {
          const isOpen = openIds.has(`${mode}-${student.sheetsId}`);
          const isArchivingThis = archiving.has(student.sheetsId);
          const total = student.invoices.reduce((s, i) => s + i.amount, 0);

          return (
            <div key={student.sheetsId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer select-none"
                onClick={() => toggleAccordion(`${mode}-${student.sheetsId}`)}>
                <div className="mr-3 text-gray-400">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>
                <span className="font-mono text-sm text-gray-500 w-12">{student.sheetsId}</span>
                <span className="font-medium text-gray-900 w-24">{student.name}</span>
                <span className="text-xs text-gray-500 w-32">{student.className}</span>
                <span className="text-xs text-amber-600 font-medium w-16">{student.invoices.length} 張</span>
                <span className="font-mono text-sm font-bold text-amber-700 flex-1">${total.toLocaleString()}</span>

                {mode === 'pending' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleArchive(student); }}
                    disabled={isArchivingThis}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-500 hover:bg-red-50 hover:border-red-300 hover:text-red-500 disabled:opacity-50 transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    {isArchivingThis ? '封存中...' : '封存'}
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/50">
                        <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">編號</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">計費區間</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-400 text-xs">收費日期</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-400 text-xs">金額</th>
                        {mode === 'pending' && (
                          <th className="text-center px-4 py-2 font-medium text-gray-400 text-xs">操作</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {student.invoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-amber-50/20">
                          <td className="px-4 py-2 font-mono text-xs text-gray-600">{inv.serialNumber}</td>
                          <td className="px-4 py-2 text-xs text-gray-500">{inv.startDate} ~ {inv.endDate}</td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {inv.dates.length > 0 ? inv.dates.join(', ') : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-sm font-bold text-amber-700">
                            ${inv.amount.toLocaleString()}
                          </td>
                          {mode === 'pending' && (
                            <td className="px-4 py-2 text-center">
                              <div className="flex items-center gap-1.5 justify-center">
                                <button onClick={() => handleDownloadPdf(inv.id, inv.serialNumber)}
                                  className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 whitespace-nowrap">
                                  🖨️
                                </button>
                                <button onClick={() => handlePay(inv.id, inv.serialNumber, inv.amount)}
                                  className="text-xs px-2.5 py-1 rounded bg-green-500 text-white hover:bg-green-600 whitespace-nowrap font-medium">
                                  銷帳
                                </button>
                              </div>
                            </td>
                          )}
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

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">📋 收費管理</h1>
        <span className="text-sm text-gray-400">{currentYear} 學年 · {rows.length} 位學生</span>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-gray-200 mb-4">
        <button onClick={() => setTab('pending')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'pending' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          💰 未銷帳
          {pendingCount > 0 && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">{pendingCount}</span>}
        </button>
        <button onClick={() => setTab('generate')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'generate' ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          🔄 未生成
          {readyCount > 0 && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{readyCount}</span>}
        </button>
        <button onClick={() => setTab('archived')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'archived' ? 'border-gray-500 text-gray-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
          📦 已封存
          {archivedCount > 0 && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600">{archivedCount}</span>}
        </button>
      </div>

      {/* ══ Tab 1: 未銷帳（手風琴）══ */}
      {tab === 'pending' && renderAccordion(pendingGroups, 'pending')}

      {/* ══ Tab 2: 未生成 ══ */}
      {tab === 'generate' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {readyCount > 0 ? (
                <>
                  <span className="text-sm text-gray-600">
                    已選 <strong className="text-blue-600">{selectedCount}</strong> / {readyCount} 待開單
                  </span>
                  <button onClick={toggleAll} className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
                    {allReadySelected ? '取消全選' : '全選待開單'}
                  </button>
                </>
              ) : (
                <span className="text-sm text-gray-400">目前沒有可開單的學生</span>
              )}
            </div>
            {selectedCount > 0 && (
              <button onClick={handleBatchGenerate} disabled={isBatchRunning}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
                {isSyncing ? '同步中...' : isBatchRunning ? '生成中...' : `🔄 批次生成 (${selectedCount})`}
              </button>
            )}
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
                      {readyCount > 0 && <input type="checkbox" checked={allReadySelected} onChange={toggleAll} className="rounded border-gray-300" />}
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
                    if (!r.canGenerate && r.currentY === 0) return null;

                    return (
                      <tr key={r.id} className={
                        isJobRunning ? 'bg-yellow-50/50' :
                        job?.status === 'done' ? 'bg-green-50/50' :
                        job?.status === 'error' ? 'bg-red-50/50' :
                        r.canGenerate ? 'bg-blue-50/50 hover:bg-blue-50' :
                        'hover:bg-gray-50'
                      }>
                        <td className="w-8 px-3 py-3">
                          {r.canGenerate && <input type="checkbox" checked={selected.has(r.sheetsId)} onChange={() => toggleOne(r.sheetsId)} disabled={isBatchRunning} className="rounded border-gray-300" />}
                        </td>
                        <td className="px-3 py-3 font-mono text-gray-500">{r.sheetsId}</td>
                        <td className="px-3 py-3">
                          <Link href={`/students/${r.sheetsId}`} className="font-medium text-gray-900 hover:text-blue-600">{r.name}</Link>
                        </td>
                        <td className="px-3 py-3 text-gray-600 text-xs">{r.className}</td>
                        <td className="px-3 py-3 text-gray-500 text-xs">{r.plan}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-[60px]">
                              <div className={`h-2 rounded-full transition-all ${r.canGenerate ? 'bg-blue-500' : pct >= 80 ? 'bg-yellow-400' : 'bg-gray-400'}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-xs font-mono whitespace-nowrap ${r.canGenerate ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>
                              {r.currentY}/{r.targetY}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">
                          {r.billingDates.length > 0 ? (
                            <span className={r.canGenerate ? 'text-blue-700 font-medium' : 'text-gray-500'}>{r.billingDates.join(', ')}</span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs">
                          {r.estimatedFee ? (
                            <span className={r.canGenerate ? 'text-blue-700 font-bold' : 'text-gray-500'}>${r.estimatedFee.toLocaleString()}</span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {job?.status === 'generating' ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 animate-pulse">生成中...</span>
                          : job?.status === 'pdf' ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700 animate-pulse">PDF中...</span>
                          : job?.status === 'done' ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">✓ ${job.amount?.toLocaleString()}</span>
                          : job?.status === 'error' ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600" title={job.error}>✗ 失敗</span>
                          : r.canGenerate ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">可開單</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">累積中</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {r.canGenerate && !job && (
                            <button onClick={() => handleSingleGenerate(r)} disabled={isBatchRunning}
                              className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap">
                              🔄 生成
                            </button>
                          )}
                          {job?.status === 'done' && job.invoiceId && (
                            <button onClick={() => handleDownloadPdf(job.invoiceId!, job.serial ?? '')}
                              className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">
                              📥 再下載
                            </button>
                          )}
                          {job?.status === 'error' && <span className="text-xs text-red-500 max-w-[100px] truncate" title={job.error}>{job.error}</span>}
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

      {/* ══ Tab 3: 已封存 ══ */}
      {tab === 'archived' && renderAccordion(archivedGroups, 'archived')}
    </div>
  );
}
