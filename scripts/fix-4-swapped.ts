/**
 * fix-4-swapped.ts — 以 Sheet 為準，交換 491 #2↔#3 和 607 #1↔#2 的日期資料
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { readSheet } from '../src/lib/sheets';

const SPREADSHEET_ID = '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I';
const BILLING_DATE_START_COL = 4;
const PAYMENT_DATE_START_COL = 6;

function serialToUTCDate(s: number): Date {
  return new Date((s - 25569) * 86400000);
}
function cellNum(row: unknown[] | undefined, col: number): number {
  if (!row) return 0;
  const v = row[col];
  return (v !== undefined && v !== null && v !== '') ? Number(v) : 0;
}
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const [billingRows, payDateRows] = await Promise.all([
    readSheet(`'計費日期表'!A:BZ`, SPREADSHEET_ID),
    readSheet(`'繳費日期表'!A:BZ`, SPREADSHEET_ID),
  ]);
  const toMap = (rows: unknown[][]) => {
    const m: Record<string, unknown[]> = {};
    for (const r of rows) { const id = String(r[0] ?? '').trim(); if (/^\d+$/.test(id)) m[id] = r; }
    return m;
  };
  const bMap = toMap(billingRows);
  const pMap = toMap(payDateRows);

  for (const sid of ['491', '607']) {
    const invs = await prisma.invoice.findMany({
      where: { enrollment: { sheetsId: sid }, serialNumber: { startsWith: '26-' } },
      include: {
        enrollment: { select: { sheetsId: true, person: { select: { name: true } } } },
        payments: { select: { id: true } },
      },
      orderBy: [{ startDate: 'asc' }, { serialNumber: 'asc' }],
    });

    const name = invs[0].enrollment.person.name;
    console.log(`\n--- ${sid} ${name} ---`);

    for (let i = 0; i < invs.length; i++) {
      const inv = invs[i];
      const bStart = cellNum(bMap[sid], BILLING_DATE_START_COL + i * 2);
      const bEnd = cellNum(bMap[sid], BILLING_DATE_START_COL + i * 2 + 1);
      const sPay = cellNum(pMap[sid], PAYMENT_DATE_START_COL + i);

      if (bStart < 1000 || bEnd < 1000) continue;

      const newStart = serialToUTCDate(bStart);
      const newEnd = serialToUTCDate(bEnd);
      const newPay = sPay > 1000 ? serialToUTCDate(sPay) : null;

      const changed =
        fmt(inv.startDate) !== fmt(newStart) ||
        fmt(inv.endDate) !== fmt(newEnd) ||
        (newPay && (!inv.paidDate || fmt(inv.paidDate) !== fmt(newPay)));

      if (changed) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            startDate: newStart,
            endDate: newEnd,
            ...(newPay ? { paidDate: newPay } : {}),
          },
        });

        // Update payment record date too
        if (newPay && inv.payments.length > 0) {
          await prisma.payment.update({
            where: { id: inv.payments[0].id },
            data: { paymentDate: newPay },
          });
        }

        await prisma.auditLog.create({
          data: {
            tableName: 'invoices',
            recordId: inv.id,
            action: 'UPDATE',
            beforeData: { startDate: fmt(inv.startDate), endDate: fmt(inv.endDate), paidDate: inv.paidDate ? fmt(inv.paidDate) : null },
            afterData: { startDate: fmt(newStart), endDate: fmt(newEnd), paidDate: newPay ? fmt(newPay) : null },
            changedBy: 'system',
            reason: '以Sheet為準修正順序對調的日期',
          },
        });

        console.log(`  ✅ #${i + 1} ${inv.serialNumber}: ${fmt(inv.startDate)}~${fmt(inv.endDate)} → ${fmt(newStart)}~${fmt(newEnd)}${newPay && inv.paidDate && fmt(inv.paidDate) !== fmt(newPay) ? ` | 繳費日 ${fmt(inv.paidDate)} → ${fmt(newPay)}` : ''}`);
      } else {
        console.log(`  ⏭️  #${i + 1} ${inv.serialNumber}: 已一致`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
