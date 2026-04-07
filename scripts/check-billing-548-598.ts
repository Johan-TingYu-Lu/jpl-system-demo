/**
 * 比對 548 和 598 收費狀況 — 純 ASCII 輸出
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { google } from 'googleapis';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

const TARGET_IDS = ['548', '598'];

function excelDateToStr(serial: number): string {
  if (!serial || serial < 1) return '';
  const d = new Date((serial - 25569) * 86400000);
  return d.toISOString().split('T')[0];
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '--';
  const dt = new Date(d);
  return dt.toISOString().split('T')[0];
}

async function go() {
  const out: string[] = [];
  out.push('========================================');
  out.push('548 & 598 billing DB vs Sheets');
  out.push('========================================');

  // DB
  for (const sid of TARGET_IDS) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        person: { select: { name: true } },
        invoices: { orderBy: { createdAt: 'asc' }, select: { serialNumber: true, amount: true, status: true, startDate: true, endDate: true, yyCount: true, yCount: true, totalY: true, issuedDate: true, paidDate: true } },
        payments: { orderBy: { paymentDate: 'asc' }, select: { amount: true, paymentDate: true, method: true } },
        semesterFees: { orderBy: { academicYear: 'asc' }, select: { academicYear: true, semester: true, amount: true, feeDate: true, status: true } },
      },
    });
    if (!enrollment) { out.push(`${sid}: NOT FOUND in DB`); continue; }

    out.push(`\n=== DB: ${sid} ${enrollment.person.name} (${enrollment.className}) ===`);
    out.push(`Status: ${enrollment.status}`);

    out.push(`\nInvoices (${enrollment.invoices.length}):`);
    for (const inv of enrollment.invoices) {
      out.push(`  ${inv.serialNumber} | $${inv.amount} | ${fmtDate(inv.startDate)}~${fmtDate(inv.endDate)} | YY:${inv.yyCount} Y:${inv.yCount} totalY:${inv.totalY} | ${inv.status} | issued:${fmtDate(inv.issuedDate)} paid:${fmtDate(inv.paidDate)}`);
    }

    out.push(`\nPayments (${enrollment.payments.length}):`);
    for (const p of enrollment.payments) {
      out.push(`  $${p.amount} | ${fmtDate(p.paymentDate)} | ${p.method}`);
    }

    out.push(`\nSemesterFees (${enrollment.semesterFees.length}):`);
    for (const sf of enrollment.semesterFees) {
      out.push(`  ${sf.academicYear} sem${sf.semester} | $${sf.amount} | ${fmtDate(sf.feeDate)} | ${sf.status}`);
    }
  }

  // Sheets
  out.push('\n========================================');
  out.push('Google Sheets Data');
  out.push('========================================');

  // Summary sheet
  const summaryRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId: SID, range: "'學費收支總表'!A:AA", valueRenderOption: 'UNFORMATTED_VALUE' });
  const summaryRows = (summaryRes.data.values || []) as unknown[][];
  const sHeader = summaryRows[0] as string[];

  for (const sid of TARGET_IDS) {
    const row = summaryRows.find(r => String(r[0]).trim() === sid);
    if (!row) { out.push(`${sid}: NOT FOUND in summary sheet`); continue; }
    out.push(`\n--- Sheets Summary: ${sid} ---`);
    // Key columns with known positions
    out.push(`  Name: ${row[1]}`);
    out.push(`  Class: ${row[2]}`);
    out.push(`  col[5] total-outstanding: ${row[5]}`);
    out.push(`  col[6] total-balance: ${row[6]}`);
    out.push(`  col[7] total-paid-amount: ${row[7]}`);
    out.push(`  col[9] total-owed: ${row[9]}`);
    out.push(`  col[10] invoice-count: ${row[10]}`);
    out.push(`  col[11] paid-count: ${row[11]}`);
    out.push(`  col[12] unpaid-invoices-count: ${row[12]}`);
    out.push(`  col[13] unpaid-payments-count: ${row[13]}`);
    out.push(`  col[14] outstanding-count: ${row[14]}`);
    out.push(`  col[18] unit-fee: ${row[18]}`);
    out.push(`  col[19] balance: ${row[19]}`);
    // Misc fees
    out.push(`  col[23] upper-misc-amount: ${row[23] ?? ''}`);
    out.push(`  col[24] upper-misc-date: ${typeof row[24] === 'number' ? excelDateToStr(row[24] as number) : row[24] ?? ''}`);
    out.push(`  col[25] lower-misc-amount: ${row[25] ?? ''}`);
    out.push(`  col[26] lower-misc-date: ${typeof row[26] === 'number' ? excelDateToStr(row[26] as number) : row[26] ?? ''}`);
  }

  // Billing dates
  const billingRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId: SID, range: "'計費日期表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE' });
  const billingRows = (billingRes.data.values || []) as unknown[][];

  for (const sid of TARGET_IDS) {
    const row = billingRows.find(r => String(r[0]).trim() === sid);
    if (!row) { out.push(`\n${sid}: NOT FOUND in billing dates`); continue; }
    out.push(`\n--- Sheets Billing Dates: ${sid} ---`);
    out.push(`  Invoice count (col3): ${row[3]}`);
    const pairs: string[] = [];
    for (let c = 4; c < row.length; c += 2) {
      const startSerial = row[c] as number;
      const endSerial = row[c + 1] as number;
      if (!startSerial) break;
      pairs.push(`  #${(c - 4) / 2 + 1}: ${excelDateToStr(startSerial)} ~ ${excelDateToStr(endSerial)}`);
    }
    out.push(pairs.join('\n'));
  }

  // Fee amounts
  const feeAmtRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId: SID, range: "'繳費金額表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE' });
  const feeAmtRows = (feeAmtRes.data.values || []) as unknown[][];

  for (const sid of TARGET_IDS) {
    const row = feeAmtRows.find(r => String(r[0]).trim() === sid);
    if (!row) { out.push(`\n${sid}: NOT FOUND in fee amounts`); continue; }
    out.push(`\n--- Sheets Fee Amounts: ${sid} ---`);
    out.push(`  Total paid (col3): ${row[3]}`);
    out.push(`  Fee count (col5): ${row[5]}`);
    const amounts: string[] = [];
    for (let c = 6; c < row.length; c++) {
      if (row[c]) amounts.push(`  #${c - 5}: $${row[c]}`);
    }
    out.push(amounts.join('\n'));
  }

  // Payment dates
  const payDateRes = await sheetsApi.spreadsheets.values.get({ spreadsheetId: SID, range: "'繳費日期表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE' });
  const payDateRows = (payDateRes.data.values || []) as unknown[][];

  for (const sid of TARGET_IDS) {
    const row = payDateRows.find(r => String(r[0]).trim() === sid);
    if (!row) { out.push(`\n${sid}: NOT FOUND in payment dates`); continue; }
    out.push(`\n--- Sheets Payment Dates: ${sid} ---`);
    out.push(`  Total payment count (col3): ${row[3]}`);
    out.push(`  Paid count (col4): ${row[4]}`);
    const dates: string[] = [];
    for (let c = 6; c < row.length; c++) {
      const serial = row[c] as number;
      if (serial) dates.push(`  #${c - 5}: ${excelDateToStr(serial)}`);
    }
    out.push(dates.join('\n'));
  }

  out.push('\n========================================');

  const result = out.join('\n');
  fs.writeFileSync('scripts/billing-report.txt', result, 'utf-8');
  console.log(result);
}

go()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
