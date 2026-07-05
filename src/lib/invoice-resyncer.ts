/**
 * invoice-resyncer.ts — 收費單重新同步
 *
 * 給定一張 invoice，從 DB monthly_attendance 重新抓取該區間的出勤資料，
 * 重算 records / amount / totalY / yyCount / yCount，更新 DB。
 *
 * v2: 銜接拆分鏈條 — 自動查上一張的 carriedOut，若有則：
 *   - 把帶入日 (= 上張 carriedOut) 加進 records 第一筆 (isSplit=true)
 *   - 更新 startDate = 帶入日
 *   - 更新 endDate = records 最後一筆日期
 *   - 更新 serialNumber 月份對齊新 startDate
 *   - 更新 note 為「拆分：MM/DD 帶入 1Y；MM/DD 帶出 1Y」格式
 *   - 清空 pdfPath（觸發重 render）
 *
 * 使用場景：老師在網頁修改上課紀錄後，按「重新生成」按鈕。
 */
import prisma from './prisma';
import { extractBillableDates, formatDateUTC } from './attendance-utils';
import { resolveRateConfig } from './rate-resolver';
import { createAuditLog } from './audit';
import { calculateBilling, type BilledRecord, type AttendanceEntry } from './billing-engine';
import { getLastInvoiceTail } from './attendance-reader';
import { makeSerial, makeHash, parseSerial } from './serial-utils';
import { classifyShape, validateSingle, isIrregularShape } from './invoice-validator';

// ============================================================================
// Types
// ============================================================================

export interface ResyncInput {
  invoiceId: number;
  /** 若為 true，只回傳差異不寫入 */
  dryRun?: boolean;
}

export interface ResyncDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ResyncResult {
  success: boolean;
  invoiceId: number;
  serialNumber: string;
  diffs: ResyncDiff[];
  /** dry-run 時不會實際寫入 */
  applied: boolean;
  error?: string;
}

// ============================================================================
// Main
// ============================================================================

export async function resyncInvoice(input: ResyncInput): Promise<ResyncResult> {
  const { invoiceId, dryRun = false } = input;

  // 1. Load invoice + enrollment
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      enrollment: {
        include: { person: { select: { name: true, } } },
      },
    },
  });

  if (!invoice) {
    return { success: false, invoiceId, serialNumber: '', diffs: [], applied: false, error: 'Invoice not found' };
  }

  // 防呆：已銷帳(paid)/已封存(archived) 不可重算 — 避免改動已收款收據的金額/序號/日期
  if (invoice.status === 'paid' || invoice.status === 'archived') {
    return { success: false, invoiceId, serialNumber: invoice.serialNumber, diffs: [], applied: false, error: `${invoice.status} 狀態不可重算` };
  }

  // 2. Resolve rate config
  const resolved = await resolveRateConfig(invoice.enrollment);
  const rateConfig = resolved.config;

  // 3. 查上一張 invoice 的拆分尾巴（排除本張）
  // getLastInvoiceTail 預設找最後一張，但會把本張也算進去 — 需要找「end_date 比本張 start_date 早的最後一張」
  const prevInvoice = await prisma.invoice.findFirst({
    where: {
      enrollmentId: invoice.enrollmentId,
      id: { not: invoiceId },
      endDate: { lte: invoice.startDate },
    },
    orderBy: { endDate: 'desc' },
    select: { endDate: true, records: true },
  });

  let carriedFromPrev: { date: string } | undefined = undefined;
  if (prevInvoice) {
    const prevRecs = prevInvoice.records as { date: string; isSplit?: boolean }[] | null;
    if (prevRecs && prevRecs.length > 0) {
      const last = prevRecs[prevRecs.length - 1];
      if (last.isSplit) carriedFromPrev = { date: last.date };
    }
  }

  // 4. 取出 attendance：以「carriedFromPrev 後」或本張 startDate 起，到「足夠累計到結算」為止
  //    使用 force 模式由 calculateBilling 處理長度，但我們用 normal 自然結算
  const allMonths = await prisma.monthlyAttendance.findMany({
    where: { enrollmentId: invoice.enrollmentId },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  const allBillable = extractBillableDates(allMonths, { useUTC: true, validateDate: true });

  // 起始點：若有 carriedFromPrev，從 carriedFromPrev.date 之後；否則從本張 startDate 起（含）
  const startStr = carriedFromPrev?.date ?? formatDateUTC(invoice.startDate);
  const candidates: AttendanceEntry[] = allBillable
    .filter(b => carriedFromPrev ? b.dateStr > startStr : b.dateStr >= startStr)
    .map(b => ({ date: b.dateStr, status: b.code }));

  // 5. 算 records（含拆分鏈條）
  const billing = calculateBilling(candidates, rateConfig, 'normal', carriedFromPrev);
  if (!billing.canGenerate) {
    return {
      success: false, invoiceId, serialNumber: invoice.serialNumber, diffs: [], applied: false,
      error: `重算失敗：累計 Y 不足結算 (${billing.totalY}/${rateConfig.settlementSessions * 2})`,
    };
  }

  // 6. 推導新 startDate / endDate / serial
  const newStartStr = billing.records[0].date; // YYYY/MM/DD
  const newEndStr = billing.records[billing.records.length - 1].date;
  const parseUTC = (s: string) => {
    const [y, m, d] = s.split('/').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const newStartDate = parseUTC(newStartStr);
  const newEndDate = parseUTC(newEndStr);

  // 序號月份從新 startDate 取
  const parsed = parseSerial(invoice.serialNumber);
  const startMonth = parseInt(newStartStr.split('/')[1]);
  let newSerial = invoice.serialNumber;
  let newHash = invoice.hashCode;
  if (parsed) {
    const candidate = makeSerial(parsed.yearCode, invoice.enrollment.sheetsId, startMonth, parsed.classCode, parseInt(parsed.sequence));
    if (candidate !== invoice.serialNumber) {
      // 確認新序號不會跟其他 invoice 衝突（除了自己）
      const clash = await prisma.invoice.findFirst({
        where: { serialNumber: candidate, id: { not: invoiceId } },
        select: { id: true },
      });
      if (!clash) {
        newSerial = candidate;
        newHash = makeHash(newSerial, invoice.enrollment.sheetsId, billing.totalFee, invoice.enrollment.subject);
      }
    }
  }

  // 7. Compute diffs
  const oldRecords = (invoice.records as unknown as BilledRecord[]) || [];
  const oldDates = oldRecords.map(r => `${r.date}${r.isSplit ? '*' : ''}`).join(', ');
  const newDates = billing.records.map(r => `${r.date}${r.isSplit ? '*' : ''}`).join(', ');

  const diffs: ResyncDiff[] = [];
  if (oldDates !== newDates) diffs.push({ field: 'records', before: oldDates, after: newDates });
  if (Number(invoice.amount) !== billing.totalFee) diffs.push({ field: 'amount', before: Number(invoice.amount), after: billing.totalFee });
  if (invoice.totalY !== billing.totalY) diffs.push({ field: 'totalY', before: invoice.totalY, after: billing.totalY });
  if (invoice.yyCount !== billing.yyCount) diffs.push({ field: 'yyCount', before: invoice.yyCount, after: billing.yyCount });
  if (invoice.yCount !== billing.yCount) diffs.push({ field: 'yCount', before: invoice.yCount, after: billing.yCount });
  if (formatDateUTC(invoice.startDate) !== newStartStr) diffs.push({ field: 'startDate', before: formatDateUTC(invoice.startDate), after: newStartStr });
  if (formatDateUTC(invoice.endDate) !== newEndStr) diffs.push({ field: 'endDate', before: formatDateUTC(invoice.endDate), after: newEndStr });
  if (invoice.serialNumber !== newSerial) diffs.push({ field: 'serialNumber', before: invoice.serialNumber, after: newSerial });
  if ((invoice.note ?? null) !== (billing.splitNote ?? null)) diffs.push({ field: 'note', before: invoice.note, after: billing.splitNote });

  if (diffs.length === 0) {
    return { success: true, invoiceId, serialNumber: invoice.serialNumber, diffs: [], applied: false, error: '無差異，不需更新' };
  }

  // Pre-save 驗證
  const shape = classifyShape(billing.records);
  const singleIssues = validateSingle(
    {
      id: invoiceId,
      serialNumber: newSerial,
      amount: billing.totalFee,
      totalY: billing.totalY,
      yyCount: billing.yyCount,
      yCount: billing.yCount,
      records: billing.records,
      note: billing.splitNote,
      status: invoice.status,
    },
    rateConfig,
  );
  if (singleIssues.length > 0) {
    console.warn(`[resyncInvoice] ${newSerial} 單張驗證警告:`, singleIssues.map(i => `${i.field}: ${i.detail}`).join('; '));
  }
  if (isIrregularShape(shape.shape)) {
    console.warn(`[resyncInvoice] ${newSerial} records 形態異常: ${shape.description}`);
  }

  if (!dryRun) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        serialNumber: newSerial,
        hashCode: newHash,
        startDate: newStartDate,
        endDate: newEndDate,
        records: billing.records as unknown as object,
        amount: billing.totalFee,
        totalY: billing.totalY,
        yyCount: billing.yyCount,
        yCount: billing.yCount,
        note: billing.splitNote,
        pdfPath: null, // 觸發重 render
      },
    });

    await createAuditLog({
      tableName: 'invoices',
      recordId: invoiceId,
      action: 'UPDATE',
      beforeData: {
        serial: invoice.serialNumber,
        records: oldDates,
        amount: Number(invoice.amount),
        totalY: invoice.totalY,
        yyCount: invoice.yyCount,
        yCount: invoice.yCount,
        startDate: formatDateUTC(invoice.startDate),
        endDate: formatDateUTC(invoice.endDate),
        note: invoice.note,
      },
      afterData: {
        serial: newSerial,
        records: newDates,
        amount: billing.totalFee,
        totalY: billing.totalY,
        yyCount: billing.yyCount,
        yCount: billing.yCount,
        startDate: newStartStr,
        endDate: newEndStr,
        note: billing.splitNote,
        shape: shape.shape,
        shapeDescription: shape.description,
        singleIssues: singleIssues.length > 0 ? singleIssues : undefined,
      },
      changedBy: 'resync',
      reason: `Resync invoice (含拆分鏈條): ${diffs.map(d => d.field).join(', ')}`,
    });
  }

  return {
    success: true,
    invoiceId,
    serialNumber: newSerial,
    diffs,
    applied: !dryRun,
  };
}
