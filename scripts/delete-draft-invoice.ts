import prisma from '@/lib/prisma';

async function main() {
  const inv = await prisma.invoice.findUnique({ where: { id: 10787 } });
  if (!inv) { console.log('Invoice 10787 not found'); return; }
  console.log('Found:', inv.serialNumber, inv.status, inv.amount);
  
  if (inv.status !== 'draft') {
    console.log('ERROR: Not a draft, refusing to delete');
    return;
  }
  
  await prisma.invoice.delete({ where: { id: 10787 } });
  console.log('Deleted invoice 10787 successfully');
}
main().catch(e => { console.error(e); process.exit(1); });
