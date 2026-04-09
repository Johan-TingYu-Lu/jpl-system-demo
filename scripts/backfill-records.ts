/**
 * backfill-records.ts — 回填所有 records 為空的 invoice
 * 
 * 用 billing engine 從出勤資料計算正確的 records/totalY/yyCount/yCount
 */
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // 1. Find all invoices with empty records
  const { rows: emptyInvs } = await pool.query(`
    SELECT i.id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed,
           i.total_y, i.amount, e.id as enrollment_id, e.sheets_id, e.cohort, p.name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE i.records IS NULL OR i.records::text = '[]' OR i.records::text = 'null'
    ORDER BY e.sheets_id::int, i.start_date
  `);

  console.log(`找到 ${emptyInvs.length} 筆 records 為空的 invoice\n`);

  // 2. Get all attendance
  const enrollmentIds = [...new Set(emptyInvs.map(i => i.enrollment_id))];
  const { rows: allAtt } = await pool.query(`
    SELECT enrollment_id, year, month, days 
    FROM monthly_attendance
    WHERE enrollment_id = ANY($1)
    ORDER BY enrollment_id, year, month
  `, [enrollmentIds]);

  const attByEnrollment = new Map<number, typeof allAtt>();
  for (const a of allAtt) {
    const arr = attByEnrollment.get(a.enrollment_id) || [];
    arr.push(a);
    attByEnrollment.set(a.enrollment_id, arr);
  }

  // 3. For each empty invoice, find the previous invoice's last record date (FLAG)
  //    then calculate records from attendance
  const client = await pool.connect();
  let fixed = 0, skipped = 0;

  try {
    await client.query('BEGIN');

    // Group empty invoices by enrollment for sequential processing
    const byEnrollment = new Map<number, typeof emptyInvs>();
    for (const inv of emptyInvs) {
      const arr = byEnrollment.get(inv.enrollment_id) || [];
      arr.push(inv);
      byEnrollment.set(inv.enrollment_id, arr);
    }

    for (const [enrollmentId, invs] of byEnrollment) {
      // Get ALL invoices for this enrollment (to find FLAG)
      const { rows: allInvs } = await client.query(`
        SELECT id, serial_number, end_date::text as ed, records
        FROM invoices WHERE enrollment_id = $1 ORDER BY start_date
      `, [enrollmentId]);

      // Get billable dates
      const months = attByEnrollment.get(enrollmentId) || [];
      const billable: { date: string; code: number; y: number }[] = [];
      for (const m of months) {
        const days = m.days as number[];
        for (let d = 0; d < days.length; d++) {
          if (days[d] === 2 || days[d] === 3) {
            const dateStr = `${m.year}/${String(m.month).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`;
            billable.push({ date: dateStr, code: days[d], y: days[d] === 3 ? 2 : 1 });
          }
        }
      }
      billable.sort((a, b) => a.date.localeCompare(b.date));

      for (const inv of invs) {
        // Find previous invoice's FLAG
        const invIndex = allInvs.findIndex(i => i.id === inv.id);
        let flag = '';
        if (invIndex > 0) {
          const prev = allInvs[invIndex - 1];
          const prevRecs = prev.records as { date: string }[] | null;
          if (prevRecs && Array.isArray(prevRecs) && prevRecs.length > 0) {
            flag = prevRecs[prevRecs.length - 1].date;
          } else {
            // Previous also empty - use its endDate as fallback
            flag = prev.ed.replace(/-/g, '/');
          }
        }

        // Settlement Y
        const cohort = inv.cohort || 116;
        const settlementY = cohort <= 115 ? 8 : 10;
        const fullFee = cohort <= 115 ? 750 : 800;
        const halfFee = cohort <= 115 ? 375 : 400;

        // Get attendance after FLAG, accumulate until settlementY
        const afterFlag = billable.filter(b => b.date > flag);
        const records: { date: string; status: number; fee: number }[] = [];
        let totalY = 0;

        for (const b of afterFlag) {
          if (totalY >= settlementY) break;

          const remaining = settlementY - totalY;
          if (b.code === 3 && remaining >= 2) {
            records.push({ date: b.date, status: 3, fee: fullFee });
            totalY += 2;
          } else if (b.code === 3 && remaining === 1) {
            // Split: only take 1Y from YY
            records.push({ date: b.date, status: 3, fee: halfFee });
            totalY += 1;
          } else if (b.code === 2) {
            records.push({ date: b.date, status: 2, fee: halfFee });
            totalY += 1;
          }
        }

        if (records.length === 0) {
          console.log(`  SKIP ${inv.sheets_id} ${inv.name} | ${inv.serial_number} | 無出勤資料`);
          skipped++;
          continue;
        }

        const yyCount = records.filter(r => r.status === 3).length;
        const yCount = records.filter(r => r.status === 2).length;
        const lastRecordDate = records[records.length - 1].date;

        await client.query(`
          UPDATE invoices SET records = $2, total_y = $3, yy_count = $4, y_count = $5
          WHERE id = $1
        `, [inv.id, JSON.stringify(records), totalY, yyCount, yCount]);

        fixed++;
        const flagStr = flag || '(none)';
        console.log(`  FIX ${inv.sheets_id} ${inv.name} | ${inv.serial_number} | FLAG=${flagStr} | ${records.length} records | lastRec=${lastRecordDate} | endDate=${inv.ed}`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✅ 完成: 回填 ${fixed} 筆, 跳過 ${skipped} 筆`);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ ROLLBACK:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
