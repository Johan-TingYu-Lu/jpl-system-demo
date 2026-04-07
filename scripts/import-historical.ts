/**
 * import-historical.ts — 歷年資料匯入 CLI
 *
 * 用法：
 *   npx tsx scripts/import-historical.ts                    # 匯入 106~113（預設）
 *   npx tsx scripts/import-historical.ts --years 108,109    # 只匯入指定學年
 *   npx tsx scripts/import-historical.ts --dry-run          # 模擬模式
 *   npx tsx scripts/import-historical.ts --skip-students    # 跳過學生同步
 *   npx tsx scripts/import-historical.ts --skip-attendance  # 跳過出席同步
 *   npx tsx scripts/import-historical.ts --skip-billing     # 跳過收費匯入
 *   npx tsx scripts/import-historical.ts --billing-only     # 只做收費匯入
 */
import 'dotenv/config';
import { importAllHistoricalYears } from '../src/lib/multi-year-importer';

async function main() {
  const args = process.argv.slice(2);

  // Parse --years 106,107,108
  let years: number[] | undefined;
  const yearsIdx = args.indexOf('--years');
  if (yearsIdx !== -1 && args[yearsIdx + 1]) {
    years = args[yearsIdx + 1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  }

  const dryRun = args.includes('--dry-run');
  const skipStudents = args.includes('--skip-students') || args.includes('--billing-only');
  const skipAttendance = args.includes('--skip-attendance') || args.includes('--billing-only');
  const skipBilling = args.includes('--skip-billing');

  console.log('🚀 歷年資料匯入');
  if (years) console.log(`   學年: ${years.join(', ')}`);
  if (dryRun) console.log('   模式: DRY RUN（不寫入 DB）');
  if (skipStudents) console.log('   跳過: 學生同步');
  if (skipAttendance) console.log('   跳過: 出席同步');
  if (skipBilling) console.log('   跳過: 收費匯入');

  const result = await importAllHistoricalYears(years, {
    dryRun,
    skipStudents,
    skipAttendance,
    skipBilling,
  });

  // Exit code based on errors
  if (result.summary.totalErrors > 0) {
    console.log(`\n⚠️ 完成但有 ${result.summary.totalErrors} 個錯誤`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('❌ Fatal error:', e);
  process.exit(2);
});
