'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  initialDirection: 'sheet-to-db' | 'db-to-sheet';
}

export function SyncDirectionToggle({ initialDirection }: Props) {
  const [direction, setDirection] = useState(initialDirection);
  const router = useRouter();

  function handleChange(dir: 'sheet-to-db' | 'db-to-sheet') {
    setDirection(dir);
    // Update URL query param
    const url = new URL(window.location.href);
    url.searchParams.set('dir', dir);
    router.push(url.pathname + url.search);
  }

  return (
    <div className="flex items-center bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => handleChange('sheet-to-db')}
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
          direction === 'sheet-to-db'
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <span className="text-lg">📊</span>
        Sheet
        <span className="text-blue-500">→</span>
        <span className="text-lg">🗄️</span>
        DB
      </button>
      <button
        onClick={() => handleChange('db-to-sheet')}
        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
          direction === 'db-to-sheet'
            ? 'bg-white text-green-700 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        <span className="text-lg">🗄️</span>
        DB
        <span className="text-green-500">→</span>
        <span className="text-lg">📊</span>
        Sheet
      </button>
    </div>
  );
}
