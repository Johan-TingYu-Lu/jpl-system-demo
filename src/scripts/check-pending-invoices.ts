import 'dotenv/config'
import { readSheet } from '@/lib/sheets'
import { getYearConfig } from '@/lib/year-config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const config = getYearConfig(114)!
const spreadsheetId = config.spreadsheetId

async function main() {
  // Read 學費收支總表 and 計費日期表 to find 應製單數
  const [summaryRows, billingRows] = await Promise.all([
    readSheet("'學費收支總表'!A:AZ", spreadsheetId),
    readSheet("'計費日期表'!A:AZ", spreadsheetId),
  ])

  // Print headers to find which column is 應製單數
  console.log('=== 學費收支總表 header ===')
  if (summaryRows.length > 0) {
    const header = summaryRows[0] as any[]
    for (let i = 0; i < Math.min(header.length, 40); i++) {
      const val = String(header[i] || '').trim()
      if (val) console.log(`  col ${i} (${String.fromCharCode(65 + (i > 25 ? Math.floor(i/26)-1 : -1)) + String.fromCharCode(65 + i%26)}): ${val}`)
    }
  }

  console.log('')
  console.log('=== 計費日期表 header ===')
  if (billingRows.length > 0) {
    const header = billingRows[0] as any[]
    for (let i = 0; i < Math.min(header.length, 30); i++) {
      const val = String(header[i] || '').trim()
      if (val) console.log(`  col ${i}: ${val}`)
    }
  }

  // Search all sheets for 應製單數
  for (const rows of [summaryRows, billingRows]) {
    if (rows.length === 0) continue
    const header = rows[0] as any[]
    for (let i = 0; i < header.length; i++) {
      const val = String(header[i] || '').trim()
      if (val.includes('應製') || val.includes('製單') || val.includes('待製')) {
        console.log(`\n>>> 找到「${val}」在 col ${i}`)
        // List all students where this value = 1
        let count = 0
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] as any[]
          const cellVal = String(row[i] || '').trim()
          const id = String(row[0] || '').trim()
          const name = String(row[1] || '').trim()
          if (cellVal === '1') {
            count++
            console.log(`  ${id} ${name}: ${val}=${cellVal}`)
          }
        }
        console.log(`  共 ${count} 位`)
      }
    }
  }

  await pool.end()
}
main().catch(e => console.error('ERR:', e.message))
