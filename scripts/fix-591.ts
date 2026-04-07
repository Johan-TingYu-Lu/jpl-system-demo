import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. Fix invoice 04's end_date to match Sheet (2026/01/25)
  const { rowCount: updated } = await client.query(`
    UPDATE invoices SET end_date = '2026-01-25'
    WHERE serial_number = '26-591-12-M-04'
  `);
  console.log(`1. 修正 26-591-12-M-04 end_date → 2026-01-25 (${updated} row)`);

  // 2. Get draft invoice info for cleanup
  const { rows: drafts } = await client.query(`
    SELECT i.id, i.serial_number, i.pdf_path
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = '591' AND i.status = 'draft'
  `);

  for (const d of drafts) {
    // Delete PDF file if exists
    if (d.pdf_path && fs.existsSync(d.pdf_path)) {
      fs.unlinkSync(d.pdf_path);
      console.log(`2. 刪除 PDF: ${d.pdf_path}`);
    }
    // Delete .tex file too
    const texPath = d.pdf_path?.replace('.pdf', '.tex');
    if (texPath && fs.existsSync(texPath)) {
      fs.unlinkSync(texPath);
    }

    // Delete invoice record
    await client.query('DELETE FROM audit_log WHERE record_id = $1 AND table_name = $2', [d.id, 'invoices']);
    await client.query('DELETE FROM invoices WHERE id = $1', [d.id]);
    console.log(`3. 刪除 draft invoice: ${d.serial_number} (id=${d.id})`);
  }

  // 3. Verify
  const { rows: verify } = await client.query(`
    SELECT i.serial_number, i.end_date, i.status
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
    WHERE e.sheets_id = '591'
    ORDER BY i.end_date DESC LIMIT 1
  `);
  console.log(`\n✅ 修正後 FLAG: ${verify[0]?.end_date?.toISOString().slice(0,10)} (${verify[0]?.serial_number})`);

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
