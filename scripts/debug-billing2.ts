/**
 * 除錯：顯示指定學生的「上次收費單的5次」和「這次的5次」出勤紀錄
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { extractBillableDates } from '../src/lib/attendance-utils';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TARGET_IDS = ['542', '551', '607'];

async function main() {
  for (const sid of TARGET_IDS) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        person: { select: { name: true } },
        invoices: {
          orderBy: { endDate: 'desc' },
          take: 2,
          select: { id: true, serialNumber: true, startDate: true, endDate: true, amount: true, status: true, records: true, totalY: true },
        },
      },
    });
    if (!enrollment) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${sid} ${enrollment.person.name} | ${enrollment.className}`);
    console.log('='.repeat(60));

    // 上次收費單（第2新的）
    const prevInv = enrollment.invoices[1];
    const lastInv = enrollment.invoices[0];

    // 取得所有出勤
    const allMonths = await prisma.monthlyAttendance.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const allBillable = extractBillableDates(allMonths, { useUTC: false, validateDate: true });

    // 上次收費單的出勤紀錄
    if (prevInv) {
      const prevFlag = enrollment.invoices.length > 1
        ? await prisma.invoice.findFirst({
            where: { enrollmentId: enrollment.id, endDate: { lt: prevInv.startDate } },
            orderBy: { endDate: 'desc' },
            select: { endDate: true },
          })
        : null;

      console.log(`\n【上次收費單】${prevInv.serialNumber}`);
      console.log(`  期間: ${prevInv.startDate.toISOString().slice(0,10)} ~ ${prevInv.endDate.toISOString().slice(0,10)}`);
      console.log(`  金額: $${prevInv.amount} | Y: ${prevInv.totalY} | 狀態: ${prevInv.status}`);

      // 從 records JSON 取出日期
      const prevRecords = prevInv.records as any[];
      if (prevRecords && Array.isArray(prevRecords)) {
        console.log(`  出勤明細 (from invoice records):`);
        prevRecords.forEach((r: any, i: number) => {
          console.log(`    ${i+1}. ${r.date} | ${r.status === 3 ? 'YY' : 'Y'} | fee=$${r.fee}${r.isSplit ? ' (拆分)' : ''}`);
        });
      }
    }

    // 這次（最新）收費單 or 待生成的
    if (lastInv) {
      console.log(`\n【最新收費單】${lastInv.serialNumber}`);
      console.log(`  期間: ${lastInv.startDate.toISOString().slice(0,10)} ~ ${lastInv.endDate.toISOString().slice(0,10)}`);
      console.log(`  金額: $${lastInv.amount} | Y: ${lastInv.totalY} | 狀態: ${lastInv.status}`);

      const lastRecords = lastInv.records as any[];
      if (lastRecords && Array.isArray(lastRecords)) {
        console.log(`  出勤明細 (from invoice records):`);
        lastRecords.forEach((r: any, i: number) => {
          console.log(`    ${i+1}. ${r.date} | ${r.status === 3 ? 'YY' : 'Y'} | fee=$${r.fee}${r.isSplit ? ' (拆分)' : ''}`);
        });
      }
    }

    // 目前 FLAG 之後可計費的出勤（即「待生成」的那些）
    const currentFlag = lastInv?.endDate;
    const pending = allBillable.filter(b => !currentFlag || b.date > currentFlag);
    console.log(`\n【FLAG 之後待計費】(FLAG: ${currentFlag?.toISOString().slice(0,10) ?? 'null'})`);
    if (pending.length > 0) {
      pending.forEach((p, i) => {
        console.log(`    ${i+1}. ${p.dateStr} | ${p.code === 3 ? 'YY (2Y)' : 'Y (1Y)'}`);
      });
      const totalY = pending.reduce((sum, p) => sum + (p.code === 3 ? 2 : 1), 0);
      console.log(`  合計: ${pending.length} 次, ${totalY}Y (門檻 10Y)`);
    } else {
      console.log(`  無待計費出勤`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
