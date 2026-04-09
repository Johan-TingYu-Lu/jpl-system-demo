/**
 * check-invoice-integrity.ts
 * 檢查 542+ 所有 invoice 的完整性
 */
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function daysDiff(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

async function main() {
  const { rows: allInvs } = await pool.query(`
    SELECT i.id, i.serial_number, i.start_date::text as sd, i.end_date::text as ed,
           i.total_y, i.records, i.status as inv_status, i.yy_count, i.y_count,
           e.sheets_id, e.id as enrollment_id, e.class_name, e.cohort, p.name
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id::int >= 542
    ORDER BY e.sheets_id::int, i.start_date
  `);

  // Group by enrollment
  const byEnrollment = new Map<number, typeof allInvs>();
  for (const inv of allInvs) {
    const arr = byEnrollment.get(inv.enrollment_id) || [];
    arr.push(inv);
    byEnrollment.set(inv.enrollment_id, arr);
  }

  // Get all attendance
  const { rows: allAtt } = await pool.query(`
    SELECT enrollment_id, year, month, days FROM monthly_attendance
    WHERE enrollment_id IN (SELECT id FROM enrollments WHERE sheets_id::int >= 542)
    ORDER BY enrollment_id, year, month
  `);
  const attByEnrollment = new Map<number, typeof allAtt>();
  for (const a of allAtt) {
    const arr = attByEnrollment.get(a.enrollment_id) || [];
    arr.push(a);
    attByEnrollment.set(a.enrollment_id, arr);
  }

  function getBillableDates(enrollmentId: number): { date: string; y: number }[] {
    const months = attByEnrollment.get(enrollmentId) || [];
    const dates: { date: string; y: number }[] = [];
    for (const m of months) {
      const days = m.days as number[];
      for (let d = 0; d < days.length; d++) {
        if (days[d] === 2 || days[d] === 3) {
          const dateStr = `${m.year}-${String(m.month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
          dates.push({ date: dateStr, y: days[d] === 3 ? 2 : 1 });
        }
      }
    }
    return dates.sort((a, b) => a.date.localeCompare(b.date));
  }

  const issuesA: string[] = []; // records 空 + 最後一張
  const issuesB: string[] = []; // endDate != lastRecord + 最後一張
  const issuesC: string[] = []; // 非最後一張的問題
  let totalChecked = 0;
  let totalProblems = 0;

  for (const [enrollmentId, invs] of byEnrollment) {
    const billable = getBillableDates(enrollmentId);
    const cohort = invs[0]?.cohort || 116;
    const settlementY = cohort <= 115 ? 8 : 10;

    for (let idx = 0; idx < invs.length; idx++) {
      const inv = invs[idx];
      const isLatest = idx === invs.length - 1;
      const records = inv.records as { date: string; status: number }[] | null;
      const hasRecords = records && Array.isArray(records) && records.length > 0;
      totalChecked++;

      const problems: string[] = [];

      // Check 1: records empty
      if (!hasRecords) {
        problems.push('records 為空');

        if (isLatest) {
          // Calculate correct last attendance date
          // Find previous invoice FLAG
          const prevInv = idx > 0 ? invs[idx - 1] : null;
          let prevFlag = '';
          if (prevInv) {
            const prevRecs = prevInv.records as { date: string }[] | null;
            if (prevRecs && prevRecs.length > 0) {
              prevFlag = prevRecs[prevRecs.length - 1].date.replace(/\//g, '-');
            } else {
              prevFlag = prevInv.ed;
            }
          }

          const afterPrev = billable.filter(b => b.date > prevFlag);
          let yAccum = 0;
          let correctLastDate = '';
          for (const b of afterPrev) {
            yAccum += b.y;
            correctLastDate = b.date;
            if (yAccum >= settlementY) break;
          }

          if (correctLastDate) {
            problems.push(`正確最後上課日: ${correctLastDate}, endDate: ${inv.ed}, 差 ${daysDiff(inv.ed, correctLastDate)} 天`);
          }
        }
      }

      // Check 2: endDate vs lastRecord
      if (hasRecords) {
        const lastRec = records![records!.length - 1].date.replace(/\//g, '-');
        if (lastRec !== inv.ed) {
          const diff = daysDiff(inv.ed, lastRec);
          problems.push(`endDate(${inv.ed}) != lastRecord(${lastRec}), 差 ${diff} 天`);
        }

        // Check 3: totalY mismatch
        let recY = 0;
        for (const r of records!) recY += r.status === 3 ? 2 : 1;
        if (recY !== inv.total_y && inv.total_y !== 0) {
          problems.push(`totalY(${inv.total_y}) != records Y(${recY})`);
        }
      }

      if (problems.length > 0) {
        totalProblems++;
        const line = `  ${inv.sheets_id} ${inv.name} | ${inv.serial_number} | ${inv.sd}~${inv.ed} | ${inv.inv_status}${isLatest ? ' [最後一張]' : ''}`;
        const detail = problems.map(p => `    -> ${p}`).join('\n');
        const entry = `${line}\n${detail}`;

        if (!hasRecords && isLatest) issuesA.push(entry);
        else if (hasRecords && isLatest && problems.some(p => p.includes('endDate'))) issuesB.push(entry);
        else if (!isLatest) issuesC.push(entry);
        else if (isLatest) issuesA.push(entry); // other latest issues
      }
    }
  }

  console.log('================================================================');
  console.log('  Invoice 完整性檢查報告 (542+)');
  console.log('================================================================');
  console.log(`  檢查: ${totalChecked} 筆`);
  console.log(`  有問題: ${totalProblems} 筆`);
  console.log(`  A. records空+最後一張 (FLAG壞): ${issuesA.length}`);
  console.log(`  B. endDate!=lastRecord+最後一張: ${issuesB.length}`);
  console.log(`  C. 非最後一張 (不影響FLAG): ${issuesC.length}`);

  if (issuesA.length > 0) {
    console.log('\n================================================================');
    console.log(`  A. records 空 + 最後一張（FLAG 壞掉）: ${issuesA.length} 筆`);
    console.log('================================================================');
    for (const e of issuesA) console.log(e);
  }

  if (issuesB.length > 0) {
    console.log('\n================================================================');
    console.log(`  B. endDate != lastRecord + 最後一張: ${issuesB.length} 筆`);
    console.log('================================================================');
    for (const e of issuesB) console.log(e);
  }

  if (issuesC.length > 0) {
    console.log('\n================================================================');
    console.log(`  C. 非最後一張（不影響 FLAG）: ${issuesC.length} 筆`);
    console.log('================================================================');
    for (const e of issuesC) console.log(e);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
