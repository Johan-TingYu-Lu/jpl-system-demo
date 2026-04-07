import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(
    "SELECT i.id, i.serial_number, i.amount, i.status, i.start_date::text as sd, i.end_date::text as ed, i.paid_date::text as pd, e.sheets_id FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id WHERE e.sheets_id IN ('685','686') AND i.serial_number LIKE '26-%' ORDER BY e.sheets_id::int, i.serial_number"
  );
  console.log('SID\t序號\t\t\t金額\t狀態\t起始日\t\t結束日\t\t銷帳日');
  for (const r of rows) {
    console.log(`${r.sheets_id}\t${r.serial_number}\t${r.amount}\t${r.status}\t${r.sd}\t${r.ed}\t${r.pd || '—'}`);
  }
  await pool.end();
}
main().catch(e => console.error(e.message));
