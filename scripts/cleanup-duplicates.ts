import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find all invoices created on 2026-03-11 (the batch run)
  const batchInvoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: new Date('2026-03-11T00:00:00Z') },
    },
    select: { id: true, serialNumber: true, createdAt: true },
  });

  console.log(`Found ${batchInvoices.length} invoices from batch run:`);
  for (const inv of batchInvoices) {
    console.log(`  ${inv.serialNumber} (id=${inv.id}, created=${inv.createdAt.toISOString()})`);
  }

  if (batchInvoices.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const ids = batchInvoices.map(i => i.id);

  // Delete audit logs for these invoices
  const auditDeleted = await prisma.auditLog.deleteMany({
    where: { tableName: 'invoices', recordId: { in: ids } },
  });
  console.log(`\nDeleted ${auditDeleted.count} audit log entries`);

  // Delete the invoices
  const invoiceDeleted = await prisma.invoice.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`Deleted ${invoiceDeleted.count} invoices`);

  const remaining = await prisma.invoice.count();
  console.log(`\nRemaining invoices in DB: ${remaining}`);
}

main().finally(() => prisma.$disconnect());
