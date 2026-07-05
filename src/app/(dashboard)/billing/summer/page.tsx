/**
 * 暑期合併點名（準備結算）
 *
 * 一張表混高一高二、照年級排、不分科。老師自行「新增上課日」→ 點名 → 逐生「結算」。
 *
 * 架構：重用現有 MonthlyAttendance；每生挑載體 enrollment(id最小) 承載暑期點名。
 *   點名 → days[日-1]=代碼(2/3)；結算 → summer-settlement.ts force 合併開單。
 *
 * ⚠️ 此頁負責點名輸入 + 逐生結算觸發；結算前會先 dry-run 顯示金額。
 */
import prisma from '@/lib/prisma';
import { extractBillableDates } from '@/lib/attendance-utils';
import { SUMMER_MARK, canonicalPersonId } from '@/lib/summer-settlement';
import SummerRollCall, { type SummerStudent } from './SummerRollCall';

function gradeOf(cohort: number | null, className: string): '高一' | '高二' | null {
  if (cohort === 117 || className.includes('高一')) return '高一';
  if (cohort === 116 || className.includes('高二')) return '高二';
  return null;
}

export default async function SummerPage() {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      status: 'active',
      OR: [
        { cohort: { in: [116, 117] } },
        { className: { contains: '高一' } },
        { className: { contains: '高二' } },
      ],
    },
    include: { person: { select: { id: true, name: true } }, attendances: true },
    orderBy: [{ sheetsId: 'asc' }, { id: 'asc' }],
  });

  // 依「活人」分組（canonical personId）——一人兩科=兩個學號，按學號分組會一人兩列
  const byStudent = new Map<number, typeof enrollments>();
  for (const e of enrollments) {
    const pid = canonicalPersonId(e.person.id);
    const arr = byStudent.get(pid) ?? [];
    arr.push(e);
    byStudent.set(pid, arr);
  }

  // 哪些學生已有暑期結算單（用於灰底跳過）
  const allEnrollmentIds = enrollments.map(e => e.id);
  const settledInvoices = await prisma.invoice.findMany({
    where: { enrollmentId: { in: allEnrollmentIds }, note: { startsWith: SUMMER_MARK } },
    select: { enrollmentId: true, serialNumber: true },
  });
  const settledEnrollment = new Map(settledInvoices.map(i => [i.enrollmentId, i.serialNumber]));

  // 暑期起始日：此日(含)之後有點名紀錄的日期，自動還原成表格欄位
  // （不設界線會把整學期舊上課日全拖進暑期表）
  const SUMMER_START = '2026/07/01';
  const summerDates = new Set<string>();

  const students: SummerStudent[] = [];
  for (const [, group] of byStudent) {
    const grade = gradeOf(group[0].cohort, group[0].className);
    if (!grade) continue;
    const carrier = group.reduce((min, e) => (e.id < min.id ? e : min), group[0]);

    const marks: Record<string, number> = {};
    const billable = extractBillableDates(
      carrier.attendances.map(a => ({ year: a.year, month: a.month, days: a.days })),
      { useUTC: true, validateDate: true }
    );
    for (const b of billable) {
      marks[b.dateStr] = b.code;
      if (b.dateStr >= SUMMER_START) summerDates.add(b.dateStr);
    }

    const settledSerial = group.map(g => settledEnrollment.get(g.id)).find(Boolean) ?? null;

    students.push({
      sheetsId: carrier.sheetsId,
      // 顯示名去尾綴班別字母（"田峻安N" → "田峻安"）
      name: group[0].person.name.replace(/[A-Za-z]+$/, '').trim(),
      grade,
      carrierEnrollmentId: carrier.id,
      subjects: [...new Set(group.map(g => g.subject))],
      marks,
      settledSerial,
    });
  }

  // 照年級排：高一 → 高二，組內照學號
  const order: Record<string, number> = { 高一: 0, 高二: 1 };
  students.sort((a, b) => order[a.grade] - order[b.grade] || parseInt(a.sheetsId) - parseInt(b.sheetsId));

  return <SummerRollCall students={students} initialDates={[...summerDates].sort()} />;
}
