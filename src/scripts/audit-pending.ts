import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import { serialToDate, formatDate } from '@/lib/attendance-utils'
import pg from 'pg'
import fs from 'fs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const sid = config.spreadsheetId

function excelSerialToDate(serial: number): string {
  const d = new Date((serial - 25569) * 86400000 + 12 * 3600000)
  return d.toISOString().slice(0, 10)
}

async function main() {
  // 1. Read all 4 sheets in parallel
  const [summaryRows, billingRows, feeRows, payRows] = await Promise.all([
    readSheet("'學費收支總表'!A:Q", sid),
    readSheet("'計費日期表'!A:AZ", sid),
    readSheet("'繳費金額表'!A:AZ", sid),
    readSheet("'繳費日期表'!A:AZ", sid),
  ])

  const bilFmt = config.billingDate
  const feeFmt = config.feeAmount
  const payFmt = config.paymentDate

  // 2. Find students where 應製單數 (col P = idx 15) != 0
  const pendingStudents: { id: string, name: string, cls: string, shouldMake: number }[] = []
  for (let r = 1; r < summaryRows.length; r++) {
    const row = summaryRows[r] as any[]
    const id = String(row[0] || '').trim()
    const name = String(row[1] || '').trim()
    const cls = String(row[2] || '').trim()
    const val = parseInt(String(row[15] || '0'))
    if (val !== 0 && /^\d+$/.test(id)) {
      pendingStudents.push({ id, name, cls, shouldMake: val })
    }
  }

  // 3. Build Sheet data maps
  const sheetBillingMap = new Map<string, { count: number, pairs: { start: string, end: string }[] }>()
  for (let r = 1; r < billingRows.length; r++) {
    const row = billingRows[r] as any[]
    const id = String(row[bilFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const count = bilFmt.countCol !== null ? parseInt(String(row[bilFmt.countCol!] || '0')) : 0
    const pairs: { start: string, end: string }[] = []
    for (let i = 0; i < count; i++) {
      const sCol = bilFmt.datePairsStartCol + i * 2
      const eCol = sCol + 1
      const sVal = row[sCol]
      const eVal = row[eCol]
      const start = typeof sVal === 'number' && sVal > 0 ? excelSerialToDate(sVal) : '—'
      const end = typeof eVal === 'number' && eVal > 0 ? excelSerialToDate(eVal) : '—'
      pairs.push({ start, end })
    }
    sheetBillingMap.set(id, { count, pairs })
  }

  const sheetFeeMap = new Map<string, { count: number, amounts: number[] }>()
  for (let r = 1; r < feeRows.length; r++) {
    const row = feeRows[r] as any[]
    const id = String(row[feeFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const count = parseInt(String(row[feeFmt.countCol] || '0'))
    const amounts: number[] = []
    for (let i = 0; i < count; i++) {
      const val = row[feeFmt.amountsStartCol + i]
      amounts.push(typeof val === 'number' ? val : 0)
    }
    sheetFeeMap.set(id, { count, amounts })
  }

  const sheetPayMap = new Map<string, { count: number, dates: (string | null)[] }>()
  for (let r = 1; r < payRows.length; r++) {
    const row = payRows[r] as any[]
    const id = String(row[payFmt.idCol] || '').trim()
    if (!id || !/^\d+$/.test(id)) continue
    const count = parseInt(String(row[payFmt.countCol] || '0'))
    const dates: (string | null)[] = []
    for (let i = 0; i < count; i++) {
      const val = row[payFmt.datesStartCol + i]
      if (typeof val === 'number' && val > 0) {
        dates.push(excelSerialToDate(val))
      } else {
        dates.push(null)
      }
    }
    sheetPayMap.set(id, { count, dates })
  }

  // 4. Query DB for all these students at once
  const ids = pendingStudents.map(s => s.id)
  const { rows: dbInvoices } = await pool.query(`
    SELECT e.sheets_id, p.name, i.serial_number, i.amount, i.status,
           i.start_date::text as sd, i.end_date::text as ed,
           i.paid_date::text as pd, i.pdf_path
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id=e.id
    JOIN persons p ON e.person_id=p.id
    WHERE e.sheets_id = ANY($1) AND i.serial_number LIKE '26-%'
    ORDER BY e.sheets_id::int, i.start_date, i.serial_number
  `, [ids])

  const dbMap = new Map<string, any[]>()
  for (const r of dbInvoices) {
    if (!dbMap.has(r.sheets_id)) dbMap.set(r.sheets_id, [])
    dbMap.get(r.sheets_id)!.push(r)
  }

  // 5. Build markdown
  const lines: string[] = []
  lines.push('# 應製單數 ≠ 0 學生逐一檢核報告')
  lines.push('')
  lines.push(`> 產生時間: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push(`> 共 ${pendingStudents.length} 位學生`)
  lines.push('')

  // Summary table
  lines.push('## 總覽')
  lines.push('')
  lines.push('| # | ID | 姓名 | 班別 | 應製單數 | Sheet計費 | DB數量 | 一致 | Sheet已繳 | DB已繳 |')
  lines.push('|---|-----|------|------|---------|----------|--------|------|----------|--------|')

  for (let idx = 0; idx < pendingStudents.length; idx++) {
    const s = pendingStudents[idx]
    const sheetBil = sheetBillingMap.get(s.id)
    const sheetPay = sheetPayMap.get(s.id)
    const dbList = dbMap.get(s.id) || []
    const sheetCount = sheetBil?.count ?? 0
    const dbCount = dbList.length
    const match = sheetCount === dbCount ? '✓' : '✗'
    const sheetPaidCount = sheetPay?.dates.filter(d => d !== null).length ?? 0
    const dbPaidCount = dbList.filter(i => i.status === 'paid').length
    lines.push(`| ${idx + 1} | ${s.id} | ${s.name} | ${s.cls} | ${s.shouldMake} | ${sheetCount} | ${dbCount} | ${match} | ${sheetPaidCount} | ${dbPaidCount} |`)
  }

  // Detail per student
  lines.push('')
  lines.push('## 逐一明細')

  for (const s of pendingStudents) {
    const sheetBil = sheetBillingMap.get(s.id)
    const sheetFee = sheetFeeMap.get(s.id)
    const sheetPay = sheetPayMap.get(s.id)
    const dbList = dbMap.get(s.id) || []

    lines.push('')
    lines.push(`### ${s.id} ${s.name} (${s.cls}) — 應製單數: ${s.shouldMake}`)
    lines.push('')

    const maxLen = Math.max(sheetBil?.count ?? 0, dbList.length)
    if (maxLen === 0) {
      lines.push('> 無任何收費單紀錄')
      continue
    }

    lines.push('| # | Sheet起始 | Sheet結束 | Sheet金額 | Sheet繳費日 | DB序號 | DB起始 | DB結束 | DB金額 | DB狀態 | PDF | 日期一致 |')
    lines.push('|---|----------|----------|----------|-----------|--------|--------|--------|--------|--------|-----|---------|')

    for (let i = 0; i < maxLen; i++) {
      const sp = sheetBil && i < sheetBil.pairs.length ? sheetBil.pairs[i] : null
      const sa = sheetFee && i < sheetFee.amounts.length ? sheetFee.amounts[i] : null
      const spd = sheetPay && i < sheetPay.dates.length ? sheetPay.dates[i] : null
      const di = i < dbList.length ? dbList[i] : null

      const ss = sp?.start ?? '—'
      const se = sp?.end ?? '—'
      const samt = sa !== null ? `$${sa.toLocaleString()}` : '—'
      const sPayDate = spd ?? '—'
      const ds = di?.serial_number ?? '—'
      const dsd = di?.sd ?? '—'
      const ded = di?.ed ?? '—'
      const damt = di ? `$${di.amount.toLocaleString()}` : '—'
      const dst = di?.status ?? '—'
      const pdf = di?.pdf_path ? '✓' : (di ? '✗' : '—')

      let dateMatch = '—'
      if (sp && di) {
        dateMatch = (sp.start === di.sd && sp.end === di.ed) ? '✓' : '✗'
      } else if (sp && !di) {
        dateMatch = 'DB缺'
      } else if (!sp && di) {
        dateMatch = 'Sheet缺'
      }

      lines.push(`| ${i + 1} | ${ss} | ${se} | ${samt} | ${sPayDate} | ${ds} | ${dsd} | ${ded} | ${damt} | ${dst} | ${pdf} | ${dateMatch} |`)
    }
  }

  const md = lines.join('\n')
  const outPath = 'audit-pending-report.md'
  fs.writeFileSync(outPath, md, 'utf-8')
  console.log(`Report written to ${outPath} (${pendingStudents.length} students, ${lines.length} lines)`)

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
