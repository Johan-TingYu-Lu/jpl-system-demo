import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  // Risk 1: NULL startDate
  const { rows: nullDates } = await pool.query(
    "SELECT id, serial_number, start_date, end_date FROM invoices WHERE serial_number LIKE '26-%' AND start_date IS NULL"
  )
  console.log(`Risk 1: startDate IS NULL → ${nullDates.length} 筆`)
  nullDates.forEach(r => console.log(`  ${r.serial_number}`))

  // Risk 2: Same enrollment + same startDate
  const { rows: dupes } = await pool.query(`
    SELECT e.sheets_id, i.start_date::text, COUNT(*)::int as cnt,
           array_agg(i.serial_number ORDER BY i.serial_number) as serials
    FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id
    WHERE i.serial_number LIKE '26-%'
    GROUP BY e.sheets_id, i.start_date
    HAVING COUNT(*) > 1
    ORDER BY e.sheets_id::int
  `)
  console.log(`\nRisk 2: 同 enrollment 同 startDate → ${dupes.length} 組`)
  dupes.forEach(r => console.log(`  ${r.sheets_id} ${r.start_date}: ${r.serials.join(', ')}`))

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
