/**
 * Phase 3: 用 Sheet 日期重建缺少的 invoice
 * 比對 Sheet 期數 vs DB 現有 invoice，找出缺的期數，用 Sheet 資料建立
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
  const [billingRows, feeRows, payRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", sid),
    readSheet("'繳費金額表'!A:AZ", sid),
    readSheet("'繳費日期表'!A:AZ", sid),
  ])
  const bilFmt = config.billingDate
  const feeFmt = config.feeAmount
  const payFmt = config.paymentDate

  // Build Sheet data maps
  const sheetData = new Map<string, {
    name: string,
    periods: { startDate: string, endDate: string }[],
    amounts: number[],
    payDates: (string | null)[]
  }>()

  for (const tid of ids) {
    let name = '', periods: any[] = [], amounts: number[] = [], payDates: (string|null)[] = []

    // Billing dates
    for (let r = 1; r < billingRows.length; r++) {
      const row = billingRows[r] as any[]
      if (String(row[bilFmt.idCol] || '').trim() !== tid) continue
      name = String(row[bilFmt.nameCol] || '').trim()
      const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
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
      break
    }

    // Fee amounts
    for (let r = 1; r < feeRows.length; r++) {
      const row = feeRows[r] as any[]
      if (String(row[feeFmt.idCol] || '').trim() !== tid) continue
      const count = parseInt(String(row[feeFmt.countCol] || '0'))
      for (let i = 0; i < count; i++) {
        amounts.push(Number(row[feeFmt.amountsStartCol + i] || 0))
      }
      break
    }

    // Payment dates
    for (let r = 1; r < payRows.length; r++) {
      const row = payRows[r] as any[]
      if (String(row[payFmt.idCol] || '').trim() !== tid) continue
      const count = parseInt(String(row[payFmt.countCol] || '0'))
      for (let i = 0; i < count; i++) {
        const val = row[payFmt.datesStartCol + i]
        if (typeof val === 'number' && val > 0) {
          payDates.push(serialToDate(val).toISOString().slice(0, 10))
        } else {
          payDates.push(null)
        }
      }
      break
    }

    sheetData.set(tid, { name, periods, amounts, payDates })
  }

  // DB current invoices
  const { rows: dbInvs } = await pool.query(
    "SELECT i.id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed, e.sheets_id, e.id as enrollment_id, e.class_code FROM invoices i JOIN enrollments e ON i.enrollment_id=e.id WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%' ORDER BY e.sheets_id::int, i.start_date",
    [ids]
  )

  const dbBySid = new Map<string, any[]>()
  for (const inv of dbInvs) {
    if (!dbBySid.has(inv.sheets_id)) dbBySid.set(inv.sheets_id, [])
    dbBySid.get(inv.sheets_id)!.push(inv)
  }

  // Get enrollment IDs
  const { rows: enrollments } = await pool.query(
    "SELECT id, sheets_id, class_code FROM enrollments WHERE sheets_id = ANY($1)",
    [ids]
  )
  const enrollMap = new Map<string, { id: number, classCode: string }>()
  for (const e of enrollments) enrollMap.set(e.sheets_id, { id: e.id, classCode: e.class_code })

  let created = 0

  for (const tid of ids) {
    const sheet = sheetData.get(tid)!
    const dbList = dbBySid.get(tid) || []
    const enroll = enrollMap.get(tid)
    if (!enroll) { console.log(`  ⚠ ${tid} 沒有 enrollment`); continue }

    // Find which Sheet periods have NO matching DB invoice
    const matchedSheetIdx = new Set<number>()
    for (const db of dbList) {
      for (let si = 0; si < sheet.periods.length; si++) {
        if (matchedSheetIdx.has(si)) continue
        const diff = Math.abs(new Date(db.ed).getTime() - new Date(sheet.periods[si].endDate).getTime()) / 86400000
        if (diff <= 2) { matchedSheetIdx.add(si); break }
      }
    }

    const missing = []
    for (let si = 0; si < sheet.periods.length; si++) {
      if (!matchedSheetIdx.has(si)) missing.push(si)
    }

    if (missing.length === 0) continue

    console.log(`\n--- ${tid} ${sheet.name}: 缺 ${missing.length} 期 ---`)

    for (const si of missing) {
      const period = sheet.periods[si]
      const amount = sheet.amounts[si] || 4000
      const payDate = sheet.payDates[si] || null
      const status = payDate ? 'paid' : 'draft'
      const seqNum = si + 1
      const month = period.startDate.slice(5, 7)
      const serial = `26-${tid}-${month}-${enroll.classCode}-${String(seqNum).padStart(2, '0')}`

      // Check if serial already exists
      const { rows: existing } = await pool.query("SELECT id FROM invoices WHERE serial_number=$1", [serial])
      if (existing.length > 0) {
        console.log(`  ⚠ ${serial} 已存在，跳過`)
        continue
      }

      // Create invoice
      const hashCode = `rebuild-${serial}`
      const { rows: [newInv] } = await pool.query(
        `INSERT INTO invoices (enrollment_id, serial_number, hash_code, amount, status, start_date, end_date, paid_date, yy_count, y_count, total_y, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, NOW()) RETURNING id`,
        [enroll.id, serial, hashCode, amount, status, period.startDate, period.endDate, payDate]
      )

      // Create payment if paid
      if (status === 'paid' && payDate) {
        await pool.query(
          `INSERT INTO payments (enrollment_id, invoice_id, amount, payment_date, method, created_at)
           VALUES ($1, $2, $3, $4, 'historical_rebuild', NOW())`,
          [enroll.id, newInv.id, amount, payDate]
        )
      }

      console.log(`  + ${serial} $${amount} ${status} ${period.startDate}~${period.endDate} ${payDate ? '繳=' + payDate : ''}`)
      created++
    }
  }

  console.log(`\nPhase 3 完成: 新增 ${created} 筆 invoice`)
  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
