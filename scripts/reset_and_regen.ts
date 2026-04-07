import * as dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const ids = [3982, 3983, 3984, 3985, 3986, 3987, 3988];
  const r = await c.query(
    "UPDATE invoices SET pdf_path = NULL WHERE id = ANY($1::int[]) RETURNING id, serial_number",
    [ids]
  );
  console.log('Reset pdf_path for:');
  for (const row of r.rows) {
    console.log(`  ${row.id} ${row.serial_number}`);
  }
  console.log(`Total: ${r.rowCount}`);

  await c.end();
}
main();
