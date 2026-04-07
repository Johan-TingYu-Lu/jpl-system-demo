'use server';

import prisma from '@/lib/prisma';
import { pushAttendanceToSheets } from '@/lib/sheets-sync';

export async function saveAttendance(
  year: number,
  month: number,
  day: number,
  entries: { enrollmentId: number; status: number }[]
) {
  const dayIndex = day - 1; // 0-based index in days[] array

  // 1. 儲存到 DB
  for (const entry of entries) {
    let record = await prisma.monthlyAttendance.findUnique({
      where: {
        enrollmentId_year_month: {
          enrollmentId: entry.enrollmentId,
          year,
          month,
        },
      },
    });

    if (!record) {
      record = await prisma.monthlyAttendance.create({
        data: {
          enrollmentId: entry.enrollmentId,
          year,
          month,
          days: new Array(31).fill(0),
        },
      });
    }

    const newDays = [...record.days];
    newDays[dayIndex] = entry.status;

    await prisma.monthlyAttendance.update({
      where: { id: record.id },
      data: { days: newDays },
    });
  }

  // 2. 回寫 Google Sheets（背景執行，不阻擋 UI 回應）
  try {
    // 查出每個 enrollmentId 對應的 sheetsId
    const enrollments = await prisma.enrollment.findMany({
      where: { id: { in: entries.map(e => e.enrollmentId) } },
      select: { id: true, sheetsId: true },
    });
    const idMap = new Map(enrollments.map(e => [e.id, e.sheetsId]));

    const sheetsEntries = entries
      .filter(e => idMap.has(e.enrollmentId))
      .map(e => ({
        sheetsId: idMap.get(e.enrollmentId)!,
        status: e.status,
      }));

    if (sheetsEntries.length > 0) {
      await pushAttendanceToSheets(year, month, day, sheetsEntries);
    }
  } catch (err) {
    // Sheets 回寫失敗不影響 DB 儲存結果，只 log 錯誤
    console.error('[Sheets sync] 出勤回寫失敗:', err);
  }
}
