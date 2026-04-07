import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

async function main() {
  const result = await prisma.invoice.updateMany({
    where: { status: 'pending', pdfPath: null },
    data: { status: 'draft' },
  });
  console.log('Updated', result.count, 'invoices from pending → draft');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
