/**
 * POST /api/billing/summer/mark
 *
 * 暑期合併點名存檔：把 (carrierEnrollmentId, dateStr, code) 寫進 MonthlyAttendance.days[]。
 *   - days[日-1] = 代碼 (0=空/缺席, 2=Y半堂, 3=YY全堂)
 *   - 依 (enrollmentId, year, month) 分組，一次 upsert 一個月
 *
 * ⚠️ 只寫出勤，不開單。
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface MarkInput {
  carrierEnrollmentId: number;
  dateStr: string; // "YYYY/MM/DD"
  code: number;    // 0 | 2 | 3
}

export async function POST(request: Request) {
  let body: { marks?: MarkInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '無效的請求' }, { status: 400 });
  }
  const marks = body.marks;
  if (!Array.isArray(marks) || marks.length === 0) {
    return NextResponse.json({ success: false, error: '沒有點名資料' }, { status: 400 });
  }

  // 驗證 + 依 (enrollmentId, year, month) 分組
  type Key = string; // `${enrollmentId}-${year}-${month}`
  const groups = new Map<Key, { enrollmentId: number; year: number; month: number; daySets: { day: number; code: number }[] }>();

  for (const m of marks) {
    if (!Number.isInteger(m.carrierEnrollmentId)) {
      return NextResponse.json({ success: false, error: `無效 enrollmentId: ${m.carrierEnrollmentId}` }, { status: 400 });
    }
    if (![0, 2, 3].includes(m.code)) {
      return NextResponse.json({ success: false, error: `無效代碼 ${m.code}（只允許 0/2/3）` }, { status: 400 });
    }
    const parts = m.dateStr.split('/').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) {
      return NextResponse.json({ success: false, error: `無效日期: ${m.dateStr}` }, { status: 400 });
    }
    const [year, month, day] = parts;
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return NextResponse.json({ success: false, error: `日期超出範圍: ${m.dateStr}` }, { status: 400 });
    }
    const key = `${m.carrierEnrollmentId}-${year}-${month}`;
    const g = groups.get(key) ?? { enrollmentId: m.carrierEnrollmentId, year, month, daySets: [] };
    g.daySets.push({ day, code: m.code });
    groups.set(key, g);
  }

  let updated = 0;
  try {
    for (const g of groups.values()) {
      const existing = await prisma.monthlyAttendance.findUnique({
        where: { enrollmentId_year_month: { enrollmentId: g.enrollmentId, year: g.year, month: g.month } },
        select: { days: true },
      });
      const days: number[] = existing?.days ? [...existing.days] : [];
      for (const { day, code } of g.daySets) {
        while (days.length < day) days.push(0);
        days[day - 1] = code;
        updated++;
      }
      await prisma.monthlyAttendance.upsert({
        where: { enrollmentId_year_month: { enrollmentId: g.enrollmentId, year: g.year, month: g.month } },
        update: { days },
        create: { enrollmentId: g.enrollmentId, year: g.year, month: g.month, days },
      });
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated, months: groups.size });
}
