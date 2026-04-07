import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId

async function main() {
  // Parallel: read Sheet + DB all at once
  const [summaryRows, billingRows, dbResult] = await Promise.all([
    readSheet("'學費收支總表'!A:Q", sid),
    readSheet("'計費日期表'!A:D", sid),
    pool.query(`
      SELECT e.sheets_id, COUNT(*)::int as cnt,
             MAX(i.serial_number) as last_serial,
             MAX(i.status) as last_status,
             MAX(i.end_date)::text as last_end
      FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id
      WHERE i.serial_number LIKE '26-%'
      GROUP BY e.sheets_id
    `)
  ])

  // DB map: sheets_id -> { cnt, last_serial, last_end }
  const dbMap = new Map<string, any>()
  for (const r of dbResult.rows) {
    dbMap.set(r.sheets_id, r)
  }

  // Sheet billing map
  const bilFmt = config.billingDate
  const sheetBilMap = new Map<string, number>()
  for (let r = 1; r < billingRows.length; r++) {
    const row = billingRows[r] as any[]
    const id = String(row[bilFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
    sheetBilMap.set(id, count)
  }

  // Find 應製單數=1
  const pending: any[] = []
  for (let r = 1; r < summaryRows.length; r++) {
    const row = summaryRows[r] as any[]
    const id = String(row[0] || '').trim()
    const name = String(row[1] || '').trim()
    const cls = String(row[2] || '').trim()
    const shouldMake = String(row[15] || '').trim()
    if (shouldMake !== '1' || !/^\d+$/.test(id)) continue

    const sheetBil = sheetBilMap.get(id) ?? 0
    const sheetIssued = parseInt(String(row[10] || '0'))
    const sheetPaidCount = parseInt(String(row[11] || '0'))
    const db = dbMap.get(id)
    const dbCount = db ? db.cnt : 0
    const dbLast = db ? `${db.last_serial} ${db.last_end}` : '無'
    const match = dbCount === sheetBil ? '✓' : '✗'

    pending.push({ id, name, cls, sheetBil, dbCount, match, sheetIssued, sheetPaidCount, dbLast })
  }

  console.log(`Sheet 應製單數=1: ${pending.length} 位\n`)
  console.log('ID\t姓名\t\tSheet計費\tDB數量\t一致\tSheet已發\tSheet已繳\tDB最新')
  console.log('---\t----\t\t--------\t------\t----\t--------\t--------\t------')
  for (const p of pending) {
    const nm = p.name.length >= 4 ? p.name + '\t' : p.name + '\t\t'
    console.log(`${p.id}\t${nm}${p.sheetBil}\t\t${p.dbCount}\t${p.match}\t${p.sheetIssued}\t\t${p.sheetPaidCount}\t\t${p.dbLast}`)
  }

  // Categorize
  const alreadyInDb = pending.filter(p => p.match === '✓')
  const missingInDb = pending.filter(p => p.match === '✗')
  console.log(`\n=== 分析 ===`)
  console.log(`DB 數量 = Sheet 計費 (已生成，Sheet公式可能未更新): ${alreadyInDb.length} 位`)
  console.log(`DB 數量 < Sheet 計費 (真的缺): ${missingInDb.length} 位`)

  if (alreadyInDb.length > 0) {
    console.log('\n--- DB 已有但 Sheet 還顯示應製單=1 ---')
    for (const p of alreadyInDb) {
      console.log(`  ${p.id} ${p.name}: Sheet計費=${p.sheetBil} DB=${p.dbCount} | DB最新=${p.dbLast}`)
    }
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
