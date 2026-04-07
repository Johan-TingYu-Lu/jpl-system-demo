import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const ids = ['558','561','590','606','612','626','633','634','637','641','648','649','652','661','676','677']

async function main() {
  // For each student: get last invoice end_date, then count attendance AFTER that date
  const { rows } = await pool.query(`
    WITH last_inv AS (
      SELECT e.sheets_id, e.id as eid, p.name, e.class_code,
             MAX(i.end_date) as last_end,
             COUNT(i.id)::int as inv_count
      FROM enrollments e
      JOIN persons p ON e.person_id=p.id
      LEFT JOIN invoices i ON i.enrollment_id=e.id AND i.serial_number LIKE '26-%'
      WHERE e.sheets_id = ANY($1)
      GROUP BY e.sheets_id, e.id, p.name, e.class_code
    ),
    attendance_after AS (
      SELECT li.sheets_id, li.name, li.class_code, li.inv_count,
             li.last_end::text as last_end,
             ma.year, ma.month, ma.days
      FROM last_inv li
      LEFT JOIN monthly_attendance ma ON ma.enrollment_id=li.eid
      WHERE ma.year IS NOT NULL
    )
    SELECT sheets_id, name, class_code, inv_count, last_end,
           json_agg(json_build_object('y', year, 'm', month, 'v', days) ORDER BY year, month) as months
    FROM attendance_after
    GROUP BY sheets_id, name, class_code, inv_count, last_end
    ORDER BY sheets_id::int
  `, [ids])

  console.log('ID\t姓名\t\t班級\t已開單\t最後結束日\t結束後出席Y數\t可開單?')
  console.log('---\t----\t\t----\t------\t----------\t------------\t-------')

  for (const r of rows) {
    const lastEnd = r.last_end ? new Date(r.last_end) : null
    const months = r.months as {y: number, m: number, v: number[]}[]

    // Count billable attendance after lastEnd
    let yCount = 0
    for (const mo of months) {
      for (let day = 0; day < mo.v.length; day++) {
        const code = mo.v[day]
        if (code !== 2 && code !== 3) continue
        const d = new Date(Date.UTC(mo.y, mo.m - 1, day + 1))
        if (lastEnd && d <= lastEnd) continue
        yCount += code === 3 ? 2 : 1
      }
    }

    const nm = r.name.length >= 4 ? r.name + '\t' : r.name + '\t\t'
    const canGen = yCount >= 10 ? '✓ YES' : `✗ (${yCount}/10)`
    console.log(`${r.sheets_id}\t${nm}${r.class_code}\t${r.inv_count}\t${r.last_end}\t${yCount}Y\t\t${canGen}`)
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
