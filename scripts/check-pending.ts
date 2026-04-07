import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 先看所有 status 分佈
  const all = await prisma.invoice.findMany({
    select: { status: true }
  });

  const statusCount: Record<string, number> = {};
  for (const inv of all) {
    statusCount[inv.status] = (statusCount[inv.status] || 0) + 1;
  }

  console.log('=== Invoice Status 分佈 ===');
  console.log('總數:', all.length);
  for (const [status, count] of Object.entries(statusCount)) {
    console.log(`  ${status}: ${count}`);
  }

  // 列出非 paid 的
  const notPaid = await prisma.invoice.findMany({
    where: { status: { not: 'paid' } },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } }
      }
    },
    orderBy: { serialNumber: 'asc' }
  });

  console.log('');
  console.log('=== 非 paid 的收費單 ===');
  console.log('數量:', notPaid.length);
  for (let i = 0; i < notPaid.length; i++) {
    const inv = notPaid[i];
    const name = inv.enrollment.person.name;
    const subj = inv.enrollment.subject;
    const serial = inv.serialNumber;
    const amt = inv.amount;
    const status = inv.status;
    const created = inv.createdAt.toISOString().slice(0, 10);
    console.log(`${i + 1}. [${status}] ${serial} | ${name} | ${subj} | $${amt} | ${created}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
