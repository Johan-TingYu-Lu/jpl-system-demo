import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import { serialToDate } from '@/lib/attendance-utils'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId
const ids = ['479','558','561','590','606','612','626','633','634','637','641','648','649','652','661','665','676','677','685']

async function main() {
  const [summaryRows, billingRows] = await Promise.all([
    readSheet("'學費收支總表'!A:Q", sid),
    readSheet("'計費日期表'!A:AZ", sid),
  ])
  const bilFmt = config.billingDate

  // DB: all invoices for these students
  const { rows: dbInvs } = await pool.query(`
    SELECT e.sheets_id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, i.status, i.amount
    FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id
    WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.serial_number
  `, [ids])

  const dbMap = new Map<string, any[]>()
  for (const inv of dbInvs) {
    if (!dbMap.has(inv.sheets_id)) dbMap.set(inv.sheets_id, [])
    dbMap.get(inv.sheets_id)!.push(inv)
  }

  // Output per student
  for (const tid of ids) {
    // Sheet summary
    let shouldMake = '?'
    let name = '?'
    for (let r = 1; r < summaryRows.length; r++) {
      if (String(summaryRows[r][0] || '').trim() === tid) {
        name = String(summaryRows[r][1] || '').trim()
        shouldMake = String(summaryRows[r][15] || '0').trim()
        break
      }
    }

    // Sheet billing dates
    let sheetPeriods: { n: number, startRaw: number, startDate: string, endRaw: number, endDate: string }[] = []
    for (let r = 1; r < billingRows.length; r++) {
      const row = billingRows[r] as any[]
      if (String(row[bilFmt.idCol] || '').trim() !== tid) continue
      const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
      for (let i = 0; i < count; i++) {
        const startCol = bilFmt.datePairsStartCol + i * 2
        const endCol = startCol + 1
        const startRaw = Number(row[startCol] || 0)
        const endRaw = Number(row[endCol] || 0)
        const startDate = startRaw > 0 ? serialToDate(startRaw).toISOString().slice(0, 10) : '?'
        const endDate = endRaw > 0 ? serialToDate(endRaw).toISOString().slice(0, 10) : '?'
        sheetPeriods.push({ n: i + 1, startRaw, startDate, endRaw, endDate })
      }
      break
    }

    const dbInvList = dbMap.get(tid) || []

    console.log(`\n=== ${tid} ${name} (應製單=${shouldMake}) ===`)
    console.log(`Sheet ${sheetPeriods.length} 期 | DB ${dbInvList.length} 筆`)

    const maxLen = Math.max(sheetPeriods.length, dbInvList.length)
    console.log('#\tSheet起始\tSheet結束\tDB序號\t\t\tDB起始\t\tDB結束\t\t起始差\t結束差')
    for (let i = 0; i < maxLen; i++) {
      const sp = sheetPeriods[i]
      const db = dbInvList[i]
      const sheetStart = sp ? sp.startDate : '—'
      const sheetEnd = sp ? sp.endDate : '—'
      const dbSerial = db ? db.serial_number : '—'
      const dbStart = db ? db.sd : '—'
      const dbEnd = db ? db.ed : '—'

      let startDiff = '—'
      let endDiff = '—'
      if (sp && db && sp.startDate !== '?' && db.sd) {
        const sDiff = (new Date(db.sd).getTime() - new Date(sp.startDate).getTime()) / 86400000
        startDiff = sDiff === 0 ? '✓' : `${sDiff > 0 ? '+' : ''}${sDiff}d`
      }
      if (sp && db && sp.endDate !== '?' && db.ed) {
        const eDiff = (new Date(db.ed).getTime() - new Date(sp.endDate).getTime()) / 86400000
        endDiff = eDiff === 0 ? '✓' : `${eDiff > 0 ? '+' : ''}${eDiff}d`
      }

      console.log(`${i + 1}\t${sheetStart}\t${sheetEnd}\t${dbSerial}\t${dbStart}\t${dbEnd}\t${startDiff}\t${endDiff}`)
    }
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
