import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId
const ids = ['558','561','590','606','612','626','633','634','637','641','648','649','652','661','676','677']

function serialToDate(serial: number): string {
  const d = new Date((serial - 25569) * 86400000 + 12 * 3600000)
  return d.toISOString().slice(0, 10)
}

async function main() {
  // Read Sheet 計費日期表
  const [billingRows, dbResult] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", sid),
    pool.query(`
      SELECT e.sheets_id, p.name, i.serial_number,
             i.start_date::text as sd, i.end_date::text as ed, i.status, i.amount
      FROM invoices i
      JOIN enrollments e ON i.enrollment_id=e.id
      JOIN persons p ON e.person_id=p.id
      WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
      ORDER BY e.sheets_id::int, i.serial_number
    `, [ids])
  ])

  const bilFmt = config.billingDate

  // Parse Sheet billing dates per student
  const sheetMap = new Map<string, { name: string, count: number, pairs: {start: string, end: string}[] }>()
  for (let r = 1; r < billingRows.length; r++) {
    const row = billingRows[r] as any[]
    const id = String(row[bilFmt.idCol] || '').trim()
    if (!ids.includes(id)) continue
    const name = String(row[bilFmt.nameCol] || '').trim()
    const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
    const pairs: {start: string, end: string}[] = []
    for (let i = 0; i < count; i++) {
      const sCol = bilFmt.datePairsStartCol + i * 2
      const eCol = sCol + 1
      const sVal = row[sCol]
      const eVal = row[eCol]
      const start = typeof sVal === 'number' && sVal > 0 ? serialToDate(sVal) : String(sVal || '?')
      const end = typeof eVal === 'number' && eVal > 0 ? serialToDate(eVal) : String(eVal || '?')
      pairs.push({ start, end })
    }
    sheetMap.set(id, { name, count, pairs })
  }

  // Group DB invoices per student
  const dbMap = new Map<string, { name: string, invoices: any[] }>()
  for (const r of dbResult.rows) {
    if (!dbMap.has(r.sheets_id)) dbMap.set(r.sheets_id, { name: r.name, invoices: [] })
    dbMap.get(r.sheets_id)!.invoices.push(r)
  }

  // Output comparison
  for (const id of ids) {
    const sheet = sheetMap.get(id)
    const db = dbMap.get(id)
    const name = sheet?.name || db?.name || '?'
    console.log(`\n========== ${id} ${name} ==========`)

    const maxLen = Math.max(sheet?.count || 0, db?.invoices.length || 0)
    console.log(`  #\tSheet起始\tSheet結束\tDB序號\t\t\tDB起始\t\tDB結束\t\t一致`)

    for (let i = 0; i < maxLen; i++) {
      const sp = sheet && i < sheet.pairs.length ? sheet.pairs[i] : null
      const di = db && i < db.invoices.length ? db.invoices[i] : null

      const ss = sp ? sp.start : '—'
      const se = sp ? sp.end : '—'
      const ds = di ? di.serial_number : '—'
      const dsd = di ? di.sd : '—'
      const ded = di ? di.ed : '—'

      const match = sp && di && sp.start === di.sd && sp.end === di.ed ? '✓' : '✗'
      console.log(`  ${i+1}\t${ss}\t${se}\t${ds}\t${dsd}\t${ded}\t${match}`)
    }
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
