import 'dotenv/config';
import { pullAll } from '../src/lib/sync-engine.js';
import { generateAllInvoices } from '../src/lib/invoice-generator.js';
import { runAudit } from '../src/lib/audit-engine.js';

const command = process.argv[2] || 'sync';

async function main() {
  if (command === 'sync') {
    console.log('開始同步 Sheets → DB ...');
    const result = await pullAll();
    console.log('同步完成：');
    console.log(JSON.stringify({
      persons: result.persons,
      enrollments: result.enrollments,
      attendanceVectors: result.attendanceVectors,
      billingImport: result.billingImport ? {
        invoicesCreated: result.billingImport.invoicesCreated,
        skipped: result.billingImport.skipped,
        noAttendance: result.billingImport.noAttendance,
        errors: result.billingImport.errors,
      } : null,
      errors: result.errors,
    }, null, 2));
  } else if (command === 'generate') {
    console.log('生成收費單（含 FLAG 同步）...');
    const result = await generateAllInvoices();
    console.log(`\n=== 結果 ===`);
    console.log(`FLAG 同步: ${result.billingSync ? `建立 ${result.billingSync.invoicesCreated}, 跳過 ${result.billingSync.skipped}` : '略過'}`);
    console.log(`新收費單: ${result.generated.length} 張`);
    console.log(`未滿期跳過: ${result.skipped}`);
    for (const g of result.generated) {
      console.log(`  ${g.serialNumber} | $${g.billing?.totalFee} | ${g.billing?.sessionInfoText}`);
    }
  } else if (command === 'audit') {
    console.log('🔍 開始交互檢核...\n');
    const result = await runAudit();
    console.log('\n========================================');
    if (result.syncSummary.allPass && result.internalSummary.allPass) {
      console.log('✅ 全部檢核通過！DB 與 Sheets 一致，內部數據自洽。');
    } else {
      const issues: string[] = [];
      if (!result.syncSummary.allPass) issues.push(`同步不一致 ${result.syncSummary.countMismatch + result.syncSummary.flagMismatch + result.syncSummary.amountMismatch} 項`);
      if (!result.internalSummary.allPass) issues.push(`內部檢核失敗 ${result.internalSummary.check1Fail + result.internalSummary.check2Fail + result.internalSummary.check3Fail + result.internalSummary.check4Fail} 項`);
      console.log(`⚠️ 有問題需要處理：${issues.join('、')}`);
    }
  } else {
    console.log('用法:');
    console.log('  npx tsx scripts/run-sync.ts sync       # Sheets → DB 全同步');
    console.log('  npx tsx scripts/run-sync.ts generate    # 生成收費單記錄');
    console.log('  npx tsx scripts/run-sync.ts audit       # 交互檢核（DB ↔ Sheets + 內部驗算）');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
