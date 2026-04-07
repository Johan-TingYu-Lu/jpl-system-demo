import prisma from '@/lib/prisma';
import { BookOpen } from 'lucide-react';
import { calendarYearToAcademicYear } from '@/lib/year-config';
import { SemesterFeeTable } from './semester-fee-table';

export default async function SemesterFeesPage() {
  const now = new Date();
  const currentYear = calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);

  // 只取在學學生 + 雜費狀態（endYear 歷史資料可能為 NULL，不做過濾）
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'active' },
    include: {
      person: { select: { name: true } },
      semesterFees: {
        where: { academicYear: currentYear },
      },
    },
    orderBy: [{ classCode: 'asc' }, { sheetsId: 'asc' }],
  });

  const students = enrollments.map(e => {
    const upper = e.semesterFees.find(f => f.semester === 1);
    const lower = e.semesterFees.find(f => f.semester === 2);
    return {
      sheetsId: e.sheetsId,
      name: e.person.name,
      className: e.className,
      upper: upper ? { amount: upper.amount, date: upper.feeDate, status: upper.status } : null,
      lower: lower ? { amount: lower.amount, date: lower.feeDate, status: lower.status } : null,
    };
  });

  const upperPaid = students.filter(s => s.upper?.status === 'paid').length;
  const lowerPaid = students.filter(s => s.lower?.status === 'paid').length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BookOpen className="w-6 h-6 text-gray-400" />
        <h1 className="text-2xl font-bold text-gray-900">書籍雜費 — {currentYear} 學年</h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">上學期</p>
          <p className="text-2xl font-bold text-gray-900">{upperPaid} / {students.length}</p>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(upperPaid / students.length * 100) || 0}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">下學期</p>
          <p className="text-2xl font-bold text-gray-900">{lowerPaid} / {students.length}</p>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${(lowerPaid / students.length * 100) || 0}%` }} />
          </div>
        </div>
      </div>

      {/* Table */}
      <SemesterFeeTable academicYear={currentYear} students={students} />
    </div>
  );
}
