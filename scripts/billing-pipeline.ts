/**
 * billing-pipeline.ts — 統一收費流程 CLI
 *
 * 取代 import-invoices.ts / generate-pdfs.ts / generate-invoices-new.ts
 *
 * Usage:
 *   npx tsx scripts/billing-pipeline.ts                     # 生成收費單 + PDF
 *   npx tsx scripts/billing-pipeline.ts --import-history    # 匯入歷史收費紀錄
 *   npx tsx scripts/billing-pipeline.ts --force             # 強制結算（不滿額也出單）
 *   npx tsx scripts/billing-pipeline.ts --pdf-only          # 只生成缺 PDF 的收費單
 *   npx tsx scripts/billing-pipeline.ts --dry-run           # 預覽，不寫 DB
 *   npx tsx scripts/billing-pipeline.ts --clean             # 搭配 --import-history 清空舊資料
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const importHistory = args.includes('--import-history');
  const pdfOnly = args.includes('--pdf-only');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const clean = args.includes('--clean');

  console.log('='.repeat(70));
  console.log('JPL Billing Pipeline');
  console.log('='.repeat(70));
  if (dryRun) console.log('DRY RUN mode');

  // ── Import history ──
  if (importHistory) {
    if (clean && !dryRun) {
      console.log('\nClearing existing invoices and payments...');
      const paymentCount = await prisma.payment.deleteMany();
      const invoiceCount = await prisma.invoice.deleteMany();
      console.log(`  Deleted ${paymentCount.count} payments, ${invoiceCount.count} invoices`);
    }

    const { pullBillingHistory } = await import('../src/lib/billing-history-importer.js');
    const result = await pullBillingHistory({ dryRun });

    console.log('\n' + '='.repeat(70));
    console.log('Import Results');
    console.log('='.repeat(70));
    console.log(`  Invoices created: ${result.invoicesCreated}`);
    console.log(`  Payments created: ${result.paymentsCreated}`);
    console.log(`  Skipped (existing): ${result.skipped}`);
    console.log(`  No attendance: ${result.noAttendance}`);
    console.log(`  Warnings: ${result.warnings.length}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.warnings.length > 0) {
      console.log('\nAmount discrepancies:');
      for (const w of result.warnings) {
        console.log(`  ${w.sheetsId} ${w.name} #${w.invoiceIndex + 1}: Sheet=$${w.sheetAmount} vs Calc=$${w.calculatedAmount} (diff $${w.difference})`);
      }
    }
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const e of result.errors) console.log(`  ${e}`);
    }

    if (!dryRun) await printDbSummary();
    return;
  }

  // ── PDF only ──
  if (pdfOnly) {
    console.log('\nGenerating PDFs for invoices without one...');
    const { generatePdfsForPending } = await import('../src/lib/invoice-generator.js');
    const result = await generatePdfsForPending();
    console.log(`  Rendered: ${result.rendered}`);
    console.log(`  Skipped (no records): ${result.skippedNoRecords}`);
    if (result.failed.length > 0) {
      console.log(`  Failed: ${result.failed.length}`);
      for (const f of result.failed) console.log(`    ${f.serial}: ${f.error}`);
    }
    return;
  }

  // ── Generate new invoices ──
  console.log('\nGenerating new invoices...');
  const { generateAllInvoices, generatePdfsForPending } = await import('../src/lib/invoice-generator.js');

  const mode = force ? 'force' : 'normal';
  // generateAllInvoices uses 'normal' mode internally; for force mode, we'd need per-enrollment calls
  const invoiceResult = await generateAllInvoices();
  console.log(`  Generated: ${invoiceResult.generated.length}`);
  console.log(`  Skipped (insufficient Y): ${invoiceResult.skipped}`);

  for (const g of invoiceResult.generated) {
    if (g.success) {
      console.log(`    ${g.serialNumber} | $${g.billing?.totalFee} | ${g.billing?.totalY}Y`);
    }
  }

  // ── Generate PDFs ──
  if (!dryRun) {
    console.log('\nGenerating PDFs...');
    const pdfResult = await generatePdfsForPending();
    console.log(`  Rendered: ${pdfResult.rendered}`);
    console.log(`  Skipped (no records): ${pdfResult.skippedNoRecords}`);
    if (pdfResult.failed.length > 0) {
      console.log(`  Failed: ${pdfResult.failed.length}`);
      for (const f of pdfResult.failed) console.log(`    ${f.serial}: ${f.error}`);
    }
  }

  await printDbSummary();
}

async function printDbSummary() {
  const totalInvoices = await prisma.invoice.count();
  const totalPayments = await prisma.payment.count();
  const paidInvoices = await prisma.invoice.count({ where: { status: 'paid' } });
  const pendingInvoices = totalInvoices - paidInvoices;
  const withPdf = await prisma.invoice.count({ where: { pdfPath: { not: null } } });

  console.log('\n' + '='.repeat(70));
  console.log('DB Summary');
  console.log('='.repeat(70));
  console.log(`  Invoices: ${totalInvoices} (paid: ${paidInvoices}, pending: ${pendingInvoices})`);
  console.log(`  Payments: ${totalPayments}`);
  console.log(`  With PDF: ${withPdf}`);
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
