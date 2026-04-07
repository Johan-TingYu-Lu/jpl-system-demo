import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { comparePayments, type PaymentDiscrepancy, type DiscrepancyType } from '@/app/api/sync/compare-payment/route';
import { BatchPayButton } from './BatchPayButton';
import { BatchPushButton } from './BatchPushButton';
import { SyncDirectionToggle } from './SyncDirectionToggle';
import { SinglePayButton } from './SinglePayButton';

const DISCREPANCY_LABELS: Record<DiscrepancyType, string> = {
  SHOULD_MARK_PAID: 'Sheet 已繳 / DB 未銷帳',
  MISSING_IN_SHEET: 'DB 已銷帳 / Sheet 無紀錄',
  AMOUNT_MISMATCH: '金額不符',
};

const DISCREPANCY_COLORS: Record<DiscrepancyType, string> = {
  SHOULD_MARK_PAID: 'bg-amber-50',
  MISSING_IN_SHEET: 'bg-red-50',
  AMOUNT_MISMATCH: 'bg-orange-50',
};

const BADGE_COLORS: Record<DiscrepancyType, string> = {
  SHOULD_MARK_PAID: 'bg-amber-100 text-amber-800',
  MISSING_IN_SHEET: 'bg-red-100 text-red-800',
  AMOUNT_MISMATCH: 'bg-orange-100 text-orange-800',
};

interface PageProps {
  searchParams: Promise<{ dir?: string }>;
}

export default async function SyncPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const direction = params.dir === 'db-to-sheet' ? 'db-to-sheet' : 'sheet-to-db';

  let result: Awaited<ReturnType<typeof comparePayments>> | null = null;
  let error: string | null = null;

  try {
    result = await comparePayments();
  } catch (e) {
    error = String(e);
  }

  // Filter diffs based on direction
  const sheetToDbDiffs = result?.diffs.filter(
    (d: PaymentDiscrepancy) => d.discrepancyType === 'SHOULD_MARK_PAID'
  ) ?? [];

  const dbToSheetDiffs = result?.diffs.filter(
    (d: PaymentDiscrepancy) => d.discrepancyType === 'MISSING_IN_SHEET'
  ) ?? [];

  const amountMismatchDiffs = result?.diffs.filter(
    (d: PaymentDiscrepancy) => d.discrepancyType === 'AMOUNT_MISMATCH'
  ) ?? [];

  const shouldMarkPaidIds = sheetToDbDiffs.map((d: PaymentDiscrepancy) => d.dbInvoiceId);
  const missingInSheetIds = dbToSheetDiffs.map((d: PaymentDiscrepancy) => d.dbInvoiceId);

  // Which diffs to show based on direction
  const activeDiffs = direction === 'sheet-to-db'
    ? [...sheetToDbDiffs, ...amountMismatchDiffs]
    : [...dbToSheetDiffs, ...amountMismatchDiffs];

  // DB 全覽：應屆學生 + 所有 invoice 統計
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'active' },
    include: {
      person: { select: { name: true } },
      invoices: {
        orderBy: { endDate: 'desc' },
        select: { serialNumber: true, amount: true, status: true, startDate: true, endDate: true },
      },
    },
    orderBy: { sheetsId: 'asc' },
  });

  const allStudents = enrollments
    .map(e => {
      const paid = e.invoices.filter(i => i.status === 'paid');
      const unpaid = e.invoices.filter(i => i.status !== 'paid');
      const latest = e.invoices[0];
      const fmt = (d: Date | null) => d ? `${(d.getUTCMonth()+1).toString().padStart(2,'0')}/${d.getUTCDate().toString().padStart(2,'0')}` : '';
      return {
        sheetsId: e.sheetsId,
        name: e.person.name,
        className: e.className,
        totalInvoices: e.invoices.length,
        paidCount: paid.length,
        unpaidCount: unpaid.length,
        paidTotal: paid.reduce((s, i) => s + i.amount, 0),
        unpaidTotal: unpaid.reduce((s, i) => s + i.amount, 0),
        latestSerial: latest?.serialNumber ?? null,
        latestStatus: latest?.status ?? null,
        latestDateRange: latest ? `${fmt(latest.startDate)}~${fmt(latest.endDate)}` : null,
      };
    })
    .sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">同步確認</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/billing" className="text-sm text-blue-600 hover:underline">
            &larr; 返回收費管理
          </Link>
        </div>
      </div>

      {/* Direction toggle */}
      <div className="mb-6">
        <SyncDirectionToggle initialDirection={direction as 'sheet-to-db' | 'db-to-sheet'} />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-700 text-sm">
          讀取失敗：{error}
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">DB 收費單總數</p>
              <p className="text-2xl font-bold text-gray-900">{result.totalDbInvoices}</p>
            </div>

            {direction === 'sheet-to-db' ? (
              <>
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                  <p className="text-xs text-amber-700">Sheet 已繳 → DB 需銷帳</p>
                  <p className="text-2xl font-bold text-amber-700">{sheetToDbDiffs.length}</p>
                </div>
                <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                  <p className="text-xs text-orange-700">金額不符</p>
                  <p className="text-2xl font-bold text-orange-700">{amountMismatchDiffs.length}</p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-red-50 rounded-xl border border-red-200 p-4">
                  <p className="text-xs text-red-700">DB 已銷帳 → Sheet 需更新</p>
                  <p className="text-2xl font-bold text-red-700">{dbToSheetDiffs.length}</p>
                </div>
                <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                  <p className="text-xs text-orange-700">金額不符</p>
                  <p className="text-2xl font-bold text-orange-700">{amountMismatchDiffs.length}</p>
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="mb-4 flex gap-3">
            {direction === 'sheet-to-db' && shouldMarkPaidIds.length > 0 && (
              <BatchPayButton invoiceIds={shouldMarkPaidIds} />
            )}
            {direction === 'db-to-sheet' && missingInSheetIds.length > 0 && (
              <BatchPushButton invoiceIds={missingInSheetIds} />
            )}
          </div>

          {/* Description */}
          <div className="mb-4 text-sm text-gray-500">
            {direction === 'sheet-to-db' ? (
              <p>以下收費單在 Sheet 已標記繳費，但 DB 還未銷帳。按「批次銷帳」將 DB 更新為已繳。</p>
            ) : (
              <p>以下收費單在 DB 已銷帳，但 Sheet 缺少紀錄。按「批次推送 Sheet」將繳費資訊寫回 Sheet。</p>
            )}
          </div>

          {/* Table */}
          {activeDiffs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
              {direction === 'sheet-to-db'
                ? '無需從 Sheet 同步到 DB，已完全一致'
                : '無需從 DB 推送到 Sheet，已完全一致'}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">姓名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">DB序號</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">DB狀態</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">DB金額</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500">Sheet金額</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Sheet繳費日</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">差異</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeDiffs.map((d: PaymentDiscrepancy) => (
                      <tr key={`${d.dbInvoiceId}`} className={DISCREPANCY_COLORS[d.discrepancyType]}>
                        <td className="px-4 py-3 font-mono text-gray-500">{d.sheetsId}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{d.dbSerial}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            d.dbStatus === 'paid' ? 'bg-green-100 text-green-700' :
                            d.dbStatus === 'draft' ? 'bg-gray-100 text-gray-600' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {d.dbStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          ${d.dbAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {d.sheetAmount !== null ? `$${d.sheetAmount.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {d.sheetPaymentDate ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${BADGE_COLORS[d.discrepancyType]}`}>
                            {DISCREPANCY_LABELS[d.discrepancyType]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {d.discrepancyType === 'SHOULD_MARK_PAID' && (
                            <SinglePayButton invoiceId={d.dbInvoiceId} serial={d.dbSerial} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* DB 全覽表 */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🗄️</span>
          <h2 className="text-lg font-bold text-gray-900">DB 收費全覽（應屆學生）</h2>
          <span className="text-xs text-gray-400 ml-2">{allStudents.length} 位學生</span>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-gray-50">ID</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">姓名</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">班級</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">總單</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">已繳</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">未繳</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">已繳總額</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">未繳總額</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">最新序號</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">最新狀態</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">最新日期區間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allStudents.map(s => {
                  const hasUnpaid = s.unpaidCount > 0;
                  return (
                    <tr key={s.sheetsId} className={hasUnpaid ? 'bg-amber-50/50' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2 font-mono text-gray-500 sticky left-0 bg-inherit">{s.sheetsId}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                      <td className="px-3 py-2 text-gray-600">{s.className}</td>
                      <td className="px-3 py-2 text-center text-gray-700">{s.totalInvoices}</td>
                      <td className="px-3 py-2 text-center text-green-700">{s.paidCount}</td>
                      <td className="px-3 py-2 text-center font-medium">{s.unpaidCount > 0 ? <span className="text-amber-700">{s.unpaidCount}</span> : '0'}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">${s.paidTotal.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.unpaidTotal > 0 ? <span className="text-amber-700">${s.unpaidTotal.toLocaleString()}</span> : '$0'}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{s.latestSerial ?? '—'}</td>
                      <td className="px-3 py-2">
                        {s.latestStatus ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            s.latestStatus === 'paid' ? 'bg-green-100 text-green-700' :
                            s.latestStatus === 'draft' ? 'bg-gray-100 text-gray-600' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{s.latestStatus}</span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.latestDateRange ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
