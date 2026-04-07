import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.invoice.count();
  const paid = await prisma.invoice.count({ where: { status: 'paid' } });
  const pending = await prisma.invoice.count({ where: { status: 'pending' } });
  const payments = await prisma.payment.count();
  const withPdf = await prisma.invoice.count({ where: { pdfPath: { not: null } } });

  console.log(`invoices: ${total} (paid=${paid}, pending=${pending})`);
  console.log(`payments: ${payments}`);
  console.log(`with PDF: ${withPdf}`);

  const first3 = await prisma.invoice.findMany({ take: 3, orderBy: { id: 'asc' }, select: { id: true, serialNumber: true, amount: true, status: true } });
  console.log('\nFirst 3:', JSON.stringify(first3));

  const last3 = await prisma.invoice.findMany({ take: 3, orderBy: { id: 'desc' }, select: { id: true, serialNumber: true, amount: true, status: true } });
  console.log('Last 3:', JSON.stringify(last3));
}

main().catch(console.error).finally(() => prisma.$disconnect());
