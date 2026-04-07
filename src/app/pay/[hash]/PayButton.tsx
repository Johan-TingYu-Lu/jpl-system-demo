'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  invoiceId: number;
  serial: string;
}

export function PayButton({ invoiceId, serial }: Props) {
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handlePay = async () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'cash' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '銷帳失敗');
      setSuccess(true);
      setTimeout(() => router.refresh(), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '銷帳失敗');
      setConfirmed(false);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-green-600 font-bold">銷帳成功！</p>
        <p className="text-sm text-gray-500 mt-1">{serial}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm text-center">
          {error}
        </div>
      )}
      {confirmed ? (
        <div className="space-y-2">
          <p className="text-center text-amber-700 font-medium text-sm">
            確認要銷帳 {serial}？
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmed(false)}
              className="flex-1 py-3 px-4 rounded-lg border border-gray-300 text-gray-700 font-medium"
              disabled={loading}
            >
              取消
            </button>
            <button
              onClick={handlePay}
              className="flex-1 py-3 px-4 rounded-lg bg-green-600 text-white font-bold disabled:opacity-50"
              disabled={loading}
            >
              {loading ? '處理中...' : '確認銷帳'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handlePay}
          className="w-full py-4 px-4 rounded-lg bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          💰 銷帳
        </button>
      )}
    </div>
  );
}
