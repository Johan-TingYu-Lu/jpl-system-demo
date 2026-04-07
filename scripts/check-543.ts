import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check 543 status
  const rows: any[] = await prisma.$queryRaw`
    SELECT i.id, i.serial_number, i.start_date::text, i.end_date::text,
           i.amount, i.status, i.pdf_path, e.sheets_id, p.name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id = '543'
    ORDER BY i.start_date
  `;
  console.log('543 invoices:');
  for (const r of rows) {
    console.log(`  ${r.serial_number} ${r.start_date} ~ ${r.end_date} $${r.amount} [${r.status}] pdf=${r.pdf_path ? 'YES' : 'NO'}`);
  }

  // Also check: which PDF filenames exist but DON'T have draft invoices?
  const fs = await import('fs');
  const path = await import('path');
  const pdfDir = path.join(process.cwd(), 'generated_invoices_latex');
  const pdfs = fs.readdirSync(pdfDir).filter((f: string) => f.endsWith('.pdf') && !f.includes('test'));
  const pdfIds = [...new Set(pdfs.map((f: string) => f.split('_')[0]))];
  console.log('\nPDF sheetsIds:', pdfIds.join(', '));

  // Check all draft invoices
  const allDrafts: any[] = await prisma.$queryRaw`
    SELECT e.sheets_id, p.name, i.status, i.pdf_path IS NOT NULL as has_pdf,
           i.start_date::text, i.end_date::text
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.status = 'draft'
    ORDER BY e.sheets_id::int
  `;
  console.log(`\nAll draft invoices: ${allDrafts.length}`);
  for (const r of allDrafts) {
    const flag = r.has_pdf ? '📄' : '⬜';
    console.log(`  ${flag} ${r.sheets_id.padStart(3)} ${r.name.padEnd(8)} ${r.start_date} ~ ${r.end_date}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
