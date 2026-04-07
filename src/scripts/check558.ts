import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
async function main() {
  const { rows } = await pool.query(
    "SELECT i.serial_number, i.start_date::text as sd, i.end_date::text as ed, i.status, i.created_at::text as ct FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id WHERE e.sheets_id='558' AND i.serial_number LIKE '26-%' ORDER BY i.start_date"
  )
  for (const r of rows) {
    const parts = r.serial_number.split('-')
    console.log(`${r.serial_number}  seq=${parts[4]}  ${r.sd} ~ ${r.ed}  ${r.status}  created=${r.ct?.slice(0,10)}`)
  }
  console.log(`total: ${rows.length}`)
  await pool.end()
}
main().catch(e => console.error(e.message))
