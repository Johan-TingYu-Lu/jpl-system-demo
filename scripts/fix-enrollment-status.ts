/**
 * 修正 enrollment status：
 * - 有 endYear=114 的保持 active
 * - endYear < 114 或 NULL 的，檢查最近 invoice 日期
 *   - 最近 invoice endDate 在 114 學年範圍內（2025/08/01 以後）→ active, endYear=114
 *   - 否則 → inactive
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// 114 學年起始：2025/08/01
const YEAR_114_START = new Date(2025, 7, 1);

async function main() {
  // 先看目前狀態
  const total = await prisma.enrollment.count();
  const active = await prisma.enrollment.count({ where: { status: 'active' } });
  const withEndYear114 = await prisma.enrollment.count({ where: { endYear: 114 } });
  console.log(`Total: ${total}, Active: ${active}, endYear=114: ${withEndYear114}`);

  // 取得所有 active 的 enrollment + 最近 invoice
  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      sheetsId: true,
      endYear: true,
      className: true,
      invoices: {
        orderBy: { endDate: 'desc' },
        take: 1,
        select: { endDate: true },
      },
      attendances: {
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 1,
        select: { year: true, month: true },
      },
    },
  });

  let keepActive = 0;
  let setInactive = 0;

  for (const e of enrollments) {
    // 已經是 114 的保持
    if (e.endYear === 114) {
      keepActive++;
      continue;
    }

    const lastInvoiceDate = e.invoices[0]?.endDate;
    const lastAttendance = e.attendances[0];

    // 檢查是否有 114 學年的出勤（2025/08 以後）
    let hasRecentAttendance = false;
    if (lastAttendance) {
      const attDate = new Date(lastAttendance.year, lastAttendance.month - 1, 1);
      hasRecentAttendance = attDate >= YEAR_114_START;
    }

    // 檢查是否有 114 學年的 invoice
    let hasRecentInvoice = false;
    if (lastInvoiceDate) {
      hasRecentInvoice = lastInvoiceDate >= YEAR_114_START;
    }

    if (hasRecentAttendance || hasRecentInvoice) {
      // 有近期活動 → 保持 active，更新 endYear
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { endYear: 114 },
      });
      keepActive++;
    } else {
      // 沒有近期活動 → inactive
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { status: 'inactive' },
      });
      setInactive++;
    }
  }

  console.log(`\nResult: ${keepActive} kept active, ${setInactive} set to inactive`);

  // 驗證
  const newActive = await prisma.enrollment.count({ where: { status: 'active' } });
  const newInactive = await prisma.enrollment.count({ where: { status: 'inactive' } });
  console.log(`After fix: active=${newActive}, inactive=${newInactive}`);

  await prisma.$disconnect();
}

main().catch(console.error);
