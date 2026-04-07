import 'dotenv/config';
import pg from 'pg';

async function main() {
  const connStr = process.env.DATABASE_URL || '';
  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 查 686 enrollment
  const { rows: enrollments } = await client.query(`
    SELECT e.id, e.sheets_id, e.class_name, e.class_code, e.status, e.cohort,
           e.start_year, e.end_year,
           p.name
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id = '686'
  `);

  if (enrollments.length === 0) {
    console.log('找不到 sheetsId=686 的學生');
    await client.end();
    return;
  }

  for (const e of enrollments) {
    console.log('=== ENROLLMENT ===');
    console.log(`  ${e.sheets_id} | ${e.name} | ${e.class_name} | ${e.class_code} | status=${e.status} | cohort=${e.cohort}`);
    console.log(`  startYear=${e.start_year} endYear=${e.end_year} | DB enrollment.id=${e.id}`);

    // invoices
    const { rows: invoices } = await client.query(`
      SELECT serial_number, start_date, end_date, amount, total_y, yy_count, y_count, status, note
      FROM invoices WHERE enrollment_id = $1 ORDER BY start_date
    `, [e.id]);
    console.log(`\n=== INVOICES (${invoices.length}) ===`);
    let invoiceTotal = 0;
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const sd = inv.start_date.toISOString().slice(0, 10);
      const ed = inv.end_date.toISOString().slice(0, 10);
      invoiceTotal += inv.amount;
      console.log(`  #${i + 1} ${inv.serial_number} | ${sd}~${ed} | $${inv.amount} | totalY=${inv.total_y} (YY=${inv.yy_count} Y=${inv.y_count}) | ${inv.status}${inv.note ? ' | ' + inv.note : ''}`);
    }
    console.log(`  收費單金額合計: $${invoiceTotal}`);

    // payments
    const { rows: payments } = await client.query(`
      SELECT amount, payment_date, method FROM payments WHERE enrollment_id = $1 ORDER BY payment_date
    `, [e.id]);
    console.log(`\n=== PAYMENTS (${payments.length}) ===`);
    let paymentTotal = 0;
    for (const p of payments) {
      paymentTotal += p.amount;
      console.log(`  $${p.amount} | ${p.payment_date ? p.payment_date.toISOString().slice(0, 10) : 'N/A'} | ${p.method || ''}`);
    }
    console.log(`  繳費金額合計: $${paymentTotal}`);

    // attendance summary
    const { rows: att } = await client.query(`
      SELECT year, month, days FROM monthly_attendance
      WHERE enrollment_id = $1 ORDER BY year, month
    `, [e.id]);
    console.log(`\n=== ATTENDANCE (${att.length} months) ===`);
    let totalY = 0;
    for (const a of att) {
      const days = a.days as number[];
      const yCount = days.filter((d: number) => d === 2).length;
      const yyCount = days.filter((d: number) => d === 3).length;
      const monthY = yyCount * 2 + yCount;
      totalY += monthY;
      if (monthY > 0) {
        const dateList: string[] = [];
        for (let d = 0; d < days.length; d++) {
          if (days[d] === 2 || days[d] === 3) {
            dateList.push(`${d + 1}日(${days[d] === 3 ? 'YY' : 'Y'})`);
          }
        }
        console.log(`  ${a.year}/${String(a.month).padStart(2, '0')}: ${dateList.join(', ')} → ${monthY}Y (累計${totalY}Y)`);
      }
    }
    console.log(`  總Y: ${totalY}`);

    // semester fees
    const { rows: fees } = await client.query(`
      SELECT academic_year, semester, amount, fee_date, status
      FROM semester_fees WHERE enrollment_id = $1 ORDER BY academic_year, semester
    `, [e.id]);
    if (fees.length > 0) {
      console.log('\n=== SEMESTER FEES ===');
      for (const f of fees) {
        console.log(`  ${f.academic_year}年 第${f.semester}學期 $${f.amount} (${f.fee_date ? f.fee_date.toISOString().slice(0, 10) : 'N/A'}) ${f.status}`);
      }
    }
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
