import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  // Get all 114-year invoices with their sequences
  const { rows } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_name, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, i.status
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.start_date
  `)

  // Group by student
  const byStudent = new Map<string, any[]>()
  for (const r of rows) {
    if (!byStudent.has(r.sheets_id)) byStudent.set(r.sheets_id, [])
    byStudent.get(r.sheets_id)!.push(r)
  }

  // Find gaps
  let gapCount = 0
  const gapStudents: any[] = []

  for (const [sid, invs] of byStudent) {
    const seqs = invs.map((inv: any) => {
      const parts = inv.serial_number.split('-')
      const lastPart = parts[parts.length - 1]
      return parseInt(lastPart) || 0
    })
    const maxSeq = Math.max(...seqs)
    const count = invs.length

    if (maxSeq > count) {
      const missing = []
      for (let i = 1; i <= maxSeq; i++) {
        if (!seqs.includes(i)) missing.push(i)
      }
      gapStudents.push({
        sid,
        name: invs[0].name,
        cls: invs[0].class_name,
        count,
        maxSeq,
        missing,
        lastInv: invs[invs.length - 1]
      })
      gapCount++
    }
  }

  console.log(`跟 558 相同問題（序號跳號）: ${gapStudents.length} 位\n`)
  for (const s of gapStudents) {
    console.log(`${s.sid} ${s.name} (${s.cls}): ${s.count}筆, 最大seq=${s.maxSeq}, 缺=[${s.missing.join(',')}], 最新=${s.lastInv.serial_number} ${s.lastInv.sd}~${s.lastInv.ed}`)
  }

  await pool.end()
}
main().catch(e => console.error(e.message))
