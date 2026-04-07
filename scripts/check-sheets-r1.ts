import 'dotenv/config';
import { readSheet } from '../src/lib/sheets';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // DB: 所有 draft invoices 的 sheetsId
  const drafts = await prisma.invoice.findMany({
    where: { status: 'draft' },
    include: {
      enrollment: {
        select: { sheetsId: true, person: { select: { name: true } }, subject: true, status: true }
      }
    },
    orderBy: { serialNumber: 'asc' }
  });

  const dbSheetsIds = new Set(drafts.map(d => d.enrollment.sheetsId));

  // Sheets: 讀取 A 到 R
  const rows = await readSheet("'學費收支總表'!A1:R500");

  // 找出 Sheets 中 N 欄（當年度未繳次）> 0 的
  console.log('=== Sheets 中有未繳的 enrollments ===');
  const sheetsPending = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const sid = String(row[0] || '').trim();
    const name = String(row[1] || '');
    const colN = Number(row[13] || 0); // N 欄：當年度未繳次
    const colO = Number(row[14] || 0); // O 欄：累計未繳次數
    const colP = Number(row[15] || 0); // P 欄：應製單數
    if (sid && colN > 0) {
      sheetsPending.add(sid);
    }
  }

  console.log('Sheets 未繳數:', sheetsPending.size);
  console.log('DB draft 數:', drafts.length);
  console.log('');

  // 在 DB 但不在 Sheets 的
  console.log('=== DB 有 draft 但 Sheets 沒有未繳的 ===');
  let extraCount = 0;
  for (const d of drafts) {
    const sid = d.enrollment.sheetsId;
    if (!sheetsPending.has(sid)) {
      extraCount++;
      console.log(`  ${d.serialNumber} | ${sid} | ${d.enrollment.person.name} | ${d.enrollment.subject} | $${d.amount} | enrollment status: ${d.enrollment.status}`);
    }
  }
  console.log('多出的數量:', extraCount);

  // 在 Sheets 但不在 DB 的
  console.log('\n=== Sheets 有未繳但 DB 沒有 draft 的 ===');
  let missingCount = 0;
  for (const sid of sheetsPending) {
    if (!dbSheetsIds.has(sid)) {
      missingCount++;
      console.log(`  sheetsId: ${sid}`);
    }
  }
  console.log('缺少的數量:', missingCount);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
