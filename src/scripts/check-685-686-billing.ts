import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check attendance after last invoice end date
  const { rows: att685 } = await pool.query(`
    SELECT ma.year, ma.month, ma.days
    FROM monthly_attendance ma
    JOIN enrollments e ON ma.enrollment_id = e.id
    WHERE e.sheets_id = '685'
    ORDER BY ma.year, ma.month
  `);
  console.log('=== 685 出席紀錄 ===');
  for (const r of att685) {
    console.log(`  ${r.year}/${String(r.month).padStart(2,'0')} days=[${r.days.join(',')}]`);
  }

  const { rows: att686 } = await pool.query(`
    SELECT ma.year, ma.month, ma.days
    FROM monthly_attendance ma
    JOIN enrollments e ON ma.enrollment_id = e.id
    WHERE e.sheets_id = '686'
    ORDER BY ma.year, ma.month
  `);
  console.log('\n=== 686 出席紀錄 ===');
  for (const r of att686) {
    console.log(`  ${r.year}/${String(r.month).padStart(2,'0')} days=[${r.days.join(',')}]`);
  }

  // Check last invoice end_date
  const { rows: last } = await pool.query(`
    SELECT e.sheets_id, MAX(i.end_date)::text as last_end
    FROM enrollments e JOIN invoices i ON i.enrollment_id = e.id
    WHERE e.sheets_id IN ('685','686') AND i.serial_number LIKE '26-%'
    GROUP BY e.sheets_id
  `);
  console.log('\n=== 最後結束日 ===');
  for (const r of last) {
    console.log(`  ${r.sheets_id}: ${r.last_end}`);
  }

  // Count attendance dates AFTER last invoice
  console.log('\n=== 最後結束日之後的出席天數 ===');
  for (const sid of ['685', '686']) {
    const atts = sid === '685' ? att685 : att686;
    const lastEnd = last.find((r: any) => r.sheets_id === sid)?.last_end;
    let afterCount = 0;
    const afterDates: string[] = [];
    for (const a of atts) {
      for (const d of a.days) {
        const dateStr = `${a.year}-${String(a.month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (dateStr > lastEnd) {
          afterCount++;
          afterDates.push(dateStr);
        }
      }
    }
    console.log(`  ${sid}: ${afterCount} 天 (${afterDates.join(', ')})`);
  }

  await pool.end();
}
main().catch(e => console.error(e.message));
