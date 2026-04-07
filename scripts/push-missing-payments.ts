/**
 * Push missing payment records to Google Sheets for 548, 549
 * 548: missing payments #7, #8, #9
 * 549: missing payment #5
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { pushPayment } from '../src/lib/sheets-push.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function go() {
  for (const sid of ['548', '549']) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        invoices: {
          where: { serialNumber: { startsWith: '26-' }, status: 'paid' },
          orderBy: { startDate: 'asc' },
          include: {
            payments: { orderBy: { paymentDate: 'asc' }, take: 1, select: { paymentDate: true } },
          },
        },
      },
    });

    if (!enrollment) continue;

    console.log(`\n=== ${sid} ===`);
    console.log(`Total 114 paid invoices: ${enrollment.invoices.length}`);

    // We know from the gap analysis:
    // 548: Sheets has 6 payments, DB has 9 → push #7, #8, #9
    // 549: Sheets has 4 payments, DB has 5 → push #5
    const sheetCounts: Record<string, number> = { '548': 6, '549': 4 };
    const sheetCount = sheetCounts[sid];

    for (let i = sheetCount; i < enrollment.invoices.length; i++) {
      const inv = enrollment.invoices[i];
      const payDate = inv.payments[0]?.paymentDate ?? new Date();
      console.log(`Pushing payment #${i + 1}: ${inv.serialNumber} $${inv.amount} paid:${payDate.toISOString().split('T')[0]}`);

      const result = await pushPayment({
        sheetsId: sid,
        academicYear: 114,
        amount: inv.amount,
        paymentDate: payDate,
        paymentCount: i + 1,
      });

      if (result.success) {
        console.log(`  ✓ Pushed successfully`);
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }
    }
  }
}

go()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
