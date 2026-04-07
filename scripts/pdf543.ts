/**
 * pdf543.ts — 生成 543 田芯瑜最新 2 張收費單的 PDF
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { renderInvoicePdf } from '../src/lib/pdf-renderer.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const enrollment = await prisma.enrollment.findUnique({
    where: { sheetsId: '543' },
  });
  if (!enrollment) { console.log('Not found'); return; }

  const invoices = await prisma.invoice.findMany({
    where: { enrollmentId: enrollment.id, status: 'pending' },
    orderBy: { startDate: 'asc' },
  });

  console.log(`找到 ${invoices.length} 張 pending 收費單\n`);

  for (const inv of invoices) {
    console.log(`生成 PDF: ${inv.serialNumber} (id=${inv.id})...`);
    const result = await renderInvoicePdf(inv.id);
    if (result.success) {
      console.log(`  ✅ ${result.pdfPath}`);
    } else {
      console.log(`  ❌ ${result.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
