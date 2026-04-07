import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const ids = ['558','561','590','606','612','626','633','634','637','641','648','649','652','661','676','677']

async function main() {
  const { rows } = await pool.query(
    `SELECT i.id, i.serial_number, i.amount, i.status, i.end_date::text as ed, i.pdf_path, e.sheets_id
     FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id
     WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
     ORDER BY e.sheets_id::int, i.serial_number`,
    [ids]
  )

  const grouped = new Map<string, any[]>()
  for (const r of rows) {
    if (!grouped.has(r.sheets_id)) grouped.set(r.sheets_id, [])
    grouped.get(r.sheets_id)!.push(r)
  }

  const toDelete: any[] = []
  console.log('=== 要刪除的 invoice（每位最新一張）===')
  for (const [sid, invs] of grouped) {
    const last = invs[invs.length - 1]
    toDelete.push(last)
    const pdf = last.pdf_path ? 'Y' : 'N'
    console.log(`  ${sid}\t${last.serial_number}\t$${last.amount}\t${last.status}\t${last.ed}\tpdf=${pdf}`)
  }
  console.log(`\n共 ${toDelete.length} 筆`)

  const delIds = toDelete.map(r => r.id)

  // Check payments
  const { rows: pays } = await pool.query('SELECT id, invoice_id FROM payments WHERE invoice_id = ANY($1)', [delIds])
  console.log(`關聯 payment: ${pays.length} 筆`)

  if (process.argv.includes('--execute')) {
    // Delete payments first
    if (pays.length > 0) {
      const payIds = pays.map(p => p.id)
      await pool.query('DELETE FROM payments WHERE id = ANY($1)', [payIds])
      console.log(`已刪除 ${payIds.length} 筆 payment`)
    }
    // Delete invoices
    await pool.query('DELETE FROM invoices WHERE id = ANY($1)', [delIds])
    console.log(`已刪除 ${delIds.length} 筆 invoice`)
  } else {
    console.log('\n加 --execute 參數才會真正刪除')
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
