import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

async function main() {
  const targets = ['629', '630', '664', '665'];

  for (const sid of targets) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: { person: true },
    });
    if (!enrollment) { console.log(`${sid}: not found`); continue; }

    console.log(`\n====== ${enrollment.person.name} | ${enrollment.className} | sheetsId=${sid} ======`);

    const invoices = await prisma.invoice.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { endDate: 'asc' },
    });

    console.log(`共 ${invoices.length} 張收費單:`);
    for (const inv of invoices) {
      console.log(`  ${inv.serialNumber} | ${inv.startDate.toISOString().slice(0, 10)} ~ ${inv.endDate.toISOString().slice(0, 10)} | $${inv.amount} | ${inv.status} | id=${inv.id}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
