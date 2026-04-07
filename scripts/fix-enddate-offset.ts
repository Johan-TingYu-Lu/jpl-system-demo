/**
 * 修正 invoice endDate/startDate 的 UTC 時區偏移
 *
 * 問題：new Date('YYYY-MM-DD') 產生 UTC midnight，
 *       存入 @db.Date 後讀出時在 UTC+8 區域會往前一天
 *
 * 修正：從 records JSON 取出正確的日期，重新設定
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // 只查 draft status 和非歷史（serial 以 26- 開頭）的 invoices
  const invoices = await prisma.invoice.findMany({
    where: { serialNumber: { startsWith: '26-' } },
    select: { id: true, serialNumber: true, startDate: true, endDate: true, records: true, status: true },
    orderBy: { id: 'asc' },
  });

  console.log(`Checking ${invoices.length} current-year invoices...`);
  let fixed = 0;
  let ok = 0;

  for (const inv of invoices) {
    const records = inv.records as any[];
    if (!records || !Array.isArray(records) || records.length === 0) continue;

    const firstDate = records[0].date as string; // "YYYY/MM/DD"
    const lastDate = records[records.length - 1].date as string;

    // Parse as UTC date to match PostgreSQL @db.Date storage
    const parseUTC = (d: string) => {
      const [y, m, day] = d.split('/').map(Number);
      return new Date(Date.UTC(y, m - 1, day));
    };

    const correctStart = parseUTC(firstDate);
    const correctEnd = parseUTC(lastDate);

    const dbStart = inv.startDate.toISOString().slice(0, 10);
    const dbEnd = inv.endDate.toISOString().slice(0, 10);
    const expectStart = correctStart.toISOString().slice(0, 10);
    const expectEnd = correctEnd.toISOString().slice(0, 10);

    if (dbStart !== expectStart || dbEnd !== expectEnd) {
      console.log(`❌ ${inv.serialNumber} | DB: ${dbStart}~${dbEnd} | Correct: ${expectStart}~${expectEnd} | ${inv.status}`);
      if (!DRY_RUN) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { startDate: correctStart, endDate: correctEnd },
        });
      }
      fixed++;
    } else {
      ok++;
    }
  }

  console.log(`\nResult: ${ok} OK, ${fixed} ${DRY_RUN ? 'would fix' : 'FIXED'}`);
  await prisma.$disconnect();
}

main().catch(console.error);
