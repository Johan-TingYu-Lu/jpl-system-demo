import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

async function main() {
  // Check 2026/03 attendance vectors
  const att = await prisma.monthlyAttendance.findMany({
    where: { year: 2026, month: 3 },
    include: { enrollment: { include: { person: true } } },
  });
  console.log('=== 2026/03 出席紀錄 ===');
  console.log('總筆數:', att.length);

  const activeAtt = att.filter(a => a.enrollment.status === 'active');
  console.log('其中 active:', activeAtt.length);

  // Check existing invoices covering March 2026
  const marchStart = new Date('2026-03-01');
  const marchEnd = new Date('2026-03-31');
  const invoices = await prisma.invoice.findMany({
    where: {
      startDate: { lte: marchEnd },
      endDate: { gte: marchStart },
    },
    include: { enrollment: { include: { person: true } } },
  });
  console.log('\n=== 涵蓋 2026/03 的收費單 ===');
  console.log('總筆數:', invoices.length);
  for (const inv of invoices) {
    console.log(inv.serialNumber, inv.enrollment.person.name, inv.enrollment.className,
      '狀態:', inv.status, '金額:', inv.amount,
      '期間:', inv.startDate.toISOString().slice(0,10), '~', inv.endDate.toISOString().slice(0,10));
  }

  // Find active enrollments with March attendance but no invoice
  const invoiceEnrollIds = new Set(invoices.map(i => i.enrollmentId));
  const needInvoice = activeAtt.filter(a => !invoiceEnrollIds.has(a.enrollmentId));

  console.log('\n=== 需要新收費單（有3月出席但無收費單）===');
  console.log('總筆數:', needInvoice.length);
  for (const a of needInvoice) {
    const activeDays = (a.days as number[]).filter(d => d > 0).length;
    console.log(a.enrollment.sheetsId, a.enrollment.person.name, a.enrollment.className, '出席天數:', activeDays);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
