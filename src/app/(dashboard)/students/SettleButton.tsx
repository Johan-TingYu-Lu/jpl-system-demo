'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  enrollmentId: number;
  sheetsId: string;
  name: string;
  status: string;
}

export function SettleButton({ enrollmentId, sheetsId, name, status }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const isSettled = status === '結清';

  async function handleClick() {
    const action = isSettled ? '取消結清' : '結清';
    if (!confirm(`確認${action} ${sheetsId} ${name}？`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/enrollments/${enrollmentId}/settle`, {
        method: isSettled ? 'DELETE' : 'POST',
      });
      const data = await res.json();
      if (!data.success) {
        alert(`${action}失敗：${data.error}`);
      }
      router.refresh();
    } catch {
      alert('操作失敗：網路錯誤');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`text-xs px-2 py-1 rounded disabled:opacity-50 ${
        isSettled
          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {loading ? '處理中...' : isSettled ? '取消結清' : '結清'}
    </button>
  );
}
