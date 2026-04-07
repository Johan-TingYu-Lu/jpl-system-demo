import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const sid = process.argv[2] || '691';

async function main() {
  const enrollment = await prisma.enrollment.findUnique({
    where: { sheetsId: sid },
    include: { person: { select: { name: true } } },
  });
  if (!enrollment) { console.log('Not found:', sid); return; }
  console.log(`=== ${sid} ${enrollment.person.name} (${enrollment.classCode}/${enrollment.subject}) ===`);

  // Invoices
  const invoices = await prisma.invoice.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { startDate: 'asc' },
  });
  console.log(`\nInvoices (${invoices.length}):`);
  for (const inv of invoices) {
    const recs = inv.records as any[];
    const dates = recs?.map((r: any) => r.date) || [];
    console.log(`  ${inv.serialNumber} | ${inv.startDate.toISOString().slice(0,10)} ~ ${inv.endDate.toISOString().slice(0,10)} | $${inv.amount} | created: ${inv.createdAt.toISOString().slice(0,10)}`);
    console.log(`    dates: ${dates.join(', ')}`);
  }

  // Attendance
  const att = await prisma.monthlyAttendance.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  console.log(`\nAttendance:`);
  for (const m of att) {
    const entries: string[] = [];
    for (let d = 0; d < 31; d++) {
      if (m.days[d] === 2 || m.days[d] === 3) {
        entries.push(`${m.year}/${String(m.month).padStart(2,'0')}/${String(d+1).padStart(2,'0')}:${m.days[d]===3?'YY':'Y'}`);
      }
    }
    if (entries.length > 0) console.log(`  ${entries.join(', ')}`);
  }
}

main().finally(() => prisma.$disconnect());
