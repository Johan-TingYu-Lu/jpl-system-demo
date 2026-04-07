import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const spreadsheetId = config.spreadsheetId
const ids = ['558','561','590','607','611','612','621','626']

async function main() {
  const [billingRows, payRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", spreadsheetId),
    readSheet("'繳費日期表'!A:AZ", spreadsheetId),
  ])
  const bilFmt = config.billingDate
  const payFmt = config.paymentDate

  console.log('=== Sheet 資料 ===')
  for (const tid of ids) {
    let bilRow: any[] | null = null
    let payRow: any[] | null = null
    for (let r = 1; r < billingRows.length; r++) {
      if (String(billingRows[r][bilFmt.idCol] || '').trim() === tid) { bilRow = billingRows[r] as any[]; break }
    }
    for (let r = 1; r < payRows.length; r++) {
      if (String(payRows[r][payFmt.idCol] || '').trim() === tid) { payRow = payRows[r] as any[]; break }
    }
    const bilCount = bilRow && bilFmt.countCol !== null ? parseInt(String(bilRow[bilFmt.countCol!] || '0')) : 0
    const name = bilRow ? String(bilRow[bilFmt.nameCol] || '') : '(Sheet無此人)'
    const payTotal = payRow ? parseInt(String(payRow[payFmt.countCol] || '0')) : 0
    let paidCount = 0
    if (payRow) {
      for (let i = 0; i < payTotal; i++) {
        const val = payRow[payFmt.datesStartCol + i]
        if (val && Number(val) > 0) paidCount++
      }
    }
    console.log(`  ${tid} ${name}: 計費=${bilCount}, 繳費紀錄=${payTotal}, 已繳=${paidCount}`)
  }

  console.log('')
  console.log('=== DB 資料 ===')
  const { rows: dbInv } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_name, e.status as enroll_status,
           i.serial_number, i.amount, i.status, i.pdf_path
    FROM enrollments e
    JOIN persons p ON e.person_id=p.id
    LEFT JOIN invoices i ON i.enrollment_id=e.id AND i.serial_number LIKE '26-%'
    WHERE e.sheets_id = ANY($1)
    ORDER BY e.sheets_id::int, i.serial_number
  `, [ids])

  let currentSid = ''
  for (const r of dbInv) {
    if (r.sheets_id !== currentSid) {
      currentSid = r.sheets_id
      console.log(`  ${r.sheets_id} ${r.name} (${r.class_name}, ${r.enroll_status}):`)
    }
    if (r.serial_number) {
      const pdf = r.pdf_path ? 'PDF✓' : 'noPDF'
      console.log(`    ${r.serial_number}  $${r.amount}  ${r.status}  ${pdf}`)
    } else {
      console.log('    (無114年度收費單)')
    }
  }

  // IDs not in DB at all
  const found = new Set(dbInv.map((r: any) => r.sheets_id))
  const notInDb = ids.filter(id => !found.has(id))
  if (notInDb.length > 0) {
    console.log('')
    console.log('=== DB 完全沒有 enrollment 的 ===')
    for (const id of notInDb) console.log(`  ${id}`)
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
