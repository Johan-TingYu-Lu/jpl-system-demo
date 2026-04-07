/**
 * 查 548, 549 在 Sheets 計費/繳費的狀態，然後推送缺少的繳費紀錄
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { google } from 'googleapis';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

const TARGET_IDS = ['548', '549'];

function excelDateToStr(serial: number): string {
  if (!serial || serial < 1) return '';
  const d = new Date((serial - 25569) * 86400000);
  return d.toISOString().split('T')[0];
}

function dateToExcelSerial(d: Date): number {
  return Math.floor((d.getTime() / 86400000) + 25569);
}

function colToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

async function go() {
  // 1. Read billing dates sheet
  const billingRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SID, range: "'計費日期表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const billingRows = (billingRes.data.values || []) as unknown[][];

  // 2. Read fee amounts sheet
  const feeRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SID, range: "'繳費金額表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const feeRows = (feeRes.data.values || []) as unknown[][];

  // 3. Read payment dates sheet
  const payRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SID, range: "'繳費日期表'!A:V", valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const payRows = (payRes.data.values || []) as unknown[][];

  for (const sid of TARGET_IDS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Sheets status for ${sid}`);
    console.log(`${'='.repeat(60)}`);

    // Billing dates
    const billingRow = billingRows.find(r => String(r[0]).trim() === sid);
    if (billingRow) {
      const invoiceCount = billingRow[3];
      console.log(`\nBilling dates: invoice count = ${invoiceCount}`);
      for (let c = 4; c < billingRow.length; c += 2) {
        const startS = billingRow[c] as number;
        const endS = billingRow[c + 1] as number;
        if (!startS) break;
        console.log(`  #${(c - 4) / 2 + 1}: ${excelDateToStr(startS)} ~ ${excelDateToStr(endS)}`);
      }
    }

    // Fee amounts
    const feeRow = feeRows.find(r => String(r[0]).trim() === sid);
    const feeRowIdx = feeRows.findIndex(r => String(r[0]).trim() === sid);
    if (feeRow) {
      const totalPaid = feeRow[3];
      const feeCount = feeRow[5];
      console.log(`\nFee amounts: total paid = $${totalPaid}, fee count = ${feeCount}`);
      for (let c = 6; c < feeRow.length; c++) {
        if (feeRow[c]) console.log(`  #${c - 5}: $${feeRow[c]}`);
      }
    }

    // Payment dates
    const payRow = payRows.find(r => String(r[0]).trim() === sid);
    const payRowIdx = payRows.findIndex(r => String(r[0]).trim() === sid);
    if (payRow) {
      const totalPayCount = payRow[3];
      const paidCount = payRow[4];
      console.log(`\nPayment dates: payment count(col3) = ${totalPayCount}, paid count(col4) = ${paidCount}`);
      for (let c = 6; c < payRow.length; c++) {
        const serial = payRow[c] as number;
        if (serial) console.log(`  #${c - 5}: ${excelDateToStr(serial)} (${serial})`);
      }
    }

    // DB invoices for 114 year (26- prefix)
    const enrollment = await prisma.enrollment.findUnique({
      where: { sheetsId: sid },
      include: {
        invoices: {
          where: { serialNumber: { startsWith: '26-' } },
          orderBy: { startDate: 'asc' },
          include: {
            payments: { select: { paymentDate: true } },
          },
        },
      },
    });

    if (enrollment) {
      const invoiceCount114 = enrollment.invoices.length;
      const paidInvoices114 = enrollment.invoices.filter(i => i.status === 'paid').length;
      console.log(`\nDB 114-year invoices: ${invoiceCount114} total, ${paidInvoices114} paid`);

      // Compare
      const sheetFeeCount = Number(feeRow?.[5] ?? 0);
      const sheetBillingCount = Number(billingRow?.[3] ?? 0);

      console.log(`\nGAP ANALYSIS:`);
      console.log(`  Sheet billing dates count: ${sheetBillingCount}`);
      console.log(`  Sheet fee amounts count:   ${sheetFeeCount}`);
      console.log(`  DB 114 invoices:           ${invoiceCount114}`);
      console.log(`  DB 114 paid:               ${paidInvoices114}`);

      if (paidInvoices114 > sheetFeeCount) {
        console.log(`\n  >>> MISSING ${paidInvoices114 - sheetFeeCount} payment records in Sheets!`);
        console.log(`  >>> Need to push payments #${sheetFeeCount + 1} through #${paidInvoices114}`);

        // Find the payment dates for the missing ones
        const paidInvoices = enrollment.invoices.filter(i => i.status === 'paid');
        for (let i = sheetFeeCount; i < paidInvoices.length; i++) {
          const inv = paidInvoices[i];
          const payDate = inv.payments[0]?.paymentDate;
          console.log(`  Push #${i + 1}: ${inv.serialNumber} $${inv.amount} paid:${payDate?.toISOString().split('T')[0] ?? '?'}`);
        }
      }
    }
  }
}

go()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
