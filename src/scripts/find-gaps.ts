import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const { rows } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_name,
           COUNT(*)::int as cnt,
           MAX(CASE WHEN SPLIT_PART(i.serial_number, '-', 5) ~ '^\d+$' THEN CAST(SPLIT_PART(i.serial_number, '-', 5) AS int) ELSE 0 END)::int as max_seq
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.serial_number LIKE '26-%'
    GROUP BY e.sheets_id, p.name, e.class_name
    HAVING MAX(CASE WHEN SPLIT_PART(i.serial_number, '-', 5) ~ '^\d+$' THEN CAST(SPLIT_PART(i.serial_number, '-', 5) AS int) ELSE 0 END) > COUNT(*)
    ORDER BY e.sheets_id::int
  `)

  console.log('跟 558 相同問題（序號有跳號 = 有 invoice 被刪過）：')
  console.log('')
  for (const r of rows) {
    const gap = r.max_seq - r.cnt
    console.log(`${r.sheets_id} ${r.name} (${r.class_name}): 實際=${r.cnt}筆, 最大序號=${r.max_seq}, 缺${gap}筆`)
  }
  console.log(`\n共 ${rows.length} 位`)

  await pool.end()
}

main().catch(e => console.error('ERR:', e.message))
