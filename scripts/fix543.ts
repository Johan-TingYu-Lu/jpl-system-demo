/**
 * fix543.ts — 修正 543 田芯瑜
 * 1. 從 Sheets 重新同步出席紀錄（全部月份）
 * 2. 刪除最新 2 張 draft 收費單 (id=3922, 3418)
 * 3. 重新生成收費單
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { pullAttendance } from '../src/lib/sync-engine.js';
import { generateInvoice } from '../src/lib/invoice-generator.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const SHEETS_ID = '543';
  const DRAFT_IDS = [3922, 3418];

  // Step 0: 確認 enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { sheetsId: SHEETS_ID },
    include: { person: { select: { name: true } } },
  });
  if (!enrollment) { console.log('Enrollment not found'); return; }
  console.log(`\n🔍 ${enrollment.person.name} (${SHEETS_ID}) enrollmentId=${enrollment.id}\n`);

  // Step 1: 重新拉出席紀錄
  console.log('📥 Step 1: 從 Sheets 同步出席紀錄...');
  const vectors = await pullAttendance();
  console.log(`   同步了 ${vectors} 個月向量`);

  // 確認 1 月出席
  const jan = await prisma.monthlyAttendance.findFirst({
    where: { enrollmentId: enrollment.id, year: 2025, month: 1 },
  });
  if (jan) {
    const marks: string[] = [];
    for (let i = 0; i < 31; i++) {
      if (jan.days[i] > 0) marks.push(`D${i + 1}=${jan.days[i] === 3 ? 'YY' : jan.days[i] === 2 ? 'Y' : 'V'}`);
    }
    console.log(`   2025/01 出席: ${marks.join(', ')}`);
  } else {
    console.log('   ⚠️ 2025/01 仍無出席紀錄！');
  }

  // Step 2: 刪除最新 2 張 draft
  console.log('\n🗑️ Step 2: 刪除 draft 收費單...');
  for (const id of DRAFT_IDS) {
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) {
      console.log(`   id=${id} 不存在，跳過`);
      continue;
    }
    if (inv.enrollmentId !== enrollment.id) {
      console.log(`   ⚠️ id=${id} 不屬於 ${SHEETS_ID}，跳過！`);
      continue;
    }
    if (inv.status !== 'draft' && inv.status !== 'pending') {
      console.log(`   ⚠️ id=${id} status=${inv.status}，非 draft/pending，跳過！`);
      continue;
    }
    // Delete associated PDF path reference
    await prisma.invoice.delete({ where: { id } });
    console.log(`   ✅ 已刪除 ${inv.serialNumber} (id=${id}, $${inv.amount})`);
  }

  // Step 3: 重新生成
  console.log('\n🔄 Step 3: 重新生成收費單...');
  let count = 0;
  let keepGoing = true;
  while (keepGoing) {
    const result = await generateInvoice({ enrollmentId: enrollment.id, mode: 'normal' });
    if (result.success) {
      count++;
      console.log(`   ✅ ${result.serialNumber} | $${result.billing?.totalFee} | ${result.billing?.totalY}Y`);
    } else {
      keepGoing = false;
      if (count === 0) {
        console.log(`   ⚠️ 無法生成: ${result.error}`);
      }
    }
  }
  console.log(`\n📊 共生成 ${count} 張收費單`);

  // Step 4: 列出所有收費單確認
  console.log('\n=== 最終收費單列表 ===');
  const allInvoices = await prisma.invoice.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { startDate: 'asc' },
  });
  for (const inv of allInvoices) {
    console.log(`  ${inv.serialNumber} ${inv.startDate.toISOString().slice(0, 10)} ~ ${inv.endDate.toISOString().slice(0, 10)} $${inv.amount} ${inv.status} id=${inv.id}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
