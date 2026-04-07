import * as dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query("SELECT id, pdf_path, status FROM invoices WHERE id IN (3982,3983,3984,3985,3986,3987,3988)");
  for (const row of r.rows) {
    console.log(row.id, row.status, row.pdf_path || 'NULL');
  }
  await c.end();
}
main();
