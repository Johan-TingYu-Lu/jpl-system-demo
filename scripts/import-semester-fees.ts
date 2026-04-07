/**
 * import-semester-fees.ts — CLI 腳本：匯入書籍雜費
 *
 * Usage:
 *   npx tsx scripts/import-semester-fees.ts                    # 匯入 111~114
 *   npx tsx scripts/import-semester-fees.ts --dry-run          # 預覽模式
 *   npx tsx scripts/import-semester-fees.ts --years 112,113    # 指定學年
 */
import 'dotenv/config';
import { importAllSemesterFees } from '../src/lib/semester-fee-importer';
import prisma from '../src/lib/prisma';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const yearsArg = args.find((_, i) => args[i - 1] === '--years');
  const years = yearsArg ? yearsArg.split(',').map(Number) : undefined;

  console.log(`\n🔧 書籍雜費匯入${dryRun ? '（DRY RUN 預覽模式）' : ''}`);
  if (years) console.log(`   指定學年: ${years.join(', ')}`);
  console.log('');

  const result = await importAllSemesterFees({ dryRun, years });

  console.log('\n========================================');
  console.log('📊 匯入結果摘要');
  console.log('========================================');
  console.log(`  新增: ${result.created}`);
  console.log(`  跳過（已存在）: ${result.skipped}`);
  console.log(`  無 enrollment: ${result.noEnrollment}`);
  if (result.errors.length > 0) {
    console.log(`  ❌ 錯誤: ${result.errors.length}`);
    for (const e of result.errors) console.log(`    - ${e}`);
  }
  console.log('\n各學年明細:');
  for (const d of result.details) {
    console.log(`  ${d.academicYear}: +${d.created} / skip ${d.skipped}`);
  }

  // Show DB total
  const total = await prisma.semesterFee.count();
  console.log(`\n📦 DB semester_fees 總計: ${total} 筆`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
