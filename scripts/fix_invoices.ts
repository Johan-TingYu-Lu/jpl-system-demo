import * as dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Helper: collect attendance dates
  function collectDates(attRows: any[], afterDate: string, includeEqual = false): { date: string, status: number }[] {
    const result: { date: string, status: number }[] = [];
    for (const a of attRows) {
      for (let d = 0; d < a.days.length; d++) {
        if (a.days[d] >= 2) {
          const dateStr = `${a.year}/${String(a.month).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`;
          if (includeEqual ? dateStr >= afterDate : dateStr > afterDate) {
            result.push({ date: dateStr, status: a.days[d] });
          }
        }
      }
    }
    return result;
  }

  // Helper: accumulate 10Y with optional carry-over
  function accumulate10Y(dates: { date: string, status: number }[], carryOverDate: string | null): any[] {
    let yAccum = 0;
    const records: any[] = [];

    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];

      if (i === 0 && carryOverDate && d.date === carryOverDate) {
        records.push({ date: d.date, status: d.status, yUsed: 1, fee: 400, isSplit: true });
        yAccum = 1;
        continue;
      }

      const yVal = d.status === 3 ? 2 : 1;
      if (yAccum + yVal > 10) {
        records.push({ date: d.date, status: d.status, yUsed: 10 - yAccum, fee: (10 - yAccum) * 400, isSplit: true });
        yAccum = 10;
        break;
      }
      yAccum += yVal;
      records.push({ date: d.date, status: d.status, yUsed: yVal, fee: d.status === 3 ? 800 : 400, isSplit: false });
      if (yAccum >= 10) break;
    }

    return yAccum >= 10 ? records : [];
  }

  // Helper: create invoice
  async function createInvoice(enrollmentId: number, sheetsId: string, records: any[], note: string | null) {
    const startDate = records[0].date.replace(/\//g, '-');
    const endDate = records[records.length - 1].date.replace(/\//g, '-');
    const amount = records.reduce((s: number, r: any) => s + r.fee, 0);
    const yyCount = records.filter((r: any) => r.status === 3 && !r.isSplit).length;
    const yCount = records.filter((r: any) => r.isSplit || r.status === 2).length;
    const endMonth = String(parseInt(endDate.split('-')[1])).padStart(2, '0');

    const existing = await client.query('SELECT count(*)::int as cnt FROM invoices WHERE enrollment_id = $1', [enrollmentId]);
    const seq = existing.rows[0].cnt + 1;
    const serial = `26-${sheetsId}-${endMonth}-N-${String(seq).padStart(2, '0')}`;

    const hashInput = `${serial}|${sheetsId}|${amount}|${endDate}|物理`;
    const hashCode = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 8).toUpperCase();

    const ins = await client.query(`
      INSERT INTO invoices (enrollment_id, serial_number, hash_code, start_date, end_date, amount, yy_count, y_count, total_y, records, note, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 10, $9, $10, 'draft')
      RETURNING id
    `, [enrollmentId, serial, hashCode, startDate, endDate, amount, yyCount, yCount, JSON.stringify(records), note]);

    return { id: ins.rows[0].id, serial, startDate, endDate, amount };
  }

  // ============================================================
  // TASK 1: Sync 03/14 attendance for 628, 638, 645
  // ============================================================
  console.log('=== TASK 1: Sync 03/14 attendance ===');

  for (const sheetsId of ['628', '638', '645']) {
    const enr = await client.query("SELECT id FROM enrollments WHERE sheets_id = $1 AND class_code = 'N'", [sheetsId]);
    const eid = enr.rows[0].id;

    const att = await client.query('SELECT id, days FROM monthly_attendance WHERE enrollment_id = $1 AND year = 2026 AND month = 3', [eid]);

    if (att.rows.length === 0) {
      const days = new Array(31).fill(0);
      days[6] = 3;  // 03/07 = YY
      days[13] = 3; // 03/14 = YY
      await client.query('INSERT INTO monthly_attendance (enrollment_id, year, month, days) VALUES ($1, 2026, 3, $2)', [eid, days]);
      console.log(`  ${sheetsId}: created March attendance with 03/07 + 03/14`);
    } else {
      const days = att.rows[0].days;
      if (days[13] === 0) {
        days[13] = 3;
        await client.query('UPDATE monthly_attendance SET days = $1 WHERE id = $2', [days, att.rows[0].id]);
        console.log(`  ${sheetsId}: added 03/14=YY`);
      } else {
        console.log(`  ${sheetsId}: 03/14 already set`);
      }
    }
  }

  // ============================================================
  // TASK 2: Generate invoices for 628, 638, 645
  // ============================================================
  console.log('\n=== TASK 2: Generate invoices for 628, 638, 645 ===');

  for (const sheetsId of ['628', '638', '645']) {
    const enr = await client.query("SELECT id FROM enrollments WHERE sheets_id = $1 AND class_code = 'N'", [sheetsId]);
    const eid = enr.rows[0].id;

    const lastInv = await client.query("SELECT records FROM invoices WHERE enrollment_id = $1 AND status = 'paid' ORDER BY end_date DESC LIMIT 1", [eid]);
    const lastRecords = lastInv.rows[0].records;
    const lastDate = lastRecords[lastRecords.length - 1].date;

    const att = await client.query('SELECT year, month, days FROM monthly_attendance WHERE enrollment_id = $1 ORDER BY year, month', [eid]);
    const dates = collectDates(att.rows, lastDate);
    const records = accumulate10Y(dates, null);

    if (records.length === 0) {
      console.log(`  ${sheetsId}: not enough Y`);
      continue;
    }

    const inv = await createInvoice(eid, sheetsId, records, null);
    console.log(`  OK ${sheetsId}_N: id=${inv.id} ${inv.serial} | ${inv.startDate}~${inv.endDate} | $${inv.amount}`);
    for (const r of records) console.log(`    ${r.date} ${r.status === 3 ? 'YY' : 'Y'} yUsed=${r.yUsed} $${r.fee} split=${r.isSplit}`);
  }

  // ============================================================
  // TASK 3: Fix 623
  // ============================================================
  console.log('\n=== TASK 3: Fix 623 ===');
  {
    const enr = await client.query("SELECT id FROM enrollments WHERE sheets_id = '623' AND class_code = 'N'", []);
    const eid = enr.rows[0].id;

    const del = await client.query("DELETE FROM invoices WHERE enrollment_id = $1 AND status = 'draft' RETURNING id, serial_number", [eid]);
    console.log(`  Deleted: ${del.rows.map((r: any) => '#' + r.id).join(', ')}`);

    const att = await client.query('SELECT year, month, days FROM monthly_attendance WHERE enrollment_id = $1 ORDER BY year, month', [eid]);
    const dates = collectDates(att.rows, '2026/01/01');
    console.log(`  Dates after 01/01: ${dates.map(d => d.date + '=' + (d.status === 3 ? 'YY' : 'Y')).join(', ')}`);

    const records = accumulate10Y(dates, null);
    const inv = await createInvoice(eid, '623', records, null);
    console.log(`  OK 623_N: id=${inv.id} ${inv.serial} | ${inv.startDate}~${inv.endDate} | $${inv.amount}`);
    for (const r of records) console.log(`    ${r.date} ${r.status === 3 ? 'YY' : 'Y'} yUsed=${r.yUsed} $${r.fee} split=${r.isSplit}`);
  }

  // ============================================================
  // TASK 4: Fix 546, 579, 611 with split carry-over
  // ============================================================
  console.log('\n=== TASK 4: Fix 546, 579, 611 (split logic) ===');

  const splitCases = [
    { sheetsId: '546', lastEnd: '2026/01/06' },
    { sheetsId: '579', lastEnd: '2026/01/27' },
    { sheetsId: '611', lastEnd: '2025/12/23' },
  ];

  for (const { sheetsId, lastEnd } of splitCases) {
    const enr = await client.query("SELECT id FROM enrollments WHERE sheets_id = $1 AND class_code = 'N'", [sheetsId]);
    const eid = enr.rows[0].id;

    const del = await client.query("DELETE FROM invoices WHERE enrollment_id = $1 AND status = 'draft' RETURNING id, serial_number", [eid]);
    console.log(`  Deleted for ${sheetsId}: ${del.rows.map((r: any) => '#' + r.id).join(', ')}`);

    const att = await client.query('SELECT year, month, days FROM monthly_attendance WHERE enrollment_id = $1 ORDER BY year, month', [eid]);
    const dates = collectDates(att.rows, lastEnd, true);

    const records = accumulate10Y(dates, lastEnd);

    if (records.length === 0) {
      console.log(`  ${sheetsId}: not enough Y`);
      continue;
    }

    const firstRec = records[0];
    const lastRec = records[records.length - 1];
    let note: string | null = null;
    if (firstRec.isSplit || lastRec.isSplit) {
      const parts: string[] = [];
      if (firstRec.isSplit) parts.push(`${firstRec.date} 帶入 1Y`);
      if (lastRec.isSplit && lastRec !== firstRec) parts.push(`${lastRec.date} 帶出 1Y`);
      note = `拆分：${parts.join('；')}`;
    }

    const inv = await createInvoice(eid, sheetsId, records, note);
    console.log(`  OK ${sheetsId}_N: id=${inv.id} ${inv.serial} | ${inv.startDate}~${inv.endDate} | $${inv.amount}`);
    if (note) console.log(`    note: ${note}`);
    for (const r of records) console.log(`    ${r.date} ${r.status === 3 ? 'YY' : 'Y'} yUsed=${r.yUsed} $${r.fee} split=${r.isSplit}`);
  }

  await client.end();
  console.log('\nAll tasks completed');
}

main().catch(console.error);
