/**
 * GET /api/sync/compare-payment — 比對 Sheet 與 DB 的繳費狀態
 *
 * 三種差異：
 *   1. SHOULD_MARK_PAID — Sheet 有繳費日期，但 DB 仍是 draft/pending
 *   2. MISSING_IN_SHEET — DB 是 paid，但 Sheet 無繳費日期
 *   3. AMOUNT_MISMATCH — DB 金額與 Sheet 金額不同
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { readSheet } from '@/lib/sheets';
import { getYearConfig } from '@/lib/year-config';
import { serialToDate, formatDate } from '@/lib/attendance-utils';

export type DiscrepancyType = 'SHOULD_MARK_PAID' | 'MISSING_IN_SHEET' | 'AMOUNT_MISMATCH';

export interface PaymentDiscrepancy {
  sheetsId: string;
  name: string;
  className: string;
  dbSerial: string;
  dbInvoiceId: number;
  dbStatus: string;
  dbAmount: number;
  sheetAmount: number | null;
  sheetPaymentDate: string | null;
  discrepancyType: DiscrepancyType;
}

export interface ComparePaymentResult {
  success: boolean;
  totalDbInvoices: number;
  diffsCount: number;
  diffs: PaymentDiscrepancy[];
}

/**
 * Core comparison logic — exported so the page can call directly
 */
export async function comparePayments(): Promise<ComparePaymentResult> {
  const config = getYearConfig(114);
  if (!config) throw new Error('Year config 114 not found');

  const sid = config.spreadsheetId;
  const feeFmt = config.feeAmount;
  const payFmt = config.paymentDate;

  // 1. Read 繳費金額表 and 繳費日期表 from Sheets (in parallel)
  const [feeAmountRows, paymentDateRows] = await Promise.all([
    readSheet("'繳費金額表'!A:AZ", sid),
    readSheet("'繳費日期表'!A:AZ", sid),
  ]);

  // Build Sheet maps: sheetsId → amounts[], sheetsId → paymentDates[]
  const sheetAmountMap = new Map<string, number[]>();
  for (let r = 1; r < feeAmountRows.length; r++) {
    const row = feeAmountRows[r] as unknown[];
    const id = String(row[feeFmt.idCol] || '').trim();
    if (!id || !/^\d+$/.test(id)) continue;
    const count = parseInt(String(row[feeFmt.countCol] || '0'));
    const amounts: number[] = [];
    for (let i = 0; i < count; i++) {
      const val = row[feeFmt.amountsStartCol + i];
      amounts.push(typeof val === 'number' ? val : 0);
    }
    sheetAmountMap.set(id, amounts);
  }

  const sheetPayDateMap = new Map<string, (string | null)[]>();
  for (let r = 1; r < paymentDateRows.length; r++) {
    const row = paymentDateRows[r] as unknown[];
    const id = String(row[payFmt.idCol] || '').trim();
    if (!id || !/^\d+$/.test(id)) continue;
    const count = parseInt(String(row[payFmt.countCol] || '0'));
    const dates: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      const val = row[payFmt.datesStartCol + i];
      if (typeof val === 'number' && val > 0) {
        dates.push(formatDate(serialToDate(val)));
      } else {
        dates.push(null);
      }
    }
    sheetPayDateMap.set(id, dates);
  }

  // 2. Load all 114-year invoices from DB (serial starts with "26-")
  const dbInvoices = await prisma.invoice.findMany({
    where: {
      serialNumber: { startsWith: '26-' },
    },
    include: {
      enrollment: {
        select: {
          sheetsId: true,
          className: true,
          person: { select: { name: true } },
        },
      },
    },
    orderBy: [{ startDate: 'asc' }, { serialNumber: 'asc' }],
  });

  // 3. Group DB invoices by sheetsId, ordered by serial
  const dbBySheetsId = new Map<string, typeof dbInvoices>();
  for (const inv of dbInvoices) {
    const sid2 = inv.enrollment.sheetsId;
    const list = dbBySheetsId.get(sid2) || [];
    list.push(inv);
    dbBySheetsId.set(sid2, list);
  }

  // 4. Compare
  const diffs: PaymentDiscrepancy[] = [];

  for (const [sheetsId, invList] of dbBySheetsId) {
    const sheetAmounts = sheetAmountMap.get(sheetsId) || [];
    const sheetPayDates = sheetPayDateMap.get(sheetsId) || [];

    // Match DB invoices to Sheet by index (0-based invoice sequence)
    for (let i = 0; i < invList.length; i++) {
      const inv = invList[i];
      const sheetAmount = i < sheetAmounts.length ? sheetAmounts[i] : null;
      const sheetPayDate = i < sheetPayDates.length ? sheetPayDates[i] : null;

      const base: Omit<PaymentDiscrepancy, 'discrepancyType'> = {
        sheetsId,
        name: inv.enrollment.person.name,
        className: inv.enrollment.className,
        dbSerial: inv.serialNumber,
        dbInvoiceId: inv.id,
        dbStatus: inv.status,
        dbAmount: inv.amount,
        sheetAmount,
        sheetPaymentDate: sheetPayDate,
      };

      // Case 1: Sheet has payment date but DB is still draft
      if (sheetPayDate && (inv.status === 'draft' || inv.status === 'pending')) {
        diffs.push({ ...base, discrepancyType: 'SHOULD_MARK_PAID' });
        continue; // don't also flag amount mismatch for same row
      }

      // Case 2: DB is paid but Sheet has no payment record
      if (inv.status === 'paid' && !sheetPayDate) {
        diffs.push({ ...base, discrepancyType: 'MISSING_IN_SHEET' });
        continue;
      }

      // Case 3: Amount mismatch (only if both have amounts and they differ)
      if (sheetAmount !== null && sheetAmount !== 0 && sheetAmount !== inv.amount) {
        diffs.push({ ...base, discrepancyType: 'AMOUNT_MISMATCH' });
      }
    }
  }

  // Sort by sheetsId numeric
  diffs.sort((a, b) => parseInt(a.sheetsId) - parseInt(b.sheetsId));

  return {
    success: true,
    totalDbInvoices: dbInvoices.length,
    diffsCount: diffs.length,
    diffs,
  };
}

export async function GET() {
  try {
    const result = await comparePayments();
    return NextResponse.json(result);
  } catch (e) {
    console.error('compare-payment error:', e);
    return NextResponse.json(
      { success: false, error: String(e) },
      { status: 500 }
    );
  }
}
