import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.enrollment.count();
  const active = await prisma.enrollment.count({ where: { status: 'active' } });
  const ey114 = await prisma.enrollment.count({ where: { endYear: 114 } });
  const both = await prisma.enrollment.count({ where: { status: 'active', endYear: 114 } });

  // distinct endYear values
  const years = await prisma.enrollment.groupBy({ by: ['endYear'], _count: true, orderBy: { endYear: 'asc' } });
  // distinct status values
  const statuses = await prisma.enrollment.groupBy({ by: ['status'], _count: true });

  const sample = await prisma.enrollment.findMany({
    take: 5,
    select: { id: true, sheetsId: true, status: true, endYear: true, className: true },
  });

  console.log('Total enrollments:', total);
  console.log('Active:', active);
  console.log('endYear=114:', ey114);
  console.log('active + endYear=114:', both);
  console.log('By endYear:', JSON.stringify(years));
  console.log('By status:', JSON.stringify(statuses));
  console.log('Sample:', JSON.stringify(sample, null, 2));

  // invoices count
  const invoiceCount = await prisma.invoice.count();
  console.log('Total invoices:', invoiceCount);

  await prisma.$disconnect();
}

main();
