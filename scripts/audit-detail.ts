/**
 * audit-detail.ts — 視覺化列出每位學生的上課日期 + 收費單區間
 *
 * 用法：npx tsx scripts/audit-detail.ts [A|B]
 */
import 'dotenv/config';
import pg from 'pg';

async function main() {
  const filterPlan = process.argv[2]?.toUpperCase(); // 'A' or 'B' or undefined (all)

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. 取得所有 active enrollment + 費率資訊
  const { rows: enrollments } = await client.query(`
    SELECT e.id, e.sheets_id, e.class_name, e.class_code, e.status,
           p.name,
           rc.name as plan_name, rc.full_session_fee, rc.half_session_fee,
           rc.settlement_sessions
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    LEFT JOIN classes c ON c.code = e.class_code
    LEFT JOIN rate_configs rc ON c.rate_config_id = rc.id
    WHERE e.status != '永久停止'
    ORDER BY e.sheets_id::int
  `);

  // 2. 判斷方案（跟 rate-resolver 邏輯一致）
  function resolvePlan(e: any): { plan: string; settlementY: number; planAmount: number } {
    const cn = e.class_name || '';
    if (cn.includes('(115)') || cn.includes('高三班')) {
      return { plan: 'A', settlementY: 8, planAmount: 3000 };
    }
    // Default to B
    return { plan: 'B', settlementY: 10, planAmount: 4000 };
  }

  // 3. 取得所有出勤
  const { rows: allAtt } = await client.query(`
    SELECT ma.enrollment_id, ma.year, ma.month, ma.days
    FROM monthly_attendance ma
    ORDER BY ma.enrollment_id, ma.year, ma.month
  `);
  const attMap = new Map<number, { year: number; month: number; days: number[] }[]>();
  for (const a of allAtt) {
    if (!attMap.has(a.enrollment_id)) attMap.set(a.enrollment_id, []);
    attMap.get(a.enrollment_id)!.push(a);
  }

  // 4. 取得所有 invoices
  const { rows: allInv } = await client.query(`
    SELECT i.enrollment_id, i.serial_number, i.start_date, i.end_date,
           i.amount, i.status, i.total_y, i.yy_count, i.y_count, i.note
    FROM invoices i
    ORDER BY i.enrollment_id, i.start_date
  `);
  const invMap = new Map<number, any[]>();
  for (const inv of allInv) {
    if (!invMap.has(inv.enrollment_id)) invMap.set(inv.enrollment_id, []);
    invMap.get(inv.enrollment_id)!.push(inv);
  }

  // 5. 視覺化
  const statusSymbol: Record<number, string> = {
    0: '·',  // 無
    1: 'V',  // 請假
    2: 'Y',  // 半堂
    3: '▓',  // 全堂 YY
  };

  for (const e of enrollments) {
    const { plan, settlementY, planAmount } = resolvePlan(e);

    if (filterPlan && plan !== filterPlan) continue;

    const attMonths = attMap.get(e.id) || [];
    const invoices = invMap.get(e.id) || [];

    // 收集所有 billable 日期 + Y 值
    const billableDates: { date: string; y: number; code: number }[] = [];
    for (const m of attMonths) {
      for (let d = 0; d < 31; d++) {
        const code = m.days[d];
        if (code === 2 || code === 3) {
          const dt = new Date(m.year, m.month - 1, d + 1);
          if (dt.getMonth() !== m.month - 1) continue; // skip invalid dates
          const ds = `${m.year}/${String(m.month).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`;
          billableDates.push({ date: ds, y: code === 3 ? 2 : 1, code });
        }
      }
    }

    const totalY = billableDates.reduce((s, b) => s + b.y, 0);
    const expectedCount = Math.floor(totalY / settlementY);
    const unbilledY = totalY - (invoices.length * settlementY);
    const totalRevenue = invoices.reduce((s: number, i: any) => s + i.amount, 0);

    // 檢核結果
    const check1 = expectedCount === invoices.length ? '✅' : '❌';
    const check3 = unbilledY >= 0 && unbilledY < settlementY ? '✅' : '❌';

    console.log('');
    console.log(`${'═'.repeat(80)}`);
    console.log(`${e.sheets_id} ${e.name} | ${e.class_name} | 方案${plan} | ${e.class_code}科`);
    console.log(`${'─'.repeat(80)}`);

    // 月曆視覺化
    const monthKeys = new Set<string>();
    for (const m of attMonths) monthKeys.add(`${m.year}/${String(m.month).padStart(2, '0')}`);
    // 也加入 invoice 涵蓋的月份
    for (const inv of invoices) {
      const sd = new Date(inv.start_date);
      const ed = new Date(inv.end_date);
      let y = sd.getFullYear(), m = sd.getMonth() + 1;
      while (y < ed.getFullYear() || (y === ed.getFullYear() && m <= ed.getMonth() + 1)) {
        monthKeys.add(`${y}/${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    const sortedMonths = [...monthKeys].sort();

    // 建立 invoice 查找表（哪些日期落在哪張 invoice 內）
    function findInvoiceIdx(dateStr: string): number {
      const d = new Date(dateStr.replace(/\//g, '-'));
      for (let i = 0; i < invoices.length; i++) {
        const sd = new Date(invoices[i].start_date);
        const ed = new Date(invoices[i].end_date);
        sd.setHours(0, 0, 0, 0);
        ed.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        if (d >= sd && d <= ed) return i + 1;
      }
      return 0; // 未被收費
    }

    // 按月列出出勤，標注屬於第幾張 invoice
    console.log('  出勤紀錄（▓=YY  Y=Y  V=請假  ·=無）');
    console.log('');
    for (const mk of sortedMonths) {
      const [ys, ms] = mk.split('/').map(Number);
      const ma = attMonths.find(a => a.year === ys && a.month === ms);
      if (!ma) continue;

      const daysInMonth = new Date(ys, ms, 0).getDate();
      let line1 = `  ${mk} │ `;  // 日期標籤
      let line2 = `         │ `;  // 狀態符號
      let line3 = `         │ `;  // invoice 歸屬

      for (let d = 0; d < daysInMonth; d++) {
        const code = ma.days[d];
        const dayNum = String(d + 1).padStart(2, ' ');
        const sym = statusSymbol[code] || '·';
        line1 += `${dayNum} `;

        if (code === 3) {
          const ds = `${ys}/${String(ms).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`;
          const idx = findInvoiceIdx(ds);
          line2 += `▓▓ `;
          line3 += idx > 0 ? `#${String(idx).padStart(1)} ` : ' · ';
        } else if (code === 2) {
          const ds = `${ys}/${String(ms).padStart(2, '0')}/${String(d + 1).padStart(2, '0')}`;
          const idx = findInvoiceIdx(ds);
          line2 += ` Y `;
          line3 += idx > 0 ? `#${String(idx).padStart(1)} ` : ' · ';
        } else if (code === 1) {
          line2 += ` V `;
          line3 += '   ';
        } else {
          line2 += ` · `;
          line3 += '   ';
        }
      }
      console.log(line1);
      console.log(line2);
      console.log(line3);
      console.log('');
    }

    // Invoice 清單
    console.log(`  收費單（共 ${invoices.length} 張）`);
    console.log(`  ${'─'.repeat(70)}`);
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const sd = new Date(inv.start_date).toISOString().slice(0, 10).replace(/-/g, '/');
      const ed = new Date(inv.end_date).toISOString().slice(0, 10).replace(/-/g, '/');
      const note = inv.note ? ` ${inv.note}` : '';
      const status = inv.status === 'paid' ? '已繳' : inv.status === 'draft' ? 'DRAFT' : inv.status;
      console.log(`  #${i + 1} ${inv.serial_number} | ${sd}~${ed} | ${inv.total_y}Y (${inv.yy_count}YY+${inv.y_count}Y) | $${inv.amount} | ${status}${note}`);
    }

    // 檢核摘要
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  totalY=${totalY} | 期望${expectedCount}張/實際${invoices.length}張 ${check1} | 餘額${unbilledY}Y ${check3} | 收入$${totalRevenue}`);
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
