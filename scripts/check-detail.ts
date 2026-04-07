import 'dotenv/config';
import prisma from '../src/lib/prisma.js';
import { calculateBilling } from '../src/lib/billing-engine.js';
import { getBillableAttendance, getLastInvoiceEndDate } from '../src/lib/attendance-reader.js';
import { resolveRateConfig } from '../src/lib/rate-resolver.js';

async function showDetail(name: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { person: { name } },
    include: { person: true },
  });

  for (const e of enrollments) {
    console.log(`\n====== ${name} | ${e.className} | sheetsId=${e.sheetsId} | status=${e.status} ======`);

    const lastEndDate = await getLastInvoiceEndDate(e.id);
    console.log('上次收費單結束日 (FLAG):', lastEndDate ? lastEndDate.toISOString().slice(0, 10) : '無');

    const attendance = await getBillableAttendance(e.id, lastEndDate);
    console.log('可計費出席紀錄:', attendance.length, '筆');
    for (const a of attendance) {
      console.log(`  ${a.date} | ${a.status === 3 ? 'YY (2Y)' : 'Y  (1Y)'}`);
    }

    if (attendance.length > 0) {
      const resolved = await resolveRateConfig(e);
      const billing = calculateBilling(attendance, resolved.config, 'normal');
      console.log(`\n計費結果: ${resolved.planName} | canGenerate=${billing.canGenerate} | totalY=${billing.totalY}/${resolved.config.settlementSessions * 2} | $${billing.totalFee}`);
      if (billing.canGenerate) {
        console.log(`收費單期間: ${billing.records[0].date} ~ ${billing.records[billing.records.length - 1].date}`);
        console.log('明細:');
        for (const r of billing.records) {
          console.log(`  ${r.date} | ${r.isSplit ? 'SPLIT' : r.status === 3 ? 'YY' : 'Y '} | ${r.yUsed}Y | $${r.fee}`);
        }
        if (billing.splitNote) console.log(billing.splitNote);
      }
      if (billing.leftoverEntries.length > 0) {
        console.log('剩餘（下期）:', billing.leftoverEntries.map(l => `${l.date}(${l.status === 3 ? 'YY' : 'Y'})`).join(', '));
      }
    }

    // Show existing invoices
    const invoices = await prisma.invoice.findMany({
      where: { enrollmentId: e.id },
      orderBy: { endDate: 'desc' },
      take: 3,
    });
    if (invoices.length > 0) {
      console.log('\n最近收費單:');
      for (const inv of invoices) {
        console.log(`  ${inv.serialNumber} | ${inv.startDate.toISOString().slice(0, 10)}~${inv.endDate.toISOString().slice(0, 10)} | $${inv.amount} | ${inv.status}`);
      }
    }
  }
}

async function main() {
  await showDetail('蕭以恩');
  await showDetail('林雪楓');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
