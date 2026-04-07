/**
 * pdf-renderer.ts — LaTeX 模板填充 + XeLaTeX 編譯
 *
 * 取代 generate-pdfs.ts 和 test-pdf.ts 的 inline LaTeX 方式
 *
 * v2: 路徑改 env + sessionInfo 動態化（修正方案 A 顯示錯誤）
 */
import prisma from './prisma';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { planFromRate } from './plan-config';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'templates/invoice.tex');
const OUTPUT_DIR = path.resolve(process.cwd(), 'generated_invoices_latex');

// 路徑改 env，fallback 到原硬編碼（向後相容）
const STAMP_DIR = process.env.STAMP_DIR || 'C:/Users/johan/Documents/NEW_SYSTEM/Stamp';
// Cloud Run 用 stamps/stamp_tax.jpg，本地用原檔名
const STAMP_TAX = fs.existsSync(path.resolve(STAMP_DIR, 'stamp_tax.jpg'))
  ? path.resolve(STAMP_DIR, 'stamp_tax.jpg')
  : path.resolve(STAMP_DIR, '印花稅 (1).jpg');
const STAMP_LARGE = fs.existsSync(path.resolve(STAMP_DIR, 'stamp_large.jpg'))
  ? path.resolve(STAMP_DIR, 'stamp_large.jpg')
  : path.resolve(STAMP_DIR, '大印數位檔.jpg');
const XELATEX_PATH = process.env.XELATEX_PATH || 'C:/Users/johan/AppData/Local/Programs/MiKTeX/miktex/bin/x64/xelatex.exe';
const FONT_DIR = process.env.FONT_DIR || 'C:/Users/johan/Documents/NEW_SYSTEM/jpl-app/fonts/';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jpl-app-28194680926.asia-east1.run.app';

function escTex(s: string): string {
  return s.replace(/[&%$#_{}~^\\]/g, c => {
    if (c === '~') return '\\textasciitilde{}';
    if (c === '^') return '\\textasciicircum{}';
    if (c === '\\') return '\\textbackslash{}';
    return `\\${c}`;
  });
}

/**
 * Expand records into display date slots.
 * - 5×YY (no splits): 5 dates, single row, no duplication
 * - Split case (Y+YY+YY+YY+YY+Y): YY=2 slots, Y=1 slot → 10 slots, 2 rows
 */
function expandRecordsToDateSlots(records: { date: string; yUsed: number; isSplit?: boolean }[]): string[] {
  const hasSplit = records.some(r => r.isSplit);
  if (!hasSplit) {
    // Pure 5×YY: just list each date once
    return records.map(r => r.date);
  }
  // Split case: YY gets 2 slots, Y gets 1 slot
  const slots: string[] = [];
  for (const r of records) {
    slots.push(r.date);
    if (r.yUsed === 2) {
      slots.push(r.date);
    }
  }
  return slots;
}

/**
 * Build the date table for the invoice.
 * Always 10 slots = 2 rows × 5 columns.
 */
function buildDateTable(dateSlots: string[], includeHeader: boolean): string {
  const displayDates = [...dateSlots];
  while (displayDates.length % 5 !== 0) displayDates.push('');

  let rows = '';
  for (let i = 0; i < displayDates.length; i += 5) {
    rows += displayDates.slice(i, i + 5)
      .map(d => d ? `\\large\\textbf{${d}}` : '')
      .join(' & ') + ' \\\\\n\\hline\n';
  }

  const header = includeHeader
    ? '\\multicolumn{5}{|c|}{\\Large\\textbf{上課紀錄}} \\\\\n\\hline\n'
    : '';

  return `\\begin{tabular}{|*{5}{>{\\centering\\arraybackslash}p{3.1cm}|}}\n\\hline\n${header}${rows}\\end{tabular}`;
}

/**
 * Generate split note text.
 * Only note the END split (last record truncated, remainder goes to next period).
 * The START split (carried from previous period) does NOT need a note.
 * Format: (註：MM/DD上課3小時，計費1.5hr，尚有1.5hr未記入本次收費，下次收取)
 */
function buildSplitNote(records: { date: string; yUsed: number; isSplit?: boolean }[]): string | null {
  const lastRec = records[records.length - 1];

  if (lastRec.isSplit) {
    const mm_dd = lastRec.date.split('/').slice(1).join('/');
    return `(註：${mm_dd}上課3小時，計費1.5hr，尚有1.5hr未記入本次收費，下次收取)`;
  }

  return null;
}

export interface RenderResult {
  success: boolean;
  pdfPath?: string;
  texPath?: string;
  error?: string;
}

export async function renderInvoicePdf(invoiceId: number): Promise<RenderResult> {
  // 1. Load invoice data
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      enrollment: {
        include: {
          person: { select: { name: true } },
        },
      },
    },
  });
  if (!invoice) return { success: false, error: 'Invoice not found' };

  const records = (invoice.records || []) as { date: string; status: number; yUsed: number; fee: number; isSplit?: boolean }[];
  if (!records.length) {
    return { success: false, error: 'No records data (historical invoice)' };
  }
  const dates = records.map(r => r.date);
  const name = invoice.enrollment.person.name;
  const subject = invoice.enrollment.subject;

  // 2. Compute display values
  const months = [...new Set(dates.map(d => d.split('/')[1]))].sort();
  const billYear = dates[0].split('/')[0];
  const billMonth = months.length > 1 ? `${months[0]}-${months[months.length - 1]}` : months[0];
  const qrUrl = `${APP_URL}/pay/${invoice.hashCode}`;
  const issuedDate = invoice.issuedDate
    ? `${invoice.issuedDate.getFullYear()}/${String(invoice.issuedDate.getMonth() + 1).padStart(2, '0')}/${String(invoice.issuedDate.getDate()).padStart(2, '0')}`
    : new Date().toISOString().slice(0, 10).replace(/-/g, '/');

  // sessionInfo: 動態計算（billing-engine 的 sessionInfoText 或 plan-config fallback）
  // records 裡已有實際出勤次數，但滿額發單時用方案預設值更準確
  const billingResult = (invoice as Record<string, unknown>).sessionInfoText as string | undefined;
  let sessionInfoText: string;
  if (billingResult) {
    sessionInfoText = billingResult;
  } else {
    // 從 rateConfig 反查 plan（需要 classCode → DB）
    const rateConfig = await prisma.rateConfig.findFirst({
      where: {
        classes: { some: { code: invoice.enrollment.classCode } },
      },
    });
    if (rateConfig) {
      const plan = planFromRate({
        fullSessionFee: rateConfig.fullSessionFee,
        halfSessionFee: rateConfig.halfSessionFee,
        settlementSessions: rateConfig.settlementSessions,
        hoursPerSession: rateConfig.hoursPerSession,
      });
      sessionInfoText = plan?.sessionInfoText ?? `${records.length}次${records.length * 3}H`;
    } else {
      // Ultimate fallback: 從 records 動態計算
      const totalHours = records.reduce((sum, r) => {
        if (r.isSplit) return sum + 1.5;
        return sum + (r.status === 3 ? 3.0 : 1.5);
      }, 0);
      sessionInfoText = `${records.length}次${totalHours}H`;
    }
  }

  // Expand records to date slots: YY=2 slots, Y=1 slot
  const dateSlots = expandRecordsToDateSlots(records);

  // Generate split note
  const splitNote = buildSplitNote(records);

  const receiptText = `茲\\hspace{0.5em}收到\\hspace{0.3em}貴子弟\\hspace{0.3em}\\textbf{${escTex(name)}}，${billYear}年 ${billMonth} 月 課程費用 ${invoice.amount} 元整。`;

  // 3. Read template and fill placeholders
  let tex = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  const replacements: [string, string][] = [
    ['<<SERIAL>>', escTex(invoice.serialNumber)],
    ['<<HASH>>', invoice.hashCode],
    ['<<NAME>>', escTex(name)],
    ['<<SUBJECT>>', escTex(subject)],
    ['<<BILLING_DATE>>', issuedDate],
    ['<<TOTAL_FEE>>', `${invoice.amount}`],
    ['<<SESSION_INFO>>', sessionInfoText],
    ['<<RECEIPT_TEXT>>', receiptText],
    ['<<BILL_YEAR>>', billYear],
    ['<<QR_URL>>', qrUrl],
    ['<<STAMP_TAX_PATH>>', STAMP_TAX.replace(/\\/g, '/')],
    ['<<STAMP_LARGE_PATH>>', STAMP_LARGE.replace(/\\/g, '/')],
    ['<<FONT_DIR>>', FONT_DIR.replace(/\\/g, '/')],
  ];

  for (const [placeholder, value] of replacements) {
    tex = tex.replaceAll(placeholder, value);
  }

  // Date tables using expanded slots (YY=2 slots, Y=1 slot)
  tex = tex.replace('<<DATE_TABLE_TOP>>', buildDateTable(dateSlots, true));
  tex = tex.replace('<<DATE_TABLE_BOTTOM>>', buildDateTable(dateSlots, false));

  // Split note: auto-generated from records
  const noteText = splitNote || (invoice.note ? invoice.note : null);
  if (noteText) {
    tex = tex.replace(
      '% <<NOTE_PLACEHOLDER>>',
      `\\vspace{2mm}\n\\begin{center}\\large ${escTex(noteText)}\\end{center}`
    );
  } else {
    tex = tex.replace('% <<NOTE_PLACEHOLDER>>', '');
  }

  // 4. Write .tex and compile
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // 檔名用結束日期 +7 天，避免同一學生多張收費單撞名
  const endPlus7 = new Date(invoice.endDate.getTime() + 7 * 86400000);
  const endPlus7Str = `${endPlus7.getFullYear()}${String(endPlus7.getMonth() + 1).padStart(2, '0')}${String(endPlus7.getDate()).padStart(2, '0')}`;
  const baseName = `${invoice.enrollment.sheetsId}_${invoice.enrollment.classCode}_${endPlus7Str}`;
  const texPath = path.join(OUTPUT_DIR, `${baseName}.tex`);
  const pdfPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);

  fs.writeFileSync(texPath, tex, 'utf-8');

  try {
    execSync(
      `"${XELATEX_PATH}" -interaction=nonstopmode -output-directory="${OUTPUT_DIR}" "${texPath}"`,
      { timeout: 120000, stdio: 'pipe' }
    );
    // Clean auxiliary files
    for (const ext of ['.aux', '.log', '.out']) {
      const f = path.join(OUTPUT_DIR, `${baseName}${ext}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch (e: unknown) {
    // Read the log for debugging
    const logPath = path.join(OUTPUT_DIR, `${baseName}.log`);
    const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : '';
    return { success: false, texPath, error: `XeLaTeX compilation failed. Log tail:\n${logContent}` };
  }

  // 5. Update invoice with PDF path
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { pdfPath },
  });

  return { success: true, pdfPath, texPath };
}
