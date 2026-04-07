/**
 * 深度檢查 548, 549 的 DB 狀態與問題
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function go() {
  for (const sid of ['548', '549']) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        person: { select: { name: true } },
        invoices: {
          orderBy: { startDate: 'asc' },
          select: {
            id: true, serialNumber: true, amount: true, status: true,
            startDate: true, endDate: true, paidDate: true, createdAt: true,
          },
        },
        payments: {
          orderBy: { paymentDate: 'asc' },
          select: { id: true, amount: true, paymentDate: true, method: true, invoiceId: true },
        },
      },
    });

    if (!enrollment) { console.log(`${sid}: NOT FOUND`); continue; }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${sid} ${enrollment.person.name} (${enrollment.className})`);
    console.log(`${'='.repeat(60)}`);

    // All invoices
    const paid = enrollment.invoices.filter(i => i.status === 'paid');
    const draft = enrollment.invoices.filter(i => i.status === 'draft');
    const other = enrollment.invoices.filter(i => i.status !== 'paid' && i.status !== 'draft');

    console.log(`\nInvoices: total=${enrollment.invoices.length} paid=${paid.length} draft=${draft.length} other=${other.length}`);
    console.log(`Paid total: $${paid.reduce((s, i) => s + i.amount, 0).toLocaleString()}`);
    console.log(`Draft total: $${draft.reduce((s, i) => s + i.amount, 0).toLocaleString()}`);

    for (const inv of enrollment.invoices) {
      const start = inv.startDate?.toISOString().split('T')[0] ?? '?';
      const end = inv.endDate?.toISOString().split('T')[0] ?? '?';
      const paidD = inv.paidDate?.toISOString().split('T')[0] ?? '--';
      console.log(`  [${inv.status.padEnd(5)}] ${inv.serialNumber} | $${inv.amount} | ${start}~${end} | paid:${paidD} | id:${inv.id}`);
    }

    console.log(`\nPayments: ${enrollment.payments.length}`);
    for (const p of enrollment.payments) {
      const pDate = p.paymentDate?.toISOString().split('T')[0] ?? '?';
      console.log(`  $${p.amount} | ${pDate} | ${p.method} | invoiceId:${p.invoiceId ?? 'null'}`);
    }

    // Check: which draft invoices exist that should be payable?
    if (draft.length > 0) {
      console.log(`\n>>> DRAFT invoices that need paying:`);
      for (const d of draft) {
        console.log(`  ID=${d.id} ${d.serialNumber} $${d.amount}`);
      }
    } else {
      console.log(`\n>>> No draft invoices found. All invoices are paid.`);
    }

    // Check: billing page logic - it only shows LATEST invoice
    const latestByEndDate = [...enrollment.invoices].sort((a, b) =>
      (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0)
    )[0];
    if (latestByEndDate) {
      console.log(`\n>>> Billing page shows LATEST invoice: ${latestByEndDate.serialNumber} status=${latestByEndDate.status}`);
      if (latestByEndDate.status === 'paid' && draft.length > 0) {
        console.log(`  !!! BUG: Latest is paid but there are ${draft.length} older draft invoices that are INVISIBLE on billing page!`);
      }
    }
  }
}

go()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
