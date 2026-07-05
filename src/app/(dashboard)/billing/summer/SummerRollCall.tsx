'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export interface SummerStudent {
  sheetsId: string;
  name: string;
  grade: '高一' | '高二';
  carrierEnrollmentId: number;
  subjects: string[];
  /** 現有出勤 日期(YYYY/MM/DD)→代碼(2=Y,3=YY)，用於 grid 預填 */
  marks: Record<string, number>;
  /** 已有暑期結算單號（非 null = 已結算，灰底跳過） */
  settledSerial: string | null;
}

interface SettleLine {
  sheetsId: string; name: string; subjects: string[];
  records: { date: string }[]; totalY: number; totalFee: number;
  skip: string | null; serialNumber?: string;
}

// 點名格循環：0(空)→2(Y半堂)→3(YY全堂)→0
function nextCode(c: number): number { return c === 0 ? 2 : c === 2 ? 3 : 0; }
function codeLabel(c: number): string { return c === 2 ? 'Y' : c === 3 ? 'YY' : ''; }
function codeClass(c: number): string {
  if (c === 2) return 'bg-yellow-100 text-yellow-800';
  if (c === 3) return 'bg-green-100 text-green-800';
  return 'bg-white text-gray-300';
}
const toSlash = (d: string) => d.replaceAll('-', '/');
const shortDate = (d: string) => { const [, m, day] = d.split('/'); return `${m}/${day}`; };

export default function SummerRollCall({ students, initialDates }: { students: SummerStudent[]; initialDates?: string[] }) {
  const router = useRouter();
  // 初始欄位＝已存過點名的暑期日期（server 端還原），之後可再新增
  const [dates, setDates] = useState<string[]>(initialDates ?? []);
  const [marks, setMarks] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const s of students) init[s.sheetsId] = { ...s.marks };
    return init;
  });
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // 已結算（初始 + 本次操作）
  const [settled, setSettled] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of students) if (s.settledSerial) init[s.sheetsId] = s.settledSerial;
    return init;
  });
  // 結算確認 modal（dry-run 結果）
  const [confirm, setConfirm] = useState<SettleLine | null>(null);
  const [busy, setBusy] = useState(false);

  const addDate = useCallback(() => {
    if (!newDate) return;
    const slash = toSlash(newDate);
    setDates(prev => prev.includes(slash) ? prev : [...prev, slash].sort());
    setNewDate('');
  }, [newDate]);

  const removeDate = useCallback((d: string) => setDates(prev => prev.filter(x => x !== d)), []);

  const cycleCell = useCallback((sheetsId: string, d: string) => {
    setMarks(prev => {
      const cur = prev[sheetsId]?.[d] ?? 0;
      return { ...prev, [sheetsId]: { ...prev[sheetsId], [d]: nextCode(cur) } };
    });
    setSavedMsg(null);
  }, []);

  const handleSave = useCallback(async () => {
    const payload: { carrierEnrollmentId: number; dateStr: string; code: number }[] = [];
    for (const s of students) {
      if (settled[s.sheetsId]) continue;
      for (const d of dates) {
        payload.push({ carrierEnrollmentId: s.carrierEnrollmentId, dateStr: d, code: marks[s.sheetsId]?.[d] ?? 0 });
      }
    }
    if (payload.length === 0) { setSavedMsg('沒有上課日，先新增日期'); return; }
    setSaving(true); setSavedMsg(null);
    try {
      const res = await fetch('/api/billing/summer/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marks: payload }),
      });
      const data = await res.json();
      setSavedMsg(data.success ? `已儲存 ${data.updated} 筆點名` : `儲存失敗：${data.error ?? '未知錯誤'}`);
    } catch (e) {
      setSavedMsg(`網路錯誤：${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  }, [students, dates, marks, settled]);

  // 按結算 → 先 dry-run 顯示金額
  const handleSettleClick = useCallback(async (sheetsId: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/summer/settle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsId }),
      });
      const data = await res.json();
      if (data.success) setConfirm(data.line);
      else setSavedMsg(`結算預覽失敗：${data.error ?? '未知錯誤'}`);
    } catch (e) {
      setSavedMsg(`網路錯誤：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }, []);

  // 確認 → 真的開單
  const handleSettleConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch('/api/billing/summer/settle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetsId: confirm.sheetsId, confirm: true }),
      });
      const data = await res.json();
      if (data.success && data.line.serialNumber) {
        setSettled(prev => ({ ...prev, [confirm.sheetsId]: data.line.serialNumber }));
        setConfirm(null);
        router.refresh();
      } else {
        setSavedMsg(`開單失敗：${data.error ?? data.line?.skip ?? '未知錯誤'}`);
      }
    } catch (e) {
      setSavedMsg(`網路錯誤：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }, [confirm, router]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">📋 暑期合併點名（準備結算）</h1>
        <span className="text-sm text-gray-400">{students.length} 位學生 · 混高一高二、不分科</span>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
        新增上課日 → 點名 → <strong>先「儲存點名」</strong>，再按某人的「結算」。結算會顯示金額，確認才開單。已結算者自動跳過。
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm" />
        <button onClick={addDate} disabled={!newDate}
          className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
          ＋ 新增上課日
        </button>
        <span className="text-xs text-gray-400">點格子：空 → Y(半堂) → YY(全堂)</span>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving}
          className="text-sm px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">
          {saving ? '儲存中...' : '💾 儲存點名'}
        </button>
      </div>

      {savedMsg && (
        <div className={`rounded-lg p-2.5 mb-4 text-sm font-medium ${savedMsg.includes('失敗') || savedMsg.includes('錯誤') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
          {savedMsg}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-gray-50 z-10">ID</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-12 bg-gray-50 z-10 min-w-[7rem]">姓名</th>
                <th className="text-center px-2 py-2 font-medium text-gray-500">年級</th>
                {dates.map(d => (
                  <th key={d} className="px-2 py-2 font-medium text-gray-500 text-center whitespace-nowrap min-w-[60px]">
                    <div>{shortDate(d)}</div>
                    <button onClick={() => removeDate(d)} className="text-[10px] text-red-400 hover:text-red-600">移除</button>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-gray-500 text-center">總Y</th>
                <th className="px-3 py-2 font-medium text-gray-500 text-right min-w-[88px]">結算</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {students.map(s => {
                const isSettled = !!settled[s.sheetsId];
                const totalY = dates.reduce((sum, d) => {
                  const c = marks[s.sheetsId]?.[d] ?? 0;
                  return sum + (c === 3 ? 2 : c === 2 ? 1 : 0);
                }, 0);
                return (
                  <tr key={s.sheetsId} className={isSettled ? 'opacity-50' : 'hover:bg-gray-50/50'}>
                    <td className="px-3 py-1.5 font-mono text-gray-500 sticky left-0 bg-white z-10">{s.sheetsId}</td>
                    <td className="px-3 py-1.5 font-medium text-gray-900 sticky left-12 bg-white z-10 whitespace-nowrap">
                      {s.name}<span className="ml-1 text-[10px] text-gray-400">{s.subjects.join('·')}</span>
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs text-gray-500">{s.grade}</td>
                    {dates.map(d => {
                      const c = marks[s.sheetsId]?.[d] ?? 0;
                      return (
                        <td key={d} className="px-1 py-1 text-center">
                          <button onClick={() => cycleCell(s.sheetsId, d)} disabled={isSettled}
                            className={`w-11 h-7 rounded text-xs font-bold border border-gray-200 disabled:opacity-40 ${codeClass(c)}`}>
                            {codeLabel(c)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-center font-mono font-bold text-blue-700">{totalY}</td>
                    <td className="px-3 py-1.5 text-right">
                      {isSettled ? (
                        <span className="text-xs text-gray-400 whitespace-nowrap">✓ {settled[s.sheetsId]}</span>
                      ) : (
                        <button onClick={() => handleSettleClick(s.sheetsId)} disabled={busy}
                          className="text-xs px-3 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap font-medium">
                          結算
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {students.length === 0 && (
                <tr><td colSpan={dates.length + 5} className="px-4 py-12 text-center text-gray-400">沒有高一高二在學學生</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 結算確認 modal（dry-run） */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">結算確認 — {confirm.name}</h2>
            </div>
            <div className="p-5">
              {confirm.skip ? (
                <p className="text-amber-700">跳過：{confirm.skip}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="text-3xl font-bold text-emerald-700">${confirm.totalFee.toLocaleString()}</span>
                    <span className="text-sm text-gray-500">{confirm.records.length} 節 · 總 {confirm.totalY} Y · {confirm.subjects.join('+')}</span>
                  </div>
                  <div className="bg-gray-50 rounded p-2.5 text-xs text-gray-500 max-h-40 overflow-auto">
                    {confirm.records.map((r, i) => <span key={i} className="inline-block mr-2">{r.date.replace(/^\d{4}\//, '')}</span>)}
                  </div>
                  <p className="text-xs text-amber-700 mt-3">⚠️ 反映<strong>已儲存</strong>的點名。確認後開出一張合併 draft 單，掛載體 enrollment。</p>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} disabled={busy}
                className="text-sm px-4 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">取消</button>
              {!confirm.skip && (
                <button onClick={handleSettleConfirm} disabled={busy}
                  className="text-sm px-4 py-1.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? '開單中...' : '確認結算開單'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
