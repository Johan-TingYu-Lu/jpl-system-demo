import prisma from '@/lib/prisma';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import { EXCLUDED_STATUSES } from '@/lib/enrollment-status';
import { SettleButton } from './SettleButton';
import { AddStudentModal } from './AddStudentModal';

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  active: { label: '在學', color: 'bg-green-50 text-green-700' },
  dropped: { label: '停課', color: 'bg-yellow-50 text-yellow-700' },
  graduated: { label: '畢業', color: 'bg-blue-50 text-blue-700' },
  '永久停止': { label: '永久停止', color: 'bg-red-50 text-red-700' },
  '結清': { label: '結清', color: 'bg-gray-100 text-gray-500' },
};

interface PageProps {
  searchParams: Promise<{ show?: string }>;
}

export default async function StudentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const showAll = params.show === 'all';
  const showSettled = params.show === 'settled';

  const now = new Date();
  const currentYear = calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);

  const whereClause = showAll
    ? {}
    : showSettled
      ? { status: { in: [...EXCLUDED_STATUSES] } }
      : { status: 'active' as const };

  const enrollments = await prisma.enrollment.findMany({
    where: whereClause,
    include: {
      person: { select: { name: true } },
      _count: { select: { invoices: true, semesterFees: true } },
    },
    orderBy: [{ classCode: 'asc' }, { sheetsId: 'asc' }],
  });

  const settledCount = await prisma.enrollment.count({
    where: { status: { in: [...EXCLUDED_STATUSES] } },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900">學生管理</h1>
          <span className="text-sm text-gray-400">{currentYear} 學年</span>
        </div>
        <AddStudentModal />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        <Link
          href="/students"
          className={`text-sm px-3 py-1.5 rounded-lg ${!showAll && !showSettled ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          在學 ({enrollments.length}{!showAll && !showSettled ? '' : ''})
        </Link>
        <Link
          href="/students?show=settled"
          className={`text-sm px-3 py-1.5 rounded-lg ${showSettled ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          已封存 ({settledCount})
        </Link>
        <Link
          href="/students?show=all"
          className={`text-sm px-3 py-1.5 rounded-lg ${showAll ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          全部
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">班級</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">年次</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">收費單</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">狀態</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {enrollments.map(e => {
                const badge = STATUS_BADGE[e.status] || { label: e.status, color: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={e.id} className={e.status === '結清' ? 'bg-gray-50/50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 font-mono text-gray-500">{e.sheetsId}</td>
                    <td className="px-4 py-3">
                      <Link href={`/students/${e.sheetsId}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {e.person.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{e.className}</td>
                    <td className="px-4 py-3 text-center font-mono text-gray-500">
                      {e.cohort || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{e._count.invoices}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(e.status === 'active' || e.status === '結清') && (
                        <SettleButton
                          enrollmentId={e.id}
                          sheetsId={e.sheetsId}
                          name={e.person.name}
                          status={e.status}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
