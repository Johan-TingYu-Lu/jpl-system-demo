/**
 * 除錯：檢查指定學生的 FLAG、出勤、計費計算
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { extractBillableDates } from '../src/lib/attendance-utils';
import { calculateBilling } from '../src/lib/billing-engine';
import { resolveRateConfig } from '../src/lib/rate-resolver';
import { readBillingHistory } from '../src/lib/sheets-billing-reader';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TARGET_IDS = ['542', '551', '607'];

async function main() {
  // 1. 從 Sheets 讀取計費歷史
  console.log('=== Reading Sheets billing history ===');
  const sheetData = await readBillingHistory();

  for (const sid of TARGET_IDS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Student ${sid}`);
    console.log('='.repeat(60));

    // --- Sheets 資料 ---
    const sheetStudent = sheetData.find(s => s.sheetsId === sid);
    if (sheetStudent) {
      console.log(`\n[Sheets] ${sheetStudent.name} | ${sheetStudent.classInfo}`);
      console.log(`[Sheets] Invoice count: ${sheetStudent.invoiceCount}`);
      const lastInv = sheetStudent.invoices[sheetStudent.invoices.length - 1];
      if (lastInv) {
        console.log(`[Sheets] Last invoice: #${lastInv.invoiceIndex + 1} | end: ${lastInv.endDate.toISOString().slice(0, 10)} | amount: ${lastInv.sheetAmount}`);
      }
    } else {
      console.log(`[Sheets] NOT FOUND in billing history`);
    }

    // --- DB 資料 ---
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        person: { select: { name: true } },
        invoices: {
          orderBy: { endDate: 'desc' },
          take: 3,
          select: { id: true, serialNumber: true, endDate: true, amount: true, status: true, startDate: true },
        },
      },
    });
    if (!enrollment) {
      console.log(`[DB] Enrollment not found`);
      continue;
    }

    console.log(`\n[DB] ${enrollment.person.name} | ${enrollment.className} | status: ${enrollment.status}`);
    const totalInvoices = await prisma.invoice.count({ where: { enrollmentId: enrollment.id } });
    console.log(`[DB] Total invoices: ${totalInvoices}`);

    const lastDbInv = enrollment.invoices[0];
    if (lastDbInv) {
      console.log(`[DB] Last invoice: ${lastDbInv.serialNumber} | start: ${lastDbInv.startDate.toISOString().slice(0, 10)} | end: ${lastDbInv.endDate.toISOString().slice(0, 10)} | $${lastDbInv.amount} | ${lastDbInv.status}`);
    }

    // --- FLAG 比對 ---
    const dbFlag = lastDbInv?.endDate;
    const sheetFlag = sheetStudent?.invoices[sheetStudent.invoices.length - 1]?.endDate;
    console.log(`\n[FLAG] DB:     ${dbFlag?.toISOString().slice(0, 10) ?? 'null'}`);
    console.log(`[FLAG] Sheets: ${sheetFlag?.toISOString().slice(0, 10) ?? 'null'}`);
    if (dbFlag && sheetFlag) {
      const match = dbFlag.toISOString().slice(0, 10) === sheetFlag.toISOString().slice(0, 10);
      console.log(`[FLAG] Match: ${match ? '✅' : '❌ MISMATCH'}`);
      if (!match) {
        console.log(`[FLAG] DB invoice count: ${totalInvoices}, Sheet invoice count: ${sheetStudent?.invoiceCount}`);
      }
    }

    // --- 出勤計算 ---
    const allMonths = await prisma.monthlyAttendance.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const billable = extractBillableDates(allMonths, { useUTC: false, validateDate: true });
    const afterFlag = billable.filter(b => !dbFlag || b.date > dbFlag);

    console.log(`\n[Attendance] Total billable dates: ${billable.length}`);
    console.log(`[Attendance] After FLAG (${dbFlag?.toISOString().slice(0, 10) ?? 'null'}): ${afterFlag.length} dates`);

    if (afterFlag.length > 0) {
      console.log(`[Attendance] Dates after FLAG:`);
      for (const a of afterFlag) {
        console.log(`  ${a.dateStr} | code=${a.code} (${a.code === 3 ? 'YY=2Y' : 'Y=1Y'})`);
      }
    }

    // --- 計費模擬 ---
    const resolved = await resolveRateConfig(enrollment);
    const attendance = afterFlag.map(b => ({ date: b.dateStr, status: b.code as 2 | 3 }));
    if (attendance.length > 0) {
      const billing = calculateBilling(attendance, resolved.config, 'normal');
      console.log(`\n[Billing] Plan: ${resolved.planName}`);
      console.log(`[Billing] Target Y: ${resolved.config.settlementSessions * 2}`);
      console.log(`[Billing] Current Y: ${billing.totalY}`);
      console.log(`[Billing] canGenerate: ${billing.canGenerate}`);
      console.log(`[Billing] totalFee: $${billing.totalFee}`);
    } else {
      console.log(`\n[Billing] No attendance after FLAG, cannot generate`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
