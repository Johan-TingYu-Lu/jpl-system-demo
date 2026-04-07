import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const enrollment = await prisma.enrollment.findUnique({
    where: { sheetsId: '543' },
    include: { person: { select: { name: true } } },
  });
  if (!enrollment) { console.log('Not found'); return; }
  console.log('Enrollment:', enrollment.id, enrollment.person.name, enrollment.classCode, enrollment.subject, enrollment.status);

  const jan = await prisma.monthlyAttendance.findFirst({
    where: { enrollmentId: enrollment.id, year: 2025, month: 1 },
  });
  if (jan) {
    const marks: string[] = [];
    for (let i = 0; i < 31; i++) {
      if (jan.days[i] > 0) marks.push(`D${i + 1}=${jan.days[i]}`);
    }
    console.log('1月有紀錄:', marks.join(', '));
  } else {
    console.log('1月無出席紀錄');
  }

  const invoices = await prisma.invoice.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { startDate: 'desc' },
  });
  console.log('收費單數:', invoices.length);
  for (const inv of invoices) {
    console.log(inv.serialNumber, inv.startDate.toISOString().slice(0, 10), '~', inv.endDate.toISOString().slice(0, 10), 'amt=' + inv.amount, inv.status, 'id=' + inv.id);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
