import 'dotenv/config';
import prisma from '../src/lib/prisma.js';
import { readBillingHistory, formatDate } from '../src/lib/sheets-billing-reader.js';
import { getLastInvoiceEndDate } from '../src/lib/attendance-reader.js';

async function main() {
  console.log('讀取 Sheet 計費日期表...');
  const billingData = await readBillingHistory();
  console.log(`共 ${billingData.length} 筆學生計費資料\n`);

  // For each student in sheet, compare their latest endDate with DB FLAG
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const student of billingData) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: student.sheetsId },
      include: { person: true },
    });
    if (!enrollment) { notFound++; continue; }

    // Sheet 最新收費單的 endDate
    const sheetInvoices = student.invoices.sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
    const sheetLatestEnd = sheetInvoices[sheetInvoices.length - 1].endDate;

    // DB FLAG
    const dbFlag = await getLastInvoiceEndDate(enrollment.id);

    if (!dbFlag || sheetLatestEnd.getTime() > dbFlag.getTime()) {
      // Sheet has newer invoices than DB — find missing ones
      const missingInvoices = dbFlag
        ? sheetInvoices.filter(inv => inv.endDate.getTime() > dbFlag.getTime())
        : sheetInvoices;

      // Only show if there are actually missing ones that DB doesn't know about
      if (missingInvoices.length > 0) {
        console.log(`${student.sheetsId} ${enrollment.person.name} ${enrollment.className}`);
        console.log(`  DB FLAG: ${dbFlag ? dbFlag.toISOString().slice(0, 10) : '無'}`);
        console.log(`  Sheet 最新: ${sheetLatestEnd.toISOString().slice(0, 10)}`);
        console.log(`  缺少 ${missingInvoices.length} 張:`);

        for (const inv of missingInvoices) {
          const start = inv.startDate;
          const end = inv.endDate;
          const amount = inv.sheetAmount ?? 0;
          const paid = inv.paymentDate;

          console.log(`    #${inv.invoiceIndex + 1}: ${start.toISOString().slice(0, 10)} ~ ${end.toISOString().slice(0, 10)} | $${amount} | 繳費: ${paid ? paid.toISOString().slice(0, 10) : '未繳'}`);

          // Create a placeholder invoice to update the FLAG
          const serial = `26-${student.sheetsId}-SYNC-${String(inv.invoiceIndex + 1).padStart(2, '0')}`;
          const existing = await prisma.invoice.findFirst({
            where: { enrollmentId: enrollment.id, startDate: start, endDate: end },
          });

          if (existing) {
            console.log(`    → 已存在 (${existing.serialNumber}), 跳過`);
            skipped++;
          } else {
            await prisma.invoice.create({
              data: {
                serialNumber: serial,
                hashCode: 'SYNC',
                enrollmentId: enrollment.id,
                startDate: start,
                endDate: end,
                amount,
                yyCount: 0,
                yCount: 0,
                totalY: 0,
                records: undefined,
                status: paid ? 'paid' : 'draft',
                paidDate: paid,
                issuedDate: new Date(),
                note: '從 Sheet 計費日期表同步補建',
              },
            });
            console.log(`    → 已補建 ${serial}`);
            updated++;
          }
        }
        console.log('');
      }
    }
  }

  console.log(`\n===== 結果 =====`);
  console.log(`補建: ${updated} 張`);
  console.log(`已存在跳過: ${skipped} 張`);
  console.log(`找不到 enrollment: ${notFound} 筆`);

  // Verify the 4 targets
  console.log('\n===== 驗證目標學生 FLAG =====');
  for (const sid of ['629', '630', '664', '665']) {
    const e = await prisma.enrollment.findUnique({ where: { sheetsId: sid }, include: { person: true } });
    if (!e) continue;
    const flag = await getLastInvoiceEndDate(e.id);
    console.log(`${sid} ${e.person.name} ${e.className} → FLAG: ${flag ? flag.toISOString().slice(0, 10) : '無'}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
