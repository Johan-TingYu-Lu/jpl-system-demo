/**
 * summer-settlement.ts — 暑期結算（高一高二 close-out）
 *
 * 一張表混高一高二、不分科。逐生「結算」：
 *   1. 已有暑期結算單 → 跳過（冪等防呆）
 *   2. 把該生「所有年級 enrollment」的未計費節次（含拆分帶出的 1Y 尾巴）合成一條流
 *   3. 同一天兩科 = 兩節（不去重）
 *   4. calculateBilling force 模式 → 全部計費、不切、不留 leftover
 *   5. 一張合併單，掛載體 enrollment（id 最小），note 標記、PDF 科目顯示「數學/物理」
 *
 * 費率：resolveAllRateConfigs（尊重門檻覆寫），116/117 通常方案B $800。
 *
 * ⚠️ dryRun=true 只算不寫。dryRun=false 才真的開單。
 */
import prisma from './prisma';
import { getBillableAttendance, getLastInvoiceTail } from './attendance-reader';
import { calculateBilling, type AttendanceEntry, type BilledRecord, type RateConfig } from './billing-engine';
import { resolveAllRateConfigs } from './rate-resolver';
import { makeSerialFromDate, makeHash } from './serial-utils';
import { createAuditLog } from './audit';

export const SUMMER_MARK = '暑期結算';
export const SUMMER_SUBJECT = '數學/物理';
const TARGET_COHORTS = [116, 117]; // 高二, 高一

/**
 * Person 別名：同一活人被建成兩筆 Person 時，把左邊 personId 併到右邊。
 * 目前僅田峻安（personId 225 "田峻安N" = 233 "田峻安"，學號 557 物理 + 589 數學）。
 * ⚠️ 分組一律用 personId（一人多學號是常態：物理 N 班、數學 M 班各一個學號）。
 */
export const PERSON_ALIAS: Record<number, number> = { 225: 233 };
export function canonicalPersonId(personId: number): number {
  return PERSON_ALIAS[personId] ?? personId;
}

export interface SettlementLine {
  sheetsId: string;
  name: string;
  cohort: number | null;
  grade: '高一' | '高二' | '?';
  carrierEnrollmentId: number;
  carrierClassCode: string;
  subjects: string[];
  records: BilledRecord[];
  totalY: number;
  totalFee: number;
  /** 跳過原因（已結算 / 無未計費節次）；非 null 表示不會開單 */
  skip: string | null;
  /** 已開出的單號（dryRun=false 成功時） */
  serialNumber?: string;
  invoiceId?: number;
}

interface EnrollmentLite {
  id: number; sheetsId: string; subject: string;
  className: string; classCode: string; cohort: number | null;
  personId: number; personName: string;
}

function gradeOf(cohort: number | null, className: string): '高一' | '高二' | '?' {
  if (cohort === 117 || className.includes('高一')) return '高一';
  if (cohort === 116 || className.includes('高二')) return '高二';
  return '?';
}

function parseUTCDate(s: string): Date {
  const [y, m, d] = s.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * 載入高一高二在學 enrollment，依「活人」分組。
 * 分組鍵 = canonical personId，不是 sheetsId —— 一人兩科 = 兩個學號（N班/M班），
 * 按學號分組會把同一人開成兩張單（生產實測：113 enrollment = 64 人，49 人雙科）。
 */
async function loadGroups(): Promise<Map<number, EnrollmentLite[]>> {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      status: 'active',
      OR: [
        { cohort: { in: TARGET_COHORTS } },
        { className: { contains: '高一' } },
        { className: { contains: '高二' } },
      ],
    },
    include: { person: { select: { id: true, name: true } } },
    orderBy: [{ sheetsId: 'asc' }, { id: 'asc' }],
  });
  const filtered = enrollments.filter(e =>
    (e.cohort != null && TARGET_COHORTS.includes(e.cohort)) ||
    e.className.includes('高一') || e.className.includes('高二')
  );
  const byPerson = new Map<number, EnrollmentLite[]>();
  for (const e of filtered) {
    const lite: EnrollmentLite = {
      id: e.id, sheetsId: e.sheetsId, subject: e.subject,
      className: e.className, classCode: e.classCode, cohort: e.cohort,
      personId: e.person.id, personName: e.person.name,
    };
    const pid = canonicalPersonId(e.person.id);
    const arr = byPerson.get(pid) ?? [];
    arr.push(lite);
    byPerson.set(pid, arr);
  }
  return byPerson;
}

/** 蒐集一位學生跨所有 enrollment 的未計費節次（含帶出尾巴），合併排序 */
async function gatherMergedAttendance(group: EnrollmentLite[]): Promise<AttendanceEntry[]> {
  const merged: AttendanceEntry[] = [];
  for (const enr of group) {
    const tail = await getLastInvoiceTail(enr.id);
    const lastEnd = tail?.endDate ?? null;
    if (tail?.carriedOut) merged.push({ date: tail.carriedOut, status: 2 }); // 帶出 1Y → 一筆 Y
    const unbilled = await getBillableAttendance(enr.id, lastEnd);
    merged.push(...unbilled);
  }
  merged.sort((a, b) => a.date.localeCompare(b.date)); // 同日兩科保留兩筆
  return merged;
}

/** 計算一位學生的結算內容（不寫）。existingSerial 非空表示已結算 → skip。 */
async function computeLine(group: EnrollmentLite[], rate: RateConfig | undefined): Promise<SettlementLine> {
  const carrier = group.reduce((min, e) => (e.id < min.id ? e : min), group[0]);
  const base = {
    // 顯示名去掉尾綴班別字母（"田峻安N" → "田峻安"）
    sheetsId: carrier.sheetsId, name: group[0].personName.replace(/[A-Za-z]+$/, '').trim(), cohort: group[0].cohort,
    grade: gradeOf(group[0].cohort, group[0].className),
    carrierEnrollmentId: carrier.id, carrierClassCode: carrier.classCode,
    subjects: [...new Set(group.map(g => g.subject))],
  };

  const existing = await prisma.invoice.findFirst({
    where: { enrollmentId: { in: group.map(g => g.id) }, note: { startsWith: SUMMER_MARK } },
    select: { serialNumber: true },
  });
  if (existing) {
    return { ...base, records: [], totalY: 0, totalFee: 0, skip: `已有結算單 ${existing.serialNumber}` };
  }

  const merged = await gatherMergedAttendance(group);
  if (merged.length === 0) {
    return { ...base, records: [], totalY: 0, totalFee: 0, skip: '無未計費節次' };
  }

  const r: RateConfig = rate ?? { fullSessionFee: 800, halfSessionFee: 400, settlementSessions: 5, hoursPerSession: 3.0 };
  const billing = calculateBilling(merged, r, 'force');
  return { ...base, records: billing.records, totalY: billing.totalY, totalFee: billing.totalFee, skip: null };
}

/** 單一 classCode → 序號用的單一字母（取第一個 A-Z，預設 N） */
function classLetter(classCode: string): string {
  const m = classCode.match(/[A-Za-z]/);
  return m ? m[0].toUpperCase() : 'N';
}

/** Dry-run 批次預覽：每位學生（活人）會開什麼，不寫 */
export async function previewSummerSettlement(): Promise<SettlementLine[]> {
  const byPerson = await loadGroups();
  const rateMap = await resolveAllRateConfigs();
  const lines: SettlementLine[] = [];
  for (const [, group] of byPerson) {
    const carrierSid = group.reduce((min, e) => (e.id < min.id ? e : min), group[0]).sheetsId;
    lines.push(await computeLine(group, rateMap.get(carrierSid)?.config));
  }
  // 照年級排：高一 → 高二，組內照學號
  const order = { '高一': 0, '高二': 1, '?': 2 } as const;
  lines.sort((a, b) => order[a.grade] - order[b.grade] || parseInt(a.sheetsId) - parseInt(b.sheetsId));
  return lines;
}

/**
 * 逐生結算（sheetsId 可以是該生任一學號，會解析到整個人）。
 * dryRun=true 只回傳會開什麼；dryRun=false 真的開單。
 */
export async function settleOneStudent(sheetsId: string, dryRun: boolean): Promise<SettlementLine> {
  const byPerson = await loadGroups();
  const group = [...byPerson.values()].find(g => g.some(e => e.sheetsId === sheetsId));
  if (!group) return { sheetsId, name: '', cohort: null, grade: '?', carrierEnrollmentId: 0, carrierClassCode: '', subjects: [], records: [], totalY: 0, totalFee: 0, skip: '找不到該生（非高一高二在學）' };

  const rateMap = await resolveAllRateConfigs();
  const carrierSid = group.reduce((min, e) => (e.id < min.id ? e : min), group[0]).sheetsId;
  const line = await computeLine(group, rateMap.get(carrierSid)?.config);

  if (dryRun || line.skip) return line;

  // ── 真的開單 ──
  const startDate = parseUTCDate(line.records[0].date);
  const endDate = parseUTCDate(line.records[line.records.length - 1].date);
  const yyCount = line.records.filter(r => r.status === 3 && !r.isSplit).length;
  const yCount = line.records.filter(r => r.status === 2 || r.isSplit).length;
  const letter = classLetter(line.carrierClassCode);

  // 序號：avoid 撞號 — 從現有張數+1 起跳，撞了就 +1
  const existingCount = await prisma.invoice.count({ where: { enrollmentId: { in: group.map(g => g.id) } } });
  let seq = existingCount + 1;
  let serial = makeSerialFromDate(startDate, carrierSid, letter, seq);
  for (let guard = 0; guard < 50; guard++) {
    const clash = await prisma.invoice.findFirst({ where: { serialNumber: serial }, select: { id: true } });
    if (!clash) break;
    seq++;
    serial = makeSerialFromDate(startDate, carrierSid, letter, seq);
  }
  const hash = makeHash(serial, carrierSid, line.totalFee, SUMMER_SUBJECT);

  const invoice = await prisma.invoice.create({
    data: {
      serialNumber: serial,
      hashCode: hash,
      enrollmentId: line.carrierEnrollmentId,
      startDate,
      endDate,
      amount: line.totalFee,
      yyCount,
      yCount,
      totalY: line.totalY,
      records: line.records as unknown as object,
      note: `${SUMMER_MARK}（合併 ${line.subjects.join('+')}）`,
      status: 'draft',
    },
  });

  await createAuditLog({
    tableName: 'invoices',
    recordId: invoice.id,
    action: 'CREATE',
    afterData: { serialNumber: serial, amount: line.totalFee, totalY: line.totalY, subjects: line.subjects, mergedFrom: group.map(g => g.id) },
    changedBy: 'summer-settle',
    reason: `暑期結算（force 全開，跨 ${group.length} 科合併）`,
  });

  return { ...line, serialNumber: serial, invoiceId: invoice.id };
}
