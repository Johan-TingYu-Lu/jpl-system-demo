import 'dotenv/config';
import prisma from '../src/lib/prisma.js';
import { calculateBilling } from '../src/lib/billing-engine.js';
import { getBillableAttendance, getLastInvoiceEndDate } from '../src/lib/attendance-reader.js';
import { resolveRateConfig } from '../src/lib/rate-resolver.js';

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    where: { status: { not: '永久停止' } },
    include: { person: { select: { name: true } } },
  });

  console.log(`檢查 ${enrollments.length} 筆 enrollment...\n`);

  const ready: {
    sheetsId: string; name: string; className: string; plan: string;
    totalY: number; target: number; totalFee: number; records: number;
    startDate: string; endDate: string; splitNote: string | null;
  }[] = [];

  let insufficientCount = 0;
  let noAttendanceCount = 0;

  for (const e of enrollments) {
    // Simulate the while loop from generateAllInvoices
    let keepGoing = true;
    // We track cumulative "virtual" invoices to handle multi-settlement
    let virtualLastEndDate = await getLastInvoiceEndDate(e.id);

    while (keepGoing) {
      const resolved = await resolveRateConfig(e);
      const attendance = await getBillableAttendance(e.id, virtualLastEndDate);

      if (attendance.length === 0) {
        if (virtualLastEndDate === await getLastInvoiceEndDate(e.id)) {
          noAttendanceCount++;
        }
        keepGoing = false;
        continue;
      }

      const billing = calculateBilling(attendance, resolved.config, 'normal');

      if (!billing.canGenerate) {
        if (virtualLastEndDate === await getLastInvoiceEndDate(e.id)) {
          insufficientCount++;
        }
        keepGoing = false;
        continue;
      }

      if (billing.totalFee <= 0) {
        keepGoing = false;
        continue;
      }

      const startDate = billing.records[0].date;
      const endDate = billing.records[billing.records.length - 1].date;

      ready.push({
        sheetsId: e.sheetsId,
        name: e.person.name,
        className: e.className,
        plan: resolved.planName,
        totalY: billing.totalY,
        target: resolved.config.settlementSessions * 2,
        totalFee: billing.totalFee,
        records: billing.records.length,
        startDate,
        endDate,
        splitNote: billing.splitNote,
      });

      // Move the virtual FLAG forward for next potential invoice
      virtualLastEndDate = new Date(endDate.replace(/\//g, '-'));
    }
  }

  console.log('=== 可生成收費單（已滿期）===');
  console.log(`共 ${ready.length} 張\n`);

  // Group by class
  const byClass = new Map<string, typeof ready>();
  for (const r of ready) {
    const key = r.className;
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(r);
  }

  for (const [cls, items] of byClass) {
    console.log(`--- ${cls} (${items.length} 張) ---`);
    for (const r of items) {
      const split = r.splitNote ? ' [有拆分]' : '';
      console.log(`  ${r.sheetsId} ${r.name} | ${r.plan} | ${r.totalY}Y/${r.target}Y | $${r.totalFee} | ${r.startDate}~${r.endDate}${split}`);
    }
  }

  console.log(`\n未滿期: ${insufficientCount}`);
  console.log(`無出席: ${noAttendanceCount}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
