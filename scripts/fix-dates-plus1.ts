/**
 * fix-dates-plus1.ts — 修正所有 invoice + payment 日期 +1 天
 *
 * 根因：serialToDate() 過去產生 UTC midnight Date，
 * 存入 PostgreSQL 時被解釋為前一天（UTC+8 環境）。
 *
 * 用法：
 *   npx tsx scripts/fix-dates-plus1.ts          # dry run
 *   npx tsx scripts/fix-dates-plus1.ts --apply   # 實際執行
 */
import 'dotenv/config';
import pg from 'pg';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  if (dryRun) {
    console.log('=== DRY RUN（加 --apply 實際執行） ===\n');
  } else {
    console.log('=== 實際執行 ===\n');
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1. 修正 invoices 的 start_date 和 end_date
  const { rows: invoices } = await client.query(`
    SELECT id, start_date, end_date FROM invoices ORDER BY id
  `);
  console.log(`invoices 總數: ${invoices.length}`);

  if (dryRun) {
    // 抽樣顯示
    console.log('前 5 筆修正預覽:');
    for (const inv of invoices.slice(0, 5)) {
      const oldSd = inv.start_date.toISOString().slice(0, 10);
      const oldEd = inv.end_date.toISOString().slice(0, 10);
      const newSd = new Date(inv.start_date.getTime() + 86400000).toISOString().slice(0, 10);
      const newEd = new Date(inv.end_date.getTime() + 86400000).toISOString().slice(0, 10);
      console.log(`  id=${inv.id}: ${oldSd}→${newSd} ~ ${oldEd}→${newEd}`);
    }
  } else {
    // 用一條 SQL 批次更新
    const result = await client.query(`
      UPDATE invoices
      SET start_date = start_date + interval '1 day',
          end_date = end_date + interval '1 day'
    `);
    console.log(`  invoices 已更新: ${result.rowCount} 筆`);
  }

  // 2. 修正 payments 的 payment_date
  const { rows: payments } = await client.query(`
    SELECT id, payment_date FROM payments WHERE payment_date IS NOT NULL ORDER BY id
  `);
  console.log(`\npayments 總數: ${payments.length}`);

  if (dryRun) {
    console.log('前 5 筆修正預覽:');
    for (const p of payments.slice(0, 5)) {
      const oldPd = p.payment_date.toISOString().slice(0, 10);
      const newPd = new Date(p.payment_date.getTime() + 86400000).toISOString().slice(0, 10);
      console.log(`  id=${p.id}: ${oldPd}→${newPd}`);
    }
  } else {
    const result = await client.query(`
      UPDATE payments
      SET payment_date = payment_date + interval '1 day'
      WHERE payment_date IS NOT NULL
    `);
    console.log(`  payments 已更新: ${result.rowCount} 筆`);
  }

  // 3. 修正 semester_fees 的 fee_date
  const { rows: fees } = await client.query(`
    SELECT id, fee_date FROM semester_fees WHERE fee_date IS NOT NULL ORDER BY id
  `);
  console.log(`\nsemester_fees 總數: ${fees.length}`);

  if (dryRun) {
    console.log('前 5 筆修正預覽:');
    for (const f of fees.slice(0, 5)) {
      const oldFd = f.fee_date.toISOString().slice(0, 10);
      const newFd = new Date(f.fee_date.getTime() + 86400000).toISOString().slice(0, 10);
      console.log(`  id=${f.id}: ${oldFd}→${newFd}`);
    }
  } else {
    const result = await client.query(`
      UPDATE semester_fees
      SET fee_date = fee_date + interval '1 day'
      WHERE fee_date IS NOT NULL
    `);
    console.log(`  semester_fees 已更新: ${result.rowCount} 筆`);
  }

  if (dryRun) {
    console.log('\n--- 以上為預覽，加 --apply 實際執行 ---');
  } else {
    console.log('\n✅ 全部完成');
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
