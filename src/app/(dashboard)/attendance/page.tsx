import prisma from '@/lib/prisma';
import Link from 'next/link';
import { ClipboardCheck, ChevronRight, CheckCircle2, Clock } from 'lucide-react';

// 取得今日各班出勤概況
async function getTodayAttendanceSummary(classNames: string[]) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const dayIndex = today.getDate() - 1; // 0-based

  const enrollments = await prisma.enrollment.findMany({
    where: { className: { in: classNames }, status: 'active' },
    select: {
      id: true,
      className: true,
      attendances: {
        where: { year, month },
        select: { days: true },
      },
    },
  });

  const summaryMap = new Map<string, { total: number; yy: number; y: number; v: number; absent: number; marked: boolean }>();

  for (const e of enrollments) {
    if (!summaryMap.has(e.className)) {
      summaryMap.set(e.className, { total: 0, yy: 0, y: 0, v: 0, absent: 0, marked: false });
    }
    const s = summaryMap.get(e.className)!;
    s.total++;

    const dayStatus = e.attendances[0]?.days[dayIndex] ?? 0;
    if (dayStatus === 3) { s.yy++; s.marked = true; }
    else if (dayStatus === 2) { s.y++; s.marked = true; }
    else if (dayStatus === 1) { s.v++; s.marked = true; }
    else { s.absent++; }
  }

  return summaryMap;
}

export default async function AttendancePage() {
  const classGroups = await prisma.enrollment.groupBy({
    by: ['className'],
    where: { status: 'active' },
    _count: true,
    orderBy: { className: 'asc' },
  });

  const currentClasses = classGroups
    .filter(cls => {
      const match = cls.className.match(/\((\d+)\)/);
      if (!match) return false;
      const cohort = parseInt(match[1]);
      return cohort >= 115;
    })
    .sort((a, b) => {
      const yearA = parseInt(a.className.match(/\((\d+)\)/)?.[1] || '0');
      const yearB = parseInt(b.className.match(/\((\d+)\)/)?.[1] || '0');
      if (yearB !== yearA) return yearB - yearA;
      return a.className.localeCompare(b.className);
    });

  const oldClasses = classGroups.filter(cls => !currentClasses.includes(cls));

  // 取得今日出席概況
  const todaySummary = await getTodayAttendanceSummary(currentClasses.map(c => c.className));

  const today = new Date();
  const todayStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <ClipboardCheck className="w-6 h-6 text-gray-400" />
        <h1 className="text-2xl font-bold text-gray-900">點名</h1>
      </div>
      <p className="text-gray-500 mb-4">今日 {todayStr}　—　點擊班級開始點名或修改</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {currentClasses.map(cls => {
          const summary = todaySummary.get(cls.className);
          const isMarked = summary?.marked || false;

          return (
            <Link
              key={cls.className}
              href={`/attendance/${encodeURIComponent(cls.className)}`}
              className={`bg-white rounded-xl border p-4 flex flex-col gap-2 hover:shadow-sm transition-all group ${
                isMarked ? 'border-green-200 hover:border-green-300' : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-700">
                    {cls.className}
                  </h3>
                  <p className="text-sm text-gray-500">{cls._count} 位學生</p>
                </div>
                <div className="flex items-center gap-2">
                  {isMarked ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-50 text-green-600 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      已點名
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500 font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      未點名
                    </span>
                  )}
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500" />
                </div>
              </div>

              {isMarked && summary && (
                <div className="flex gap-3 text-xs pt-1 border-t border-gray-50">
                  <span className="text-green-600 font-medium">YY: {summary.yy}</span>
                  <span className="text-blue-600 font-medium">Y: {summary.y}</span>
                  <span className="text-amber-600 font-medium">V: {summary.v}</span>
                  <span className="text-gray-400">缺席: {summary.absent}</span>
                  <span className="ml-auto text-gray-400 group-hover:text-blue-500">點擊修改 →</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {oldClasses.length > 0 && (
        <details className="mt-8">
          <summary className="text-gray-400 cursor-pointer hover:text-gray-600 text-sm">
            歷年班級（{oldClasses.length} 班）
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {oldClasses.map(cls => (
              <Link
                key={cls.className}
                href={`/attendance/${encodeURIComponent(cls.className)}`}
                className="bg-gray-50 rounded-xl border border-gray-100 p-4 flex items-center justify-between hover:border-gray-300 transition-all group"
              >
                <div>
                  <h3 className="font-medium text-gray-600 group-hover:text-gray-900">
                    {cls.className}
                  </h3>
                  <p className="text-sm text-gray-400">{cls._count} 位學生</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-200 group-hover:text-gray-400" />
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

