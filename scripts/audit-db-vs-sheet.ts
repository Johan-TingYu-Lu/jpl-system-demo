/**
 * audit-db-vs-sheet.ts — 逐筆比對 DB invoices vs Google Sheets 三張表
 *
 * 比對項目：
 *   1. 計費日期表：startDate / endDate
 *   2. 繳費金額表：金額
 *   3. 繳費日期表：繳費日期
 *
 * 輸出：TSV 格式，每筆 invoice 一行，標記差異類型
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { readSheet } from '../src/lib/sheets';

const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';

// 114 學年 Sheet 格式（from year-config.ts）
const BILLING_DATE_START_COL = 4;   // col E: date pairs start
const FEE_AMOUNT_START_COL = 6;     // col G: amounts start
const PAYMENT_DATE_START_COL = 6;   // col G: payment dates start

// ── helpers ──────────────────────────────────────────────

function serialToDateStr(serial: number): string {
  if (!serial || serial < 1000) return '';
  const ms = (serial - 25569) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function dateToSerial(d: Date): number {
  const utcDays = Math.round(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000,
  );
  return utcDays + 25569;
}

function fmt(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

function cellNum(row: unknown[] | undefined, col: number): number {
  if (!row) return 0;
  const v = row[col];
  if (v === undefined || v === null || v === '') return 0;
  return Number(v);
}

// ── main ─────────────────────────────────────────────────

async function main() {
  // 1. Load all 114-year invoices ordered by student → date
  const allInvs = await prisma.invoice.findMany({
    where: { serialNumber: { startsWith: '26-' } },
    include: {
      enrollment: {
        select: {
          sheetsId: true,
          className: true,
          subject: true,
          person: { select: { name: true } },
        },
      },
      payments: {
        select: { amount: true, method: true, paymentDate: true },
        orderBy: { paymentDate: 'asc' },
      },
    },
    orderBy: [
      { enrollmentId: 'asc' },
      { startDate: 'asc' },
      { serialNumber: 'asc' },
    ],
  });

  // group by sheetsId, preserving order → position = index+1
  const byStudent: Record<string, typeof allInvs> = {};
  for (const inv of allInvs) {
    const sid = inv.enrollment.sheetsId;
    (byStudent[sid] ??= []).push(inv);
  }

  // 2. Read 3 sheets
  const [billingRows, amtRows, payDateRows] = await Promise.all([
    readSheet(`'計費日期表'!A:BZ`, SPREADSHEET_ID),
    readSheet(`'繳費金額表'!A:BZ`, SPREADSHEET_ID),
    readSheet(`'繳費日期表'!A:BZ`, SPREADSHEET_ID),
  ]);

  const toMap = (rows: unknown[][]) => {
    const m: Record<string, unknown[]> = {};
    for (const r of rows) {
      const id = String(r[0] ?? '').trim();
      if (id && /^\d+$/.test(id)) m[id] = r;
    }
    return m;
  };
  const billingMap = toMap(billingRows);
  const amtMap = toMap(amtRows);
  const payDateMap = toMap(payDateRows);

  // 3. Compare line by line
  type Issue =
    | 'billing_start_diff'
    | 'billing_end_diff'
    | 'billing_missing'
    | 'amount_diff'
    | 'amount_db_only'
    | 'amount_sheet_only'
    | 'paydate_diff'
    | 'paydate_db_only'
    | 'paydate_sheet_only'
    | 'status_mismatch';

  interface Row {
    sid: string;
    name: string;
    className: string;
    subject: string;
    serial: string;
    hash: string;
    pos: number;
    dbStatus: string;
    dbAmount: number;
    dbStart: string;
    dbEnd: string;
    dbPaidDate: string;
    dbPayMethod: string;
    sheetStart: string;
    sheetEnd: string;
    sheetAmount: number | string;
    sheetPayDate: string;
    issues: Issue[];
    details: string;
  }

  const rows: Row[] = [];
  let okCount = 0;

  for (const [sid, invs] of Object.entries(byStudent)) {
    const bRow = billingMap[sid];
    const aRow = amtMap[sid];
    const pRow = payDateMap[sid];
    const name = invs[0].enrollment.person.name;
    const className = invs[0].enrollment.className;
    const subject = invs[0].enrollment.subject;

    for (let i = 0; i < invs.length; i++) {
      const inv = invs[i];
      // Sheet 位置用 serial 的 sequence number（最後兩碼）決定
      const seqMatch = inv.serialNumber.match(/-(\d{2})$/);
      const pos = seqMatch ? parseInt(seqMatch[1], 10) : i + 1;
      const sheetIdx = pos - 1; // 0-based
      const issues: Issue[] = [];
      const details: string[] = [];

      // ── 計費日期表 ──
      const bStartCol = BILLING_DATE_START_COL + sheetIdx * 2;
      const bEndCol = bStartCol + 1;
      const sheetStartSerial = cellNum(bRow, bStartCol);
      const sheetEndSerial = cellNum(bRow, bEndCol);
      const sheetStart = serialToDateStr(sheetStartSerial);
      const sheetEnd = serialToDateStr(sheetEndSerial);
      const dbStartSerial = dateToSerial(inv.startDate);
      const dbEndSerial = dateToSerial(inv.endDate);

      if (sheetStartSerial === 0 && sheetEndSerial === 0) {
        issues.push('billing_missing');
        details.push('Sheet計費日期空白');
      } else {
        if (dbStartSerial !== sheetStartSerial) {
          issues.push('billing_start_diff');
          const diff = dbStartSerial - sheetStartSerial;
          details.push(`起日差${diff > 0 ? '+' : ''}${diff}天`);
        }
        if (dbEndSerial !== sheetEndSerial) {
          issues.push('billing_end_diff');
          const diff = dbEndSerial - sheetEndSerial;
          details.push(`迄日差${diff > 0 ? '+' : ''}${diff}天`);
        }
      }

      // ── 繳費金額表 ──
      const aCol = FEE_AMOUNT_START_COL + sheetIdx;
      const sheetAmtRaw = aRow ? aRow[aCol] : undefined;
      const sheetAmt =
        sheetAmtRaw !== undefined && sheetAmtRaw !== null && sheetAmtRaw !== ''
          ? Number(sheetAmtRaw)
          : NaN;
      const hasSheetAmt = !isNaN(sheetAmt) && sheetAmt > 0;

      if (inv.status === 'paid' && !hasSheetAmt) {
        issues.push('amount_db_only');
        details.push(`DB已付$${inv.amount}但Sheet金額=${sheetAmtRaw ?? '空'}`);
      } else if (inv.status !== 'paid' && hasSheetAmt) {
        issues.push('amount_sheet_only');
        details.push(`DB未付但Sheet有金額$${sheetAmt}`);
      } else if (inv.status === 'paid' && hasSheetAmt && sheetAmt !== inv.amount) {
        issues.push('amount_diff');
        details.push(`金額不符DB=$${inv.amount} Sheet=$${sheetAmt}`);
      }

      // ── 繳費日期表 ──
      const pCol = PAYMENT_DATE_START_COL + sheetIdx;
      const sheetPayRaw = pRow ? pRow[pCol] : undefined;
      const sheetPaySerial =
        sheetPayRaw !== undefined && sheetPayRaw !== null && sheetPayRaw !== ''
          ? Number(sheetPayRaw)
          : 0;
      const sheetPayDate =
        sheetPaySerial > 1000 ? serialToDateStr(sheetPaySerial) : '';
      const dbPayDate = fmt(inv.paidDate);
      const dbPayMethod = inv.payments[0]?.method ?? '';

      if (inv.status === 'paid' && !sheetPayDate) {
        issues.push('paydate_db_only');
        details.push(`DB已付${dbPayDate || '(無日期)'}但Sheet繳費日期空`);
      } else if (inv.status !== 'paid' && sheetPayDate) {
        issues.push('paydate_sheet_only');
        details.push(`DB未付但Sheet有繳費日期${sheetPayDate}`);
      } else if (dbPayDate && sheetPayDate && dbPayDate !== sheetPayDate) {
        issues.push('paydate_diff');
        details.push(`繳費日期不符DB=${dbPayDate} Sheet=${sheetPayDate}`);
      }

      // ── status cross-check ──
      if (inv.status === 'paid' && !hasSheetAmt && !sheetPayDate) {
        // already covered above
      } else if (inv.status === 'draft' && hasSheetAmt && sheetPayDate) {
        issues.push('status_mismatch');
        details.push('DB=draft但Sheet已繳費');
      }

      if (issues.length === 0) {
        okCount++;
      } else {
        rows.push({
          sid,
          name,
          className,
          subject,
          serial: inv.serialNumber,
          hash: inv.hashCode,
          pos,
          dbStatus: inv.status,
          dbAmount: inv.amount,
          dbStart: fmt(inv.startDate),
          dbEnd: fmt(inv.endDate),
          dbPaidDate: dbPayDate,
          dbPayMethod: dbPayMethod,
          sheetStart,
          sheetEnd,
          sheetAmount: hasSheetAmt ? sheetAmt : String(sheetAmtRaw ?? ''),
          sheetPayDate,
          issues,
          details: details.join('; '),
        });
      }
    }
  }

  // 4. Output header
  const header = [
    '識別號',
    '姓名',
    '班別',
    '科目',
    '序號',
    'Hash',
    '位置',
    'DB狀態',
    'DB金額',
    'DB起日',
    'DB迄日',
    'DB繳費日',
    'DB繳費方式',
    'Sheet起日',
    'Sheet迄日',
    'Sheet繳費金額',
    'Sheet繳費日',
    '問題類型',
    '差異說明',
  ].join('\t');

  console.log(header);

  for (const r of rows) {
    console.log(
      [
        r.sid,
        r.name,
        r.className,
        r.subject,
        r.serial,
        r.hash,
        r.pos,
        r.dbStatus,
        r.dbAmount,
        r.dbStart,
        r.dbEnd,
        r.dbPaidDate,
        r.dbPayMethod,
        r.sheetStart,
        r.sheetEnd,
        r.sheetAmount,
        r.sheetPayDate,
        r.issues.join(','),
        r.details,
      ].join('\t'),
    );
  }

  // 5. Summary to stderr
  const issueCounts: Record<string, number> = {};
  for (const r of rows) {
    for (const iss of r.issues) {
      issueCounts[iss] = (issueCounts[iss] || 0) + 1;
    }
  }

  console.error(`\n========================================`);
  console.error(`  DB vs Sheet 逐筆審計結果（114 學年）`);
  console.error(`========================================`);
  console.error(`  總 invoice 數: ${allInvs.length}`);
  console.error(`  ✅ 完全一致: ${okCount}`);
  console.error(`  ❌ 有差異: ${rows.length}`);
  console.error(`\n  --- 差異類型統計 ---`);
  const issueLabels: Record<string, string> = {
    billing_start_diff: '計費起日不同',
    billing_end_diff: '計費迄日不同',
    billing_missing: 'Sheet計費日期空白',
    amount_diff: '繳費金額不符',
    amount_db_only: 'DB已付但Sheet無金額',
    amount_sheet_only: 'DB未付但Sheet有金額',
    paydate_diff: '繳費日期不符',
    paydate_db_only: 'DB已付但Sheet無繳費日期',
    paydate_sheet_only: 'DB未付但Sheet有繳費日期',
    status_mismatch: '狀態不一致(draft但Sheet已繳)',
  };
  for (const [iss, cnt] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
    console.error(`    ${issueLabels[iss] ?? iss}: ${cnt} 筆`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
