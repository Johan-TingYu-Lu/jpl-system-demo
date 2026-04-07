import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import { serialToDate } from '@/lib/attendance-utils'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId
const ids = ['558','561','590','606','612','626','633','634','637','641','648','649','652','661','676','677']

async function main() {
  const [billingRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", sid),
  ])
  const bilFmt = config.billingDate

  // DB: sorted by START DATE
  const { rows: dbInvs } = await pool.query(`
    SELECT e.sheets_id, p.name, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, i.status, i.amount, i.created_at::text as created
    FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id JOIN persons p ON e.person_id=p.id
    WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.start_date ASC
  `, [ids])

  const dbMap = new Map<string, any[]>()
  for (const inv of dbInvs) {
    if (!dbMap.has(inv.sheets_id)) dbMap.set(inv.sheets_id, [])
    dbMap.get(inv.sheets_id)!.push(inv)
  }

  console.log('=== 按日期排序比對 (DB sorted by start_date ASC) ===\n')

  for (const tid of ids) {
    // Sheet billing dates
    let sheetPeriods: { n: number, startDate: string, endDate: string }[] = []
    let name = ''
    for (let r = 1; r < billingRows.length; r++) {
      const row = billingRows[r] as any[]
      if (String(row[bilFmt.idCol] || '').trim() !== tid) continue
      name = String(row[bilFmt.nameCol] || '').trim()
      const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
      for (let i = 0; i < count; i++) {
        const startCol = bilFmt.datePairsStartCol + i * 2
        const endCol = startCol + 1
        const startRaw = Number(row[startCol] || 0)
        const endRaw = Number(row[endCol] || 0)
        const startDate = startRaw > 0 ? serialToDate(startRaw).toISOString().slice(0, 10) : '?'
        const endDate = endRaw > 0 ? serialToDate(endRaw).toISOString().slice(0, 10) : '?'
        sheetPeriods.push({ n: i + 1, startDate, endDate })
      }
      break
    }

    const dbInvList = dbMap.get(tid) || []
    const dbName = dbInvList[0]?.name || name

    console.log(`=== ${tid} ${dbName} | Sheet ${sheetPeriods.length} 期 | DB ${dbInvList.length} 筆 ===`)

    // Match by position (both sorted by date)
    const maxLen = Math.max(sheetPeriods.length, dbInvList.length)
    for (let i = 0; i < maxLen; i++) {
      const sp = sheetPeriods[i]
      const db = dbInvList[i]

      const sheetStr = sp ? `Sheet#${sp.n}: ${sp.startDate} ~ ${sp.endDate}` : '(Sheet 無)'
      const dbStr = db ? `DB: ${db.serial_number} ${db.sd} ~ ${db.ed} [${db.status}]` : '(DB 無)'

      let verdict = ''
      if (sp && db) {
        const sDiff = Math.round((new Date(db.sd).getTime() - new Date(sp.startDate).getTime()) / 86400000)
        const eDiff = Math.round((new Date(db.ed).getTime() - new Date(sp.endDate).getTime()) / 86400000)
        if (sDiff === 1 && eDiff === 1) verdict = '→ +1天偏移（可修）'
        else if (sDiff === 0 && eDiff === 0) verdict = '→ ✓ 完全一致'
        else verdict = `→ ✗ 起始差${sDiff}d 結束差${eDiff}d`
      } else if (sp && !db) {
        verdict = '→ ✗ DB 缺少此期'
      } else if (!sp && db) {
        verdict = `→ ✗ Sheet 無此期 (created ${db.created?.slice(0,10)})`
      }

      console.log(`  ${i + 1}. ${sheetStr}`)
      console.log(`     ${dbStr} ${verdict}`)
    }
    console.log('')
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
