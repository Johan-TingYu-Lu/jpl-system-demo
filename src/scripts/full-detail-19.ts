import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'
import fs from 'fs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId

function excelSerialToDate(serial: number): string {
  const d = new Date((serial - 25569) * 86400000 + 12 * 3600000)
  return d.toISOString().slice(0, 10)
}

// 排除 479(永久停止) 和 509(應製單-1)
const ids = ['558','561','590','606','612','626','633','634','637','641','646','648','649','652','659','661','676','677','691']

async function main() {
  // Read ALL sheet tabs
  const [billingRows, feeRows, payRows, summaryRows] = await Promise.all([
    readSheet("'計費日期表'!A:AZ", sid),
    readSheet("'繳費金額表'!A:AZ", sid),
    readSheet("'繳費日期表'!A:AZ", sid),
    readSheet("'學費收支總表'!A:AB", sid),
  ])

  const bilFmt = config.billingDate
  const feeFmt = config.feeAmount
  const payFmt = config.paymentDate

  // DB: all invoices + payments
  const { rows: dbInvoices } = await pool.query(`
    SELECT e.sheets_id, p.name, e.class_code, e.class_name,
           i.id as inv_id, i.serial_number, i.amount, i.status,
           i.start_date::text as sd, i.end_date::text as ed,
           i.paid_date::text as pd, i.pdf_path,
           i.yy_count, i.y_count, i.total_y, i.note,
           i.created_at::text as created,
           i.records
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id=e.id
    JOIN persons p ON e.person_id=p.id
    WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.start_date, i.serial_number
  `, [ids])

  const { rows: dbPayments } = await pool.query(`
    SELECT py.id as pay_id, py.amount as pay_amount, py.payment_date::text as pay_date,
           py.method, py.notes as pay_notes, py.invoice_id,
           e.sheets_id
    FROM payments py
    JOIN enrollments e ON py.enrollment_id=e.id
    WHERE e.sheets_id = ANY($1)
    ORDER BY e.sheets_id::int, py.payment_date
  `, [ids])

  // DB attendance
  const { rows: dbAttendance } = await pool.query(`
    SELECT e.sheets_id, ma.year, ma.month, ma.days
    FROM monthly_attendance ma
    JOIN enrollments e ON ma.enrollment_id=e.id
    WHERE e.sheets_id = ANY($1)
    ORDER BY e.sheets_id::int, ma.year, ma.month
  `, [ids])

  const lines: string[] = []
  lines.push('# 19 位學生 Sheet vs DB 完整比對報告')
  lines.push('')
  lines.push(`> 產生時間: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')

  for (const tid of ids) {
    // === SHEET DATA ===
    let sheetBilRow: any[] | null = null
    let sheetFeeRow: any[] | null = null
    let sheetPayRow: any[] | null = null
    let sheetSummaryRow: any[] | null = null

    for (let r = 1; r < billingRows.length; r++) {
      if (String(billingRows[r][bilFmt.idCol] || '').trim() === tid) { sheetBilRow = billingRows[r] as any[]; break }
    }
    for (let r = 1; r < feeRows.length; r++) {
      if (String(feeRows[r][feeFmt.idCol] || '').trim() === tid) { sheetFeeRow = feeRows[r] as any[]; break }
    }
    for (let r = 1; r < payRows.length; r++) {
      if (String(payRows[r][payFmt.idCol] || '').trim() === tid) { sheetPayRow = payRows[r] as any[]; break }
    }
    for (let r = 1; r < summaryRows.length; r++) {
      if (String(summaryRows[r][0] || '').trim() === tid) { sheetSummaryRow = summaryRows[r] as any[]; break }
    }

    const name = sheetBilRow ? String(sheetBilRow[bilFmt.nameCol] || '') : '?'
    const cls = sheetBilRow ? String(sheetBilRow[2] || '') : '?'

    lines.push(`---`)
    lines.push(`## ${tid} ${name} (${cls})`)
    lines.push('')

    // Sheet 學費收支總表
    if (sheetSummaryRow) {
      lines.push('### Sheet 學費收支總表')
      lines.push('```')
      lines.push(`是否接近繳費(D): ${sheetSummaryRow[3] ?? ''}`)
      lines.push(`是否已發單(E): ${sheetSummaryRow[4] ?? ''}`)
      lines.push(`當前費用距下次繳費(F): ${sheetSummaryRow[5] ?? ''}`)
      lines.push(`當下欠費(G): ${sheetSummaryRow[6] ?? ''}`)
      lines.push(`年度累積繳費(H): ${sheetSummaryRow[7] ?? ''}`)
      lines.push(`歷史累積欠費(I): ${sheetSummaryRow[8] ?? ''}`)
      lines.push(`當年度學費(J): ${sheetSummaryRow[9] ?? ''}`)
      lines.push(`已發單張數(K): ${sheetSummaryRow[10] ?? ''}`)
      lines.push(`已繳費次數(L): ${sheetSummaryRow[11] ?? ''}`)
      lines.push(`當年度應繳總單數-應製單(M): ${sheetSummaryRow[12] ?? ''}`)
      lines.push(`當年度未繳次-已製單(N): ${sheetSummaryRow[13] ?? ''}`)
      lines.push(`累計未繳次數(O): ${sheetSummaryRow[14] ?? ''}`)
      lines.push(`應製單數(P): ${sheetSummaryRow[15] ?? ''}`)
      lines.push(`預備收費門檻(S): ${sheetSummaryRow[18] ?? ''}`)
      lines.push(`收費門檻(T): ${sheetSummaryRow[19] ?? ''}`)
      lines.push('```')
      lines.push('')
    }

    // Sheet 計費日期表
    const bilCount = sheetBilRow && bilFmt.countCol !== null ? parseInt(String(sheetBilRow[bilFmt.countCol!] || '0')) : 0
    lines.push(`### Sheet 計費日期表 (應發單次數: ${bilCount})`)
    lines.push('')
    if (bilCount > 0) {
      lines.push('| # | 起始日期(raw) | 起始日期 | 結束日期(raw) | 結束日期 |')
      lines.push('|---|-------------|---------|-------------|---------|')
      for (let i = 0; i < bilCount; i++) {
        const sCol = bilFmt.datePairsStartCol + i * 2
        const eCol = sCol + 1
        const sRaw = sheetBilRow![sCol] ?? ''
        const eRaw = sheetBilRow![eCol] ?? ''
        const sDate = typeof sRaw === 'number' && sRaw > 0 ? excelSerialToDate(sRaw) : String(sRaw)
        const eDate = typeof eRaw === 'number' && eRaw > 0 ? excelSerialToDate(eRaw) : String(eRaw)
        lines.push(`| ${i + 1} | ${sRaw} | ${sDate} | ${eRaw} | ${eDate} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // Sheet 繳費金額表
    const feeCount = sheetFeeRow ? parseInt(String(sheetFeeRow[feeFmt.countCol] || '0')) : 0
    lines.push(`### Sheet 繳費金額表 (收費次數: ${feeCount})`)
    lines.push('')
    if (feeCount > 0) {
      lines.push('| # | 金額(raw) |')
      lines.push('|---|----------|')
      for (let i = 0; i < feeCount; i++) {
        const val = sheetFeeRow![feeFmt.amountsStartCol + i] ?? ''
        lines.push(`| ${i + 1} | ${val} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // Sheet 繳費日期表
    const payCount = sheetPayRow ? parseInt(String(sheetPayRow[payFmt.countCol] || '0')) : 0
    lines.push(`### Sheet 繳費日期表 (繳費次數總計: ${payCount})`)
    lines.push('')
    if (payCount > 0) {
      lines.push('| # | 繳費日(raw) | 繳費日 |')
      lines.push('|---|-----------|--------|')
      for (let i = 0; i < payCount; i++) {
        const val = sheetPayRow![payFmt.datesStartCol + i] ?? ''
        const dateStr = typeof val === 'number' && val > 0 ? excelSerialToDate(val) : String(val || '未繳')
        lines.push(`| ${i + 1} | ${val} | ${dateStr} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // === DB DATA ===
    const invs = dbInvoices.filter(r => r.sheets_id === tid)
    const pays = dbPayments.filter(r => r.sheets_id === tid)
    const atts = dbAttendance.filter(r => r.sheets_id === tid)

    lines.push(`### DB Invoices (${invs.length} 筆)`)
    lines.push('')
    if (invs.length > 0) {
      lines.push('| # | 序號 | 金額 | 狀態 | 起始日 | 結束日 | 銷帳日 | PDF | YY | Y | totalY | 建立時間 | 備註 |')
      lines.push('|---|------|------|------|--------|--------|--------|-----|----|----|--------|---------|------|')
      for (let i = 0; i < invs.length; i++) {
        const r = invs[i]
        const pdf = r.pdf_path ? '✓' : '✗'
        lines.push(`| ${i + 1} | ${r.serial_number} | $${r.amount} | ${r.status} | ${r.sd} | ${r.ed} | ${r.pd || '—'} | ${pdf} | ${r.yy_count} | ${r.y_count} | ${r.total_y} | ${r.created?.slice(0, 19) || ''} | ${r.note || ''} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // DB Payments
    lines.push(`### DB Payments (${pays.length} 筆)`)
    lines.push('')
    if (pays.length > 0) {
      lines.push('| # | payment_id | invoice_id | 金額 | 繳費日 | 方式 | 備註 |')
      lines.push('|---|-----------|-----------|------|--------|------|------|')
      for (let i = 0; i < pays.length; i++) {
        const r = pays[i]
        lines.push(`| ${i + 1} | ${r.pay_id} | ${r.invoice_id} | $${r.pay_amount} | ${r.pay_date} | ${r.method} | ${r.pay_notes || ''} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // DB Attendance summary
    lines.push(`### DB 出席紀錄 (${atts.length} 月)`)
    lines.push('')
    if (atts.length > 0) {
      lines.push('| 年月 | 出席向量 (0=無 1=缺 2=Y 3=YY) |')
      lines.push('|------|-------------------------------|')
      for (const a of atts) {
        const days = a.days as number[]
        // compact display: only show non-zero days
        const entries: string[] = []
        for (let d = 0; d < days.length; d++) {
          if (days[d] > 0) {
            const code = days[d] === 3 ? 'YY' : days[d] === 2 ? 'Y' : 'X'
            entries.push(`${d + 1}日=${code}`)
          }
        }
        lines.push(`| ${a.year}/${String(a.month).padStart(2, '0')} | ${entries.join(', ') || '(全空)'} |`)
      }
    } else {
      lines.push('> (無)')
    }
    lines.push('')

    // Invoice records detail (billing line items)
    lines.push(`### DB Invoice 計費明細`)
    lines.push('')
    for (const inv of invs) {
      const recs = inv.records as any[]
      if (!recs || !Array.isArray(recs) || recs.length === 0) {
        lines.push(`**${inv.serial_number}**: (無明細)`)
        continue
      }
      lines.push(`**${inv.serial_number}** ($${inv.amount}, ${inv.sd} ~ ${inv.ed}):`)
      lines.push('')
      lines.push('| 日期 | 狀態 | Y數 | 費用 | 分割 |')
      lines.push('|------|------|------|------|------|')
      for (const rec of recs) {
        const status = rec.status === 3 ? 'YY' : 'Y'
        lines.push(`| ${rec.date} | ${status} | ${rec.yUsed} | $${rec.fee} | ${rec.isSplit ? '是' : ''} |`)
      }
      lines.push('')
    }
  }

  const md = lines.join('\n')
  const outPath = 'full-detail-19.md'
  fs.writeFileSync(outPath, md, 'utf-8')
  console.log(`Written to ${outPath} (${ids.length} students, ${lines.length} lines)`)

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
