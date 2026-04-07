/**
 * Phase 2: 修正現有 invoice 的 +1 天日期偏移
 * 用 Sheet 計費日期表的日期覆蓋 DB 的 start_date / end_date
 */
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
  const billingRows = await readSheet("'計費日期表'!A:AZ", sid)
  const bilFmt = config.billingDate

  // Sheet periods
  const sheetMap = new Map<string, { startDate: string, endDate: string }[]>()
  for (let r = 1; r < billingRows.length; r++) {
    const row = billingRows[r] as any[]
    const id = String(row[bilFmt.idCol] || '').trim()
    if (!ids.includes(id)) continue
    const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
    const periods: { startDate: string, endDate: string }[] = []
    for (let i = 0; i < count; i++) {
      const sCol = bilFmt.datePairsStartCol + i * 2
      const eCol = sCol + 1
      const sRaw = Number(row[sCol] || 0)
      const eRaw = Number(row[eCol] || 0)
      periods.push({
        startDate: sRaw > 0 ? serialToDate(sRaw).toISOString().slice(0, 10) : '?',
        endDate: eRaw > 0 ? serialToDate(eRaw).toISOString().slice(0, 10) : '?',
      })
    }
    sheetMap.set(id, periods)
  }

  // DB invoices sorted by start_date
  const { rows: dbInvs } = await pool.query(
    "SELECT i.id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, e.sheets_id FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%' ORDER BY e.sheets_id::int, i.start_date",
    [ids]
  )

  let updated = 0
  let alreadyOk = 0

  for (const inv of dbInvs) {
    const periods = sheetMap.get(inv.sheets_id) || []
    // Find matching Sheet period by closest end date
    let bestIdx = -1
    let bestDiff = Infinity
    for (let i = 0; i < periods.length; i++) {
      if (periods[i].endDate === '?') continue
      const diff = Math.abs(new Date(inv.ed).getTime() - new Date(periods[i].endDate).getTime()) / 86400000
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    }

    if (bestIdx === -1 || bestDiff > 7) {
      console.log(`  ⚠ ${inv.sheets_id} ${inv.serial_number} 找不到匹配的 Sheet 期`)
      continue
    }

    const sp = periods[bestIdx]
    if (inv.sd === sp.startDate && inv.ed === sp.endDate) {
      alreadyOk++
      continue
    }

    await pool.query(
      "UPDATE invoices SET start_date=$1, end_date=$2 WHERE id=$3",
      [sp.startDate, sp.endDate, inv.id]
    )
    console.log(`  ✓ ${inv.sheets_id} ${inv.serial_number}: ${inv.sd}~${inv.ed} → ${sp.startDate}~${sp.endDate}`)
    updated++
  }

  console.log(`\nPhase 2 完成: 更新 ${updated} 筆, 已正確 ${alreadyOk} 筆`)
  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
