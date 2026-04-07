/**
 * plan-config.ts — 費率方案資料驅動化
 *
 * 將 PLAN_A / PLAN_B / PLAN_C 等硬編碼集中管理。
 * 解決：
 *   - rate-resolver.ts 中 PLAN_A/B 硬編碼
 *   - pdf-renderer.ts sessionInfoText 硬編碼 '5次15H'
 *   - billing-engine.test.ts 重複定義方案
 *   - 門檻值比對邏輯硬編碼
 */
import type { RateConfig } from './billing-engine';

// ============================================================================
// Types
// ============================================================================

export interface PlanDefinition {
  /** 方案名稱 */
  name: string;
  /** RateConfig（給 billing-engine 用） */
  rate: RateConfig;
  /** 結算金額（settlementSessions × fullSessionFee） */
  settlementAmount: number;
  /** 門檻值：學費收支總表 col S（預備收費門檻） */
  prepThreshold: number;
  /** 門檻值：學費收支總表 col T（收費門檻，負數） */
  feeThreshold: number;
  /** 顯示文字（滿額時），如 '5次15H' */
  sessionInfoText: string;
}

// ============================================================================
// Plan definitions
// ============================================================================

export const PLAN_A: PlanDefinition = {
  name: '方案A',
  rate: {
    fullSessionFee: 750,
    halfSessionFee: 375,
    settlementSessions: 4,
    hoursPerSession: 3.0,
  },
  settlementAmount: 3000,    // 4 × 750
  prepThreshold: 750,
  feeThreshold: -3000,
  sessionInfoText: '4次12H',
};

export const PLAN_B: PlanDefinition = {
  name: '方案B',
  rate: {
    fullSessionFee: 800,
    halfSessionFee: 400,
    settlementSessions: 5,
    hoursPerSession: 3.0,
  },
  settlementAmount: 4000,    // 5 × 800
  prepThreshold: 800,
  feeThreshold: -4000,
  sessionInfoText: '5次15H',
};

export const PLAN_C_850: PlanDefinition = {
  name: '方案C-850',
  rate: {
    fullSessionFee: 850,
    halfSessionFee: 425,
    settlementSessions: 4,
    hoursPerSession: 3.0,
  },
  settlementAmount: 3400,    // 4 × 850
  prepThreshold: 850,
  feeThreshold: -3400,
  sessionInfoText: '4次12H',
};

export const PLAN_C_900: PlanDefinition = {
  name: '方案C-900',
  rate: {
    fullSessionFee: 900,
    halfSessionFee: 450,
    settlementSessions: 4,
    hoursPerSession: 3.0,
  },
  settlementAmount: 3600,    // 4 × 900
  prepThreshold: 900,
  feeThreshold: -3600,
  sessionInfoText: '4次12H',
};

/** 所有方案（查詢用） */
export const ALL_PLANS: PlanDefinition[] = [PLAN_A, PLAN_B, PLAN_C_850, PLAN_C_900];

// ============================================================================
// Lookup helpers
// ============================================================================

/**
 * 根據門檻值反查方案
 * @returns PlanDefinition or undefined
 */
export function planFromThresholds(
  prepThreshold: number,
  feeThreshold: number
): PlanDefinition | undefined {
  return ALL_PLANS.find(
    p => p.prepThreshold === prepThreshold && p.feeThreshold === feeThreshold
  );
}

/**
 * 根據方案名稱查詢
 */
export function planByName(name: string): PlanDefinition | undefined {
  return ALL_PLANS.find(p => p.name === name);
}

/**
 * 根據 cohort（年次）決定方案
 *   - cohort ≤ 115 → Plan A
 *   - cohort ≥ 116 → Plan B
 */
export function planFromCohort(cohort: number): PlanDefinition {
  return cohort <= 115 ? PLAN_A : PLAN_B;
}

/**
 * 根據 RateConfig 反查 PlanDefinition（用於 PDF 渲染時取得 sessionInfoText）
 */
export function planFromRate(rate: RateConfig): PlanDefinition | undefined {
  return ALL_PLANS.find(
    p => p.rate.fullSessionFee === rate.fullSessionFee &&
         p.rate.settlementSessions === rate.settlementSessions
  );
}
