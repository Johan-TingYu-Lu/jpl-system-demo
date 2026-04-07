/**
 * year-config.ts — 學年設定層
 *
 * 將每個學年的 Spreadsheet ID、工作表格式差異集中管理。
 * 解決 106~114 各學年欄位名稱、排列順序、日期格式不同的問題。
 *
 * 格式差異摘要（來自 compare-sheet-formats.ts 分析）：
 *   - 106: 計費日期表無「次數」欄，日期對從 col 3 開始
 *   - 107: 有「發單次數」欄，日期對從 col 4 開始，用「識別碼」
 *   - 108+: 有「應發單次數」欄，日期對從 col 4 開始，用「識別號」
 *   - 學生資料表名稱依學年不同（如 "106學生資料表"、"114學生資料表"）
 *   - 學費收支總表 col S/T（門檻值）僅部分學年有
 */

// ============================================================================
// Types
// ============================================================================

export interface BillingDateFormat {
  /** 識別碼欄位位置 (col index) */
  idCol: number;
  /** 姓名欄位位置 */
  nameCol: number;
  /** 班別欄位位置 */
  classCol: number;
  /** 收費次數欄位位置（null = 無此欄，如 106） */
  countCol: number | null;
  /** 日期對起始欄位 */
  datePairsStartCol: number;
}

export interface FeeAmountFormat {
  idCol: number;
  /** 收費次數欄位位置 */
  countCol: number;
  /** 金額起始欄位 */
  amountsStartCol: number;
}

export interface PaymentDateFormat {
  idCol: number;
  /** 繳費次數欄位位置 */
  countCol: number;
  /** 日期起始欄位 */
  datesStartCol: number;
}

export interface SummaryFormat {
  idCol: number;
  /** 門檻值 col S 位置（null = 該學年無此欄） */
  prepThresholdCol: number | null;
  /** 門檻值 col T 位置（null = 該學年無此欄） */
  feeThresholdCol: number | null;
}

export interface MiscFeeFormat {
  /** 上學期雜費金額欄位 (col index) */
  upperAmountCol: number;
  /** 上學期雜費日期欄位 */
  upperDateCol: number;
  /** 下學期雜費金額欄位 */
  lowerAmountCol: number;
  /** 下學期雜費日期欄位 */
  lowerDateCol: number;
}

export interface AttendanceFormat {
  /** 出席紀錄工作表名稱 pattern（如 "YYYY/MM上課紀錄"） */
  sheetNamePattern: RegExp;
  /** 識別碼欄位位置 */
  idCol: number;
  /** header 搜索關鍵字（用來定位 header row） */
  headerKeyword: string;
  /** 日值欄位起始位置 */
  dayColStart: number;
}

export interface YearConfig {
  /** 學年代碼（如 106, 107, ..., 114） */
  academicYear: number;
  /** 西元年起始（學年上學期，如 106 → 2017） */
  startCalendarYear: number;
  /** 西元年結束（學年下學期，如 106 → 2018） */
  endCalendarYear: number;
  /** 流水號用的年碼（如 106 → "17", 114 → "26"） */
  serialYearCode: string;
  /** Google Spreadsheet ID */
  spreadsheetId: string;
  /** 學生資料表名稱 */
  studentSheetName: string;
  /** 計費日期表格式 */
  billingDate: BillingDateFormat;
  /** 繳費金額表格式 */
  feeAmount: FeeAmountFormat;
  /** 繳費日期表格式 */
  paymentDate: PaymentDateFormat;
  /** 學費收支總表格式 */
  summary: SummaryFormat;
  /** 出席紀錄格式 */
  attendance: AttendanceFormat;
  /** 書籍雜費欄位（null = 該學年無雜費資料） */
  miscFee: MiscFeeFormat | null;
}

// ============================================================================
// 格式模板
// ============================================================================

/** 106 學年格式：無次數欄，日期對從 col 3 開始 */
const FORMAT_106_BILLING: BillingDateFormat = {
  idCol: 0,
  nameCol: 1,
  classCol: 2,
  countCol: null,       // 106 無「次數」欄
  datePairsStartCol: 3, // 日期對直接從 col D 開始
};

/** 107 學年格式：有「發單次數」，日期對從 col 4 開始 */
const FORMAT_107_BILLING: BillingDateFormat = {
  idCol: 0,
  nameCol: 1,
  classCol: 2,
  countCol: 3,          // col D = 「發單次數」
  datePairsStartCol: 4, // 日期對從 col E 開始
};

/** 108~114 學年格式：有「應發單次數」，日期對從 col 4 開始 */
const FORMAT_108_BILLING: BillingDateFormat = {
  idCol: 0,
  nameCol: 1,
  classCol: 2,
  countCol: 3,          // col D = 「應發單次數」
  datePairsStartCol: 4,
};

/** 通用繳費金額表格式 */
const STANDARD_FEE_AMOUNT: FeeAmountFormat = {
  idCol: 0,
  countCol: 5,          // col F = 收費次數
  amountsStartCol: 6,   // col G onwards
};

/** 通用繳費日期表格式 */
const STANDARD_PAYMENT_DATE: PaymentDateFormat = {
  idCol: 0,
  countCol: 4,          // col E = 繳費次數總計
  datesStartCol: 6,     // col G onwards
};

/** 有門檻值的學費收支總表 */
const SUMMARY_WITH_THRESHOLDS: SummaryFormat = {
  idCol: 0,
  prepThresholdCol: 18, // col S
  feeThresholdCol: 19,  // col T
};

/** 無門檻值的學費收支總表 */
const SUMMARY_NO_THRESHOLDS: SummaryFormat = {
  idCol: 0,
  prepThresholdCol: null,
  feeThresholdCol: null,
};

/** 111~114 學年書籍雜費欄位（學費收支總表 col X~AA） */
const MISC_FEE_111_PLUS: MiscFeeFormat = {
  upperAmountCol: 23, // col X = 上雜費金額
  upperDateCol: 24,   // col Y = 上雜費日期
  lowerAmountCol: 25, // col Z = 下雜費金額
  lowerDateCol: 26,   // col AA = 下雜費日期
};

/** 標準出席紀錄格式 */
const STANDARD_ATTENDANCE: AttendanceFormat = {
  sheetNamePattern: /^\d{4}\/\d{2}上課紀錄$/,
  idCol: 0,
  headerKeyword: '識別碼',
  dayColStart: 8,
};

// ============================================================================
// 9 學年設定
// ============================================================================

export const YEAR_CONFIGS: YearConfig[] = [
  {
    academicYear: 106,
    startCalendarYear: 2017,
    endCalendarYear: 2018,
    serialYearCode: '17',
    spreadsheetId: '1G90xbpj9JC-_3X2vv4i0lfDUmIPrBZsZ94-LKQj_-FE',
    studentSheetName: '學生資料總表',
    billingDate: FORMAT_106_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: null,
  },
  {
    academicYear: 107,
    startCalendarYear: 2018,
    endCalendarYear: 2019,
    serialYearCode: '18',
    spreadsheetId: '13iwro7zS4Da_Z6Xnopn6nHlMfOYil-Id5ib2HyUrH2E',
    studentSheetName: '107學生資料表',
    billingDate: FORMAT_107_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: null,
  },
  {
    academicYear: 108,
    startCalendarYear: 2019,
    endCalendarYear: 2020,
    serialYearCode: '19',
    spreadsheetId: '1RLv3XuGjeDZd3CEQOh-0Cn2azIJmozkwnI7gDliXC3U',
    studentSheetName: '108學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: null,
  },
  {
    academicYear: 109,
    startCalendarYear: 2020,
    endCalendarYear: 2021,
    serialYearCode: '20',
    spreadsheetId: '1G7_Y7pDE__l3cpoG8TTbduweRQmIoQIlO7Q9010tb68',
    studentSheetName: '109學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: null,
  },
  {
    academicYear: 110,
    startCalendarYear: 2021,
    endCalendarYear: 2022,
    serialYearCode: '21',
    spreadsheetId: '1zdzsxq2j17VVjY7gpETBX0kvkrQBAnFuv6MRztkFqa0',
    studentSheetName: '110學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: null,
  },
  {
    academicYear: 111,
    startCalendarYear: 2022,
    endCalendarYear: 2023,
    serialYearCode: '22',
    spreadsheetId: '1GjCfmj1PiVdqITR1YuqYIf0AP5jHp5inTMoRpbcUGME',
    studentSheetName: '111學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_NO_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: MISC_FEE_111_PLUS,
  },
  {
    academicYear: 112,
    startCalendarYear: 2023,
    endCalendarYear: 2024,
    serialYearCode: '23',
    spreadsheetId: '1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU',
    studentSheetName: '112學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_WITH_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: MISC_FEE_111_PLUS,
  },
  {
    academicYear: 113,
    startCalendarYear: 2024,
    endCalendarYear: 2025,
    serialYearCode: '24',
    spreadsheetId: '1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps',
    studentSheetName: '113學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_WITH_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: MISC_FEE_111_PLUS,
  },
  {
    academicYear: 114,
    startCalendarYear: 2025,
    endCalendarYear: 2026,
    serialYearCode: '26',
    spreadsheetId: '1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I',
    studentSheetName: '114學生資料表',
    billingDate: FORMAT_108_BILLING,
    feeAmount: STANDARD_FEE_AMOUNT,
    paymentDate: STANDARD_PAYMENT_DATE,
    summary: SUMMARY_WITH_THRESHOLDS,
    attendance: STANDARD_ATTENDANCE,
    miscFee: MISC_FEE_111_PLUS,
  },
];

// ============================================================================
// Lookup helpers
// ============================================================================

const yearConfigMap = new Map<number, YearConfig>(
  YEAR_CONFIGS.map(c => [c.academicYear, c])
);

/** 根據學年取得設定 */
export function getYearConfig(academicYear: number): YearConfig | undefined {
  return yearConfigMap.get(academicYear);
}

/** 取得所有學年代碼（排序） */
export function getAllAcademicYears(): number[] {
  return YEAR_CONFIGS.map(c => c.academicYear);
}

/** 根據 spreadsheetId 反查學年 */
export function getAcademicYearBySpreadsheetId(spreadsheetId: string): number | undefined {
  return YEAR_CONFIGS.find(c => c.spreadsheetId === spreadsheetId)?.academicYear;
}

/** 根據西元年判斷學年（8月前 = 上學期尾，8月後 = 下學期頭） */
export function calendarYearToAcademicYear(calendarYear: number, month: number): number {
  // 學年 = 西元年 - 1911，但 8 月前算前一學年
  // 例：2026/03 → 114 學年，2025/09 → 114 學年
  if (month >= 8) {
    return calendarYear - 1911;
  }
  return calendarYear - 1911 - 1;
}

/** 根據日期範圍推斷學年 */
export function inferAcademicYear(startDate: Date): number {
  const year = startDate.getFullYear();
  const month = startDate.getMonth() + 1;
  return calendarYearToAcademicYear(year, month);
}
