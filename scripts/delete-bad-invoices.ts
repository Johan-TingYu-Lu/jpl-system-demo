import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BAD_SERIALS = [
  '26-563-11-X-03',  // 李泳嫻M - 永久停止
  '26-583-11-M-03',  // 林胤呈 - $0
  '26-693-08-X-01',  // 王亭雋N - 永久停止
  '26-555-02-N-08',  // 陳昶欣 - Sheets 沒有
  '26-591-01-M-05',  // 林彥祺 - Sheets 沒有
  '26-629-01-M-05',  // 蕭以恩 - Sheets 沒有
  '26-630-01-N-05',  // 蕭以恩 - Sheets 沒有
  '26-664-02-M-05',  // 林雪楓 - Sheets 沒有
  '26-665-01-N-04',  // 林雪楓 - Sheets 沒有
];

async function main() {
  console.log('=== 刪除 9 筆問題收費單 ===');

  for (const serial of BAD_SERIALS) {
    const inv = await prisma.invoice.findUnique({ where: { serialNumber: serial } });
    if (!inv) {
      console.log(`  ${serial} — 找不到，跳過`);
      continue;
    }

    // 先刪關聯的 payments
    const delPayments = await prisma.payment.deleteMany({ where: { invoiceId: inv.id } });
    if (delPayments.count > 0) {
      console.log(`  ${serial} — 刪除 ${delPayments.count} 筆 payment`);
    }

    // 刪除 invoice
    await prisma.invoice.delete({ where: { id: inv.id } });
    console.log(`  ${serial} — 已刪除 ($${inv.amount})`);
  }

  // 驗證
  const remaining = await prisma.invoice.count({ where: { status: 'draft' } });
  console.log(`\n刪除完成。剩餘 draft: ${remaining}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
