/**
 * 檢查 generated_invoices_latex/ 中 PDF 對應的 DB invoices 狀態
 * 並列出需要回寫到 Sheet 計費日期表的資料
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. List PDF files
  const pdfDir = path.join(process.cwd(), 'generated_invoices_latex');
  const pdfs = fs.readdirSync(pdfDir)
    .filter(f => f.endsWith('.pdf') && !f.includes('test'))
    .sort();

  console.log(`\n📁 PDF 檔案: ${pdfs.length} 個\n`);

  // Extract sheetsIds from filenames like "543_N_20260315.pdf"
  const pdfSheetsIds = pdfs.map(f => f.split('_')[0]);

  // 2. Query DB for these students' draft invoices with pdf_path
  const invoices: any[] = await prisma.$queryRaw`
    SELECT i.id, i.serial_number, i.start_date::text, i.end_date::text,
           i.amount, i.status, i.pdf_path, i.total_y,
           e.sheets_id, e.class_code, p.name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id = ANY(${pdfSheetsIds})
    AND i.status = 'draft'
    AND i.pdf_path IS NOT NULL
    ORDER BY e.sheets_id::int, i.start_date
  `;

  console.log(`📋 DB 中有 PDF 的 draft invoices: ${invoices.length} 筆\n`);
  console.log('─'.repeat(110));
  console.log(
    'ID'.padStart(4) + '  ' +
    'SheetsID'.padEnd(8) + '  ' +
    '姓名'.padEnd(8) + '  ' +
    'Class'.padEnd(5) + '  ' +
    'Start Date'.padEnd(12) + '  ' +
    'End Date'.padEnd(12) + '  ' +
    'Amount'.padStart(6) + '  ' +
    'TotalY'.padStart(6) + '  ' +
    'Status'.padEnd(7) + '  ' +
    'Serial'
  );
  console.log('─'.repeat(110));

  for (const inv of invoices) {
    console.log(
      String(inv.id).padStart(4) + '  ' +
      inv.sheets_id.padEnd(8) + '  ' +
      inv.name.padEnd(8) + '  ' +
      inv.class_code.padEnd(5) + '  ' +
      inv.start_date.padEnd(12) + '  ' +
      inv.end_date.padEnd(12) + '  ' +
      String(inv.amount).padStart(6) + '  ' +
      String(inv.total_y).padStart(6) + '  ' +
      inv.status.padEnd(7) + '  ' +
      inv.serial_number
    );
  }

  // 3. Also check if there are draft invoices WITHOUT pdf for these students
  const noPdf: any[] = await prisma.$queryRaw`
    SELECT i.id, e.sheets_id, p.name, i.start_date::text, i.end_date::text, i.amount, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id = ANY(${pdfSheetsIds})
    AND i.status = 'draft'
    AND i.pdf_path IS NULL
    ORDER BY e.sheets_id::int
  `;

  if (noPdf.length > 0) {
    console.log(`\n⚠️ 同學生還有 ${noPdf.length} 筆 draft 但無 PDF:`);
    for (const inv of noPdf) {
      console.log(`  ID ${inv.sheets_id} ${inv.name} ${inv.start_date} ~ ${inv.end_date} $${inv.amount}`);
    }
  }

  // 4. Check what's currently in Sheet 計費日期表 for these students
  console.log('\n\n📊 需回寫到 Sheet 計費日期表 的資料:');
  console.log('─'.repeat(80));
  for (const inv of invoices) {
    const startDate = new Date(inv.start_date);
    const endDate = new Date(inv.end_date);
    // Excel serial number
    const startSerial = Math.round((startDate.getTime() / 86400000) + 25569);
    const endSerial = Math.round((endDate.getTime() / 86400000) + 25569);
    console.log(
      `  ID ${inv.sheets_id} ${inv.name}: ` +
      `start=${inv.start_date} (${startSerial}), end=${inv.end_date} (${endSerial})`
    );
  }

  await prisma.$disconnect();
}

main().catch(console.error);
