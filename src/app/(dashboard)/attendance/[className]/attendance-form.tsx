'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar, Save, Check } from 'lucide-react';
import { saveAttendance } from './actions';

interface Student {
  enrollmentId: number;
  sheetsId: string;
  name: string;
  className: string;
  currentStatus: number;
}

interface Props {
  classCode: string;
  className: string;
  dateStr: string;
  year: number;
  month: number;
  day: number;
  students: Student[];
}

const STATUS_OPTIONS = [
  { value: 0, label: '缺席', short: '—', color: 'bg-gray-100 text-gray-400' },
  { value: 3, label: 'YY', short: 'YY', color: 'bg-green-100 text-green-700 ring-2 ring-green-400' },
  { value: 2, label: 'Y', short: 'Y', color: 'bg-blue-100 text-blue-700 ring-2 ring-blue-300' },
  { value: 1, label: 'V', short: 'V', color: 'bg-amber-100 text-amber-700 ring-2 ring-amber-400' },
];

export default function AttendanceForm({ classCode, className, dateStr, year, month, day, students }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statuses, setStatuses] = useState<Record<number, number>>(
    Object.fromEntries(students.map(s => [s.enrollmentId, s.currentStatus]))
  );
  const [saved, setSaved] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateInput, setDateInput] = useState(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

  function cycleStatus(enrollmentId: number) {
    setStatuses(prev => {
      const current = prev[enrollmentId] || 0;
      // 循環: 0 (缺席) → 3 (YY) → 2 (Y) → 1 (V) → 0
      const next = current === 0 ? 3 : current === 3 ? 2 : current === 2 ? 1 : 0;
      return { ...prev, [enrollmentId]: next };
    });
    setSaved(false);
  }

  function setAll(status: number) {
    const newStatuses: Record<number, number> = {};
    students.forEach(s => { newStatuses[s.enrollmentId] = status; });
    setStatuses(newStatuses);
    setSaved(false);
  }

  async function handleSave() {
    startTransition(async () => {
      const entries = Object.entries(statuses).map(([eid, status]) => ({
        enrollmentId: Number(eid),
        status,
      }));
      await saveAttendance(year, month, day, entries);
      setSaved(true);
    });
  }

  function navigateDate(delta: number) {
    const d = new Date(year, month - 1, day + delta);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    router.push(`/attendance/${encodeURIComponent(className)}?date=${ds}`);
  }

  function goToDate() {
    router.push(`/attendance/${encodeURIComponent(className)}?date=${dateInput}`);
    setShowDatePicker(false);
  }

  const yyCount = Object.values(statuses).filter(s => s === 3).length;
  const yCount = Object.values(statuses).filter(s => s === 2).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{className}</h1>
          <p className="text-sm text-gray-500">{students.length} 位學生</p>
        </div>
      </div>

      {/* Date navigation */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center justify-between">
        <button onClick={() => navigateDate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 rounded-lg font-semibold text-lg"
          >
            <Calendar className="w-5 h-5 text-gray-400" />
            {dateStr}
          </button>
        </div>

        <button onClick={() => navigateDate(1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Date picker popup */}
      {showDatePicker && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-3">
          <input
            type="date"
            value={dateInput}
            onChange={e => setDateInput(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={goToDate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            跳轉
          </button>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setAll(3)} className="px-3 py-1.5 text-sm rounded-lg bg-green-50 text-green-700 hover:bg-green-100 font-medium">
          全部 YY
        </button>
        <button onClick={() => setAll(2)} className="px-3 py-1.5 text-sm rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">
          全部 Y
        </button>
        <button onClick={() => setAll(1)} className="px-3 py-1.5 text-sm rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium">
          全部 V
        </button>
        <button onClick={() => setAll(0)} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium">
          全部缺席
        </button>
        <div className="flex-1" />
        <span className="text-sm text-gray-500 self-center">
          YY:{yyCount} Y:{yCount} V:{Object.values(statuses).filter(s => s === 1).length} 缺席:{students.length - yyCount - yCount - Object.values(statuses).filter(s => s === 1).length}
        </span>
      </div>

      {/* Student list */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {students.map(student => {
          const status = statuses[student.enrollmentId] || 0;
          const opt = STATUS_OPTIONS.find(o => o.value === status) || STATUS_OPTIONS[0];

          return (
            <div
              key={student.enrollmentId}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-8 font-mono">{student.sheetsId}</span>
                <span className="font-medium text-gray-900">{student.name}</span>
              </div>

              <button
                onClick={() => cycleStatus(student.enrollmentId)}
                className={cn(
                  'w-12 h-10 rounded-lg font-bold text-sm transition-all',
                  opt.color
                )}
              >
                {opt.short}
              </button>
            </div>
          );
        })}
      </div>

      {/* Save button — sticky at bottom */}
      <div className="sticky bottom-0 py-4 bg-gray-50">
        <button
          onClick={handleSave}
          disabled={isPending || saved}
          className={cn(
            'w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all',
            saved
              ? 'bg-green-500'
              : isPending
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          )}
        >
          {saved ? <><Check className="w-5 h-5" /> 已儲存</> :
           isPending ? '儲存中...' :
           <><Save className="w-5 h-5" /> 儲存點名</>}
        </button>
      </div>
    </div>
  );
}
