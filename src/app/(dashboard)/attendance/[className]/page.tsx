import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import AttendanceForm from './attendance-form';

interface Props {
  params: Promise<{ className: string }>;
  searchParams: Promise<{ date?: string }>;
}

export default async function ClassAttendancePage({ params, searchParams }: Props) {
  const { className: encodedClassName } = await params;
  const className = decodeURIComponent(encodedClassName);
  const { date: dateParam } = await searchParams;

  // 目標日期（預設今天）
  const today = new Date();
  const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : today;
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const day = targetDate.getDate();

  // 取得該班在學學生（以 className 精確匹配）
  const enrollments = await prisma.enrollment.findMany({
    where: { className, status: 'active' },
    include: { person: { select: { name: true } } },
    orderBy: { sheetsId: 'asc' },
  });

  if (enrollments.length === 0) notFound();

  // 取得該月出勤資料
  const attendanceRecords = await prisma.monthlyAttendance.findMany({
    where: {
      enrollmentId: { in: enrollments.map(e => e.id) },
      year,
      month,
    },
  });

  const attendanceMap = new Map(
    attendanceRecords.map(a => [a.enrollmentId, a])
  );

  // 組裝每位學生的當日狀態
  const students = enrollments.map(e => {
    const ma = attendanceMap.get(e.id);
    const dayIndex = day - 1; // 0-based
    const currentStatus = ma ? ma.days[dayIndex] : 0;

    return {
      enrollmentId: e.id,
      sheetsId: e.sheetsId,
      name: e.person.name,
      className: e.className,
      currentStatus,
    };
  });

  const dateStr = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

  return (
    <AttendanceForm
      classCode={enrollments[0].classCode}
      className={className}
      dateStr={dateStr}
      year={year}
      month={month}
      day={day}
      students={students}
    />
  );
}
