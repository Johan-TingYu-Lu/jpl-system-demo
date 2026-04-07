/**
 * pull-billing-history.ts — CLI: 匯入歷史收費紀錄
 *
 * Usage:
 *   npx tsx scripts/pull-billing-history.ts             # 執行匯入
 *   npx tsx scripts/pull-billing-history.ts --dry-run   # 預覽，不寫 DB
 *   npx tsx scripts/pull-billing-history.ts --clean      # 清空舊資料後匯入
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const clean = args.includes('--clean');

  console.log('='.repeat(70));
  console.log('💰 JPL 歷史收費紀錄匯入');
  console.log('='.repeat(70));
  if (dryRun) console.log('⚠️  DRY RUN 模式 — 不會寫入 DB');

  // Clean old data if requested
  if (clean && !dryRun) {
    console.log('\n🗑️  清空舊資料...');
    const paymentCount = await prisma.payment.deleteMany();
    const invoiceCount = await prisma.invoice.deleteMany();
    console.log(`   刪除 ${paymentCount.count} 筆 payments, ${invoiceCount.count} 筆 invoices`);
  }

  // Dynamic import to use the project's prisma instance
  const { pullBillingHistory } = await import('../src/lib/billing-history-importer.js');

  const result = await pullBillingHistory({ dryRun });

  console.log('\n' + '='.repeat(70));
  console.log('📊 匯入結果');
  console.log('='.repeat(70));
  console.log(`  收費單建立: ${result.invoicesCreated}`);
  console.log(`  繳費紀錄建立: ${result.paymentsCreated}`);
  console.log(`  跳過（已存在）: ${result.skipped}`);
  console.log(`  無出席資料: ${result.noAttendance}`);
  console.log(`  金額差異警告: ${result.warnings.length}`);
  console.log(`  錯誤: ${result.errors.length}`);

  if (result.warnings.length > 0) {
    console.log('\n⚠️  金額差異清單:');
    for (const w of result.warnings) {
      console.log(`  ${w.sheetsId} ${w.name} 第${w.invoiceIndex + 1}張: Sheet=$${w.sheetAmount} vs 計算=$${w.calculatedAmount} (差 $${w.difference})`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\n❌ 錯誤清單:');
    for (const e of result.errors) {
      console.log(`  ${e}`);
    }
  }

  // Verify
  if (!dryRun) {
    const totalInvoices = await prisma.invoice.count();
    const totalPayments = await prisma.payment.count();
    const paidInvoices = await prisma.invoice.count({ where: { status: 'paid' } });
    console.log(`\n📋 DB 現況:`);
    console.log(`  invoices 總計: ${totalInvoices} (已繳: ${paidInvoices}, 待繳: ${totalInvoices - paidInvoices})`);
    console.log(`  payments 總計: ${totalPayments}`);
  }

  console.log('\n' + '='.repeat(70));
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
