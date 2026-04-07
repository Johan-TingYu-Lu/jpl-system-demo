/**
 * rate-resolver.ts — 費率解析器
 *
 * 根據學生屆次（115/116/117）判斷使用哪個費率方案。
 *
 * v3: 方案定義已移至 plan-config.ts，本模組只負責解析邏輯。
 *
 * 解析順序：
 *  1. 學費收支總表 門檻值 → planFromThresholds()
 *  2. cohort 欄位 → planFromCohort()
 *  3. className 字串 parse → fallback
 *  4. DB Class → RateConfig
 */
import prisma from './prisma';
import { readSheet } from './sheets';
import type { RateConfig } from './billing-engine';
import { PLAN_A, PLAN_B, planFromThresholds, planFromCohort, type PlanDefinition } from './plan-config';

export interface ResolvedRate {
  config: RateConfig;
  planName: string;
  source: 'sheet_threshold' | 'class_name_parse' | 'db_class_default';
  /** 完整方案定義（可選，用於 PDF 渲染等） */
  plan?: PlanDefinition;
}

// Cache for rate configs loaded from DB
let rateConfigCache: Map<string, RateConfig> | null = null;

async function loadRateConfigs(): Promise<Map<string, RateConfig>> {
  if (rateConfigCache) return rateConfigCache;
  const configs = await prisma.rateConfig.findMany();
  rateConfigCache = new Map();
  for (const c of configs) {
    rateConfigCache.set(c.name, {
      fullSessionFee: c.fullSessionFee,
      halfSessionFee: c.halfSessionFee,
      settlementSessions: c.settlementSessions,
      hoursPerSession: c.hoursPerSession,
    });
  }
  return rateConfigCache;
}

/**
 * 解析單一 enrollment 的費率
 */
export async function resolveRateConfig(
  enrollment: {
    className: string;
    classCode: string;
    cohort?: number | null;
  },
  sheetThresholds?: {
    prepThreshold: number | null;  // 學費收支總表 col S (750 or 800)
    feeThreshold: number | null;   // 學費收支總表 col T (-3000 or -4000)
  }
): Promise<ResolvedRate> {
  // Strategy 1: Sheet threshold values → planFromThresholds()
  if (sheetThresholds?.prepThreshold != null && sheetThresholds?.feeThreshold != null) {
    const plan = planFromThresholds(sheetThresholds.prepThreshold, sheetThresholds.feeThreshold);
    if (plan) {
      return { config: plan.rate, planName: plan.name, source: 'sheet_threshold', plan };
    }
  }

  // Strategy 2: 用 cohort 欄位（如有）→ planFromCohort()
  const cohort = enrollment.cohort;
  if (cohort != null) {
    const plan = planFromCohort(cohort);
    return { config: plan.rate, planName: plan.name, source: 'class_name_parse', plan };
  }

  // Fallback: parse className string
  const cn = enrollment.className;
  if (cn.includes('(115)') || cn.includes('高三班')) {
    return { config: PLAN_A.rate, planName: PLAN_A.name, source: 'class_name_parse', plan: PLAN_A };
  }
  if (cn.includes('(116)') || cn.includes('高二班') ||
      cn.includes('(117)') || cn.includes('高一班')) {
    return { config: PLAN_B.rate, planName: PLAN_B.name, source: 'class_name_parse', plan: PLAN_B };
  }

  // Strategy 3: DB fallback (Class → RateConfig)
  const configs = await loadRateConfigs();
  const cls = await prisma.class.findUnique({
    where: { code: enrollment.classCode },
    include: { rateConfig: true },
  });
  if (cls) {
    const config: RateConfig = {
      fullSessionFee: cls.rateConfig.fullSessionFee,
      halfSessionFee: cls.rateConfig.halfSessionFee,
      settlementSessions: cls.rateConfig.settlementSessions,
      hoursPerSession: cls.rateConfig.hoursPerSession,
    };
    return { config, planName: cls.rateConfig.name, source: 'db_class_default' };
  }

  // Ultimate fallback: Plan B
  return { config: PLAN_B.rate, planName: PLAN_B.name, source: 'db_class_default', plan: PLAN_B };
}

/**
 * 批次解析：從學費收支總表讀取所有門檻值，一次解析全部 enrollment
 * 回傳 Map<sheetsId, ResolvedRate>
 */
export async function resolveAllRateConfigs(): Promise<Map<string, ResolvedRate>> {
  // Read threshold data from 學費收支總表
  const rows = await readSheet("'學費收支總表'!A:U");
  const thresholdMap = new Map<string, { prepThreshold: number | null; feeThreshold: number | null }>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const sheetsId = String(row[0] || '').trim();
    if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

    const prepThreshold = typeof row[18] === 'number' ? row[18] : null;
    const feeThreshold = typeof row[19] === 'number' ? row[19] : null;
    thresholdMap.set(sheetsId, { prepThreshold, feeThreshold });
  }

  // Load all enrollments
  const enrollments = await prisma.enrollment.findMany({
    select: { sheetsId: true, className: true, classCode: true },
  });

  const result = new Map<string, ResolvedRate>();
  for (const e of enrollments) {
    const thresholds = thresholdMap.get(e.sheetsId);
    const resolved = await resolveRateConfig(e, thresholds);
    result.set(e.sheetsId, resolved);
  }

  return result;
}
