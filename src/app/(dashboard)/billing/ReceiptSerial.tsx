'use client';

import { useState, useCallback } from 'react';
import { X, Download, Copy, Check, Loader2 } from 'lucide-react';

/**
 * 可點擊的收費單編號。點擊 → 彈窗顯示收費單上半部圖片，方便截圖/複製/下載發家長。
 * 圖片來源：/api/invoices/[id]/receipt-image（裁切既有 PDF 上半部）。
 */
export function ReceiptSerial({
  invoiceId,
  serial,
  label,
  className,
}: {
  invoiceId: number;
  serial: string;
  /** 觸發按鈕顯示文字，預設為 serial。例如未生成分頁用「👁 預覽」 */
  label?: string;
  /** 覆寫觸發按鈕樣式 */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const src = `/api/invoices/${invoiceId}/receipt-image`;

  const handleCopy = useCallback(async () => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('複製失敗，請改用右鍵或下載');
    }
  }, [src]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className ?? 'font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer'}
        title="點擊預覽收費單（可截圖/複製發家長）"
      >
        {label ?? serial}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 標題列 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
              <span className="font-mono text-sm text-gray-700">{serial}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已複製' : '複製圖片'}
                </button>
                <a
                  href={src}
                  download={`${serial}.png`}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  下載
                </a>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 圖片 */}
            <div className="p-4 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`收費單 ${serial}`}
                className="w-full h-auto rounded border border-gray-200 bg-white"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement)?.style.removeProperty('display');
                }}
              />
              <div style={{ display: 'none' }} className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                無法載入圖片（可能是無 records 的歷史收費單）
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
