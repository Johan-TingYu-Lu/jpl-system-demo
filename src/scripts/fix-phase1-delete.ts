/**
 * Phase 1: 找出並刪除 billing engine 錯誤生成的 invoice
 * 邏輯：每位學生的 DB invoice 按 start_date 排序，跟 Sheet 計費期間逐一比對
 *       結束日差距 > 7 天的視為「錯位」，刪除
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

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const billingRows = await readSheet("'計費日期表'!A:AZ", sid)
  const bilFmt = config.billingDate

  // Sheet periods per student
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
    "SELECT i.id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, i.status, i.amount, e.sheets_id, p.name FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id JOIN persons p ON e.person_id=p.id WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%' ORDER BY e.sheets_id::int, i.start_date",
    [ids]
  )

  const dbBySid = new Map<string, any[]>()
  for (const inv of dbInvs) {
    if (!dbBySid.has(inv.sheets_id)) dbBySid.set(inv.sheets_id, [])
    dbBySid.get(inv.sheets_id)!.push(inv)
  }

  const toDelete: { id: number, serial: string, sid: string, name: string, sd: string, ed: string, reason: string }[] = []
  const toKeep: { id: number, serial: string, sid: string, sheetIdx: number, sheetEnd: string, dbEnd: string }[] = []

  for (const tid of ids) {
    const sheetPeriods = sheetMap.get(tid) || []
    const dbList = dbBySid.get(tid) || []

    console.log(`\n--- ${tid} ${dbList[0]?.name || '?'} | Sheet ${sheetPeriods.length} 期 | DB ${dbList.length} 筆 ---`)

    // Match each DB invoice to closest Sheet period by end date
    for (let di = 0; di < dbList.length; di++) {
      const db = dbList[di]
      const dbEnd = new Date(db.ed).getTime()

      // Find best matching Sheet period
      let bestIdx = -1
      let bestDiff = Infinity
      for (let si = 0; si < sheetPeriods.length; si++) {
        const sp = sheetPeriods[si]
        if (sp.endDate === '?') continue
        const diff = Math.abs(dbEnd - new Date(sp.endDate).getTime()) / 86400000
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = si
        }
      }

      if (bestDiff <= 7) {
        console.log(`  ✓ ${db.serial_number} ${db.sd}~${db.ed} → Sheet#${bestIdx + 1} (差${Math.round(bestDiff)}天)`)
        toKeep.push({ id: db.id, serial: db.serial_number, sid: tid, sheetIdx: bestIdx, sheetEnd: sheetPeriods[bestIdx].endDate, dbEnd: db.ed })
      } else {
        console.log(`  ✗ ${db.serial_number} ${db.sd}~${db.ed} → 最近Sheet#${bestIdx + 1}差${Math.round(bestDiff)}天 → 刪除`)
        toDelete.push({ id: db.id, serial: db.serial_number, sid: tid, name: db.name, sd: db.sd, ed: db.ed, reason: `離Sheet最近期差${Math.round(bestDiff)}天` })
      }
    }
  }

  console.log(`\n========================================`)
  console.log(`保留: ${toKeep.length} 筆`)
  console.log(`刪除: ${toDelete.length} 筆`)
  console.log(`========================================`)

  if (toDelete.length > 0) {
    console.log('\n要刪除的 invoice:')
    for (const d of toDelete) {
      console.log(`  ${d.sid} ${d.name} | ${d.serial} | ${d.sd}~${d.ed} | ${d.reason}`)
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 不執行刪除')
  } else {
    const delIds = toDelete.map(d => d.id)
    if (delIds.length > 0) {
      // Delete payments first
      const payResult = await pool.query('DELETE FROM payments WHERE invoice_id = ANY($1)', [delIds])
      console.log(`\n刪除 payment: ${payResult.rowCount} 筆`)
      // Delete invoices
      const invResult = await pool.query('DELETE FROM invoices WHERE id = ANY($1)', [delIds])
      console.log(`刪除 invoice: ${invResult.rowCount} 筆`)
    }
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
