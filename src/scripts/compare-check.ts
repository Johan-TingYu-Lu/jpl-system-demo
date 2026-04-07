import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const spreadsheetId = config.spreadsheetId

async function main() {
  const [billingRows, payRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", spreadsheetId),
    readSheet("'繳費日期表'!A:AZ", spreadsheetId),
  ])

  const bilFmt = config.billingDate
  const payFmt = config.paymentDate

  // Sheet billing count per student
  const sheetBilling = new Map<string, { name: string, billingCount: number }>()
  for (let r = 1; r < billingRows.length; r++) {
    const row = billingRows[r] as any[]
    const id = String(row[bilFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
    const name = String(row[bilFmt.nameCol] || '').trim()
    sheetBilling.set(id, { name, billingCount: count })
  }

  // Sheet payment: how many have dates
  const sheetPay = new Map<string, { totalCount: number, paidCount: number }>()
  for (let r = 1; r < payRows.length; r++) {
    const row = payRows[r] as any[]
    const id = String(row[payFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const total = parseInt(String(row[payFmt.countCol] || '0'))
    let paidCount = 0
    for (let i = 0; i < total; i++) {
      const val = row[payFmt.datesStartCol + i]
      if (val && Number(val) > 0) paidCount++
    }
    sheetPay.set(id, { totalCount: total, paidCount })
  }

  // DB ALL invoices for year 114, ordered by student + serial to get per-student position
  const { rows: allInvoices } = await pool.query(`
    SELECT i.serial_number, i.amount, i.status, i.pdf_path, e.sheets_id, p.name,
           ROW_NUMBER() OVER (PARTITION BY e.sheets_id ORDER BY i.serial_number) as year_pos
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id=e.id
    JOIN persons p ON e.person_id=p.id
    WHERE i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.serial_number
  `)

  // Only show unpaid ones, but use year_pos for Sheet comparison
  const unpaidInvoices = allInvoices.filter(inv => inv.status !== 'paid')

  console.log('| # | 序號 | 學生ID | 姓名 | DB金額 | DB狀態 | PDF | 年度位置 | Sheet計費 | Sheet已繳 | 結論 |')
  console.log('|---|------|--------|------|--------|--------|-----|---------|----------|----------|------|')

  let sheetPaidDbNot = 0
  let bothUnpaid = 0
  let sheetNoRecord = 0
  let idx = 0

  for (const inv of unpaidInvoices) {
    idx++
    const sid = inv.sheets_id
    const sb = sheetBilling.get(sid)
    const sp = sheetPay.get(sid)
    const hasPdf = inv.pdf_path ? '✓' : '✗'

    const yearPos = Number(inv.year_pos) // 1-based position within this year
    const sheetBillingCount = sb?.billingCount ?? 0
    const sheetPayCount = sp?.paidCount ?? 0

    let sheetStatus = ''
    if (yearPos > sheetBillingCount) {
      sheetStatus = '❌ Sheet無此單'
      sheetNoRecord++
    } else if (yearPos <= sheetPayCount) {
      sheetStatus = '⚠️ Sheet已繳,DB未銷'
      sheetPaidDbNot++
    } else {
      sheetStatus = '✅ 雙方皆未繳'
      bothUnpaid++
    }

    console.log(`| ${idx} | ${inv.serial_number} | ${sid} | ${inv.name} | $${inv.amount} | ${inv.status} | ${hasPdf} | ${yearPos}/${sheetBillingCount} | ${sheetBillingCount} | ${sheetPayCount} | ${sheetStatus} |`)
  }

  console.log('')
  console.log('=== DB未銷帳總結 ===')
  console.log(`⚠️  Sheet已繳但DB未銷帳: ${sheetPaidDbNot} 筆`)
  console.log(`✅ 雙方皆未繳(等收款): ${bothUnpaid} 筆`)
  console.log(`❌ Sheet無此收費單(DB多出): ${sheetNoRecord} 筆`)
  console.log(`   合計: ${unpaidInvoices.length} 筆`)

  // =============================================
  // Part 2: Sheet有計費紀錄但DB還沒生成收費單
  // =============================================
  console.log('')
  console.log('='.repeat(100))
  console.log('Sheet 有計費紀錄但 DB 還沒生成收費單')
  console.log('='.repeat(100))

  // DB count per student for year 114
  const { rows: dbCounts } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_name, count(*)::int as db_count
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id=e.id
    JOIN persons p ON e.person_id=p.id
    WHERE i.serial_number LIKE '26-%'
    GROUP BY e.sheets_id, p.name, e.class_name
  `)
  const dbCountMap = new Map(dbCounts.map(d => [d.sheets_id, d]))

  // Also check active enrollments with 0 invoices
  const { rows: activeEnrollments } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_name
    FROM enrollments e
    JOIN persons p ON e.person_id=p.id
    WHERE e.status = 'active'
  `)
  for (const ae of activeEnrollments) {
    if (!dbCountMap.has(ae.sheets_id)) {
      dbCountMap.set(ae.sheets_id, { sheets_id: ae.sheets_id, name: ae.name, class_name: ae.class_name, db_count: 0 })
    }
  }

  console.log('| # | 學生ID | 姓名 | 班級 | Sheet計費 | DB已生成 | 缺少 | Sheet已繳 | 備註 |')
  console.log('|---|--------|------|------|----------|---------|------|----------|------|')

  let totalMissing = 0
  let rowNum = 0
  const missingList: { sid: string, name: string, sheetCount: number, dbCount: number, missing: number }[] = []

  for (const [sid, sb] of [...sheetBilling.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const db = dbCountMap.get(sid)
    const dbCount = db?.db_count ?? 0
    const sheetCount = sb.billingCount
    const sp = sheetPay.get(sid)
    const sheetPayCount = sp?.paidCount ?? 0

    if (sheetCount > dbCount) {
      rowNum++
      const missing = sheetCount - dbCount
      totalMissing += missing
      const className = db?.class_name ?? '?'
      const note = sheetPayCount >= sheetCount ? '全部已繳' : `未繳${sheetCount - sheetPayCount}筆`
      console.log(`| ${rowNum} | ${sid} | ${sb.name} | ${className} | ${sheetCount} | ${dbCount} | ${missing} | ${sheetPayCount} | ${note} |`)
      missingList.push({ sid, name: sb.name, sheetCount, dbCount, missing })
    }
  }

  console.log('')
  console.log(`=== Sheet有但DB沒做的收費單: ${totalMissing} 筆 (${rowNum} 位學生) ===`)

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
