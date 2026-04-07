# JPL 系統架構與重構計畫

> 最後更新：2026/03/17
> 本文件供 AI Agent 斷線後恢復上下文用，包含：系統現狀、模組清單、已知問題、重構計畫

---

## 一、技術棧

| 層級 | 技術 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| DB | PostgreSQL (GCP Cloud SQL) |
| Sheets | googleapis v4 + Service Account |
| PDF | XeLaTeX (`templates/invoice.tex`) |
| 語言 | TypeScript (strict) |
| 執行 | `npx tsx scripts/*.ts` |

---

## 二、Google Sheets 資料來源（9 個學年）

| 學年 | Spreadsheet ID | 月份範圍 | 學生 ID 範圍 | 收費學生 | 收費筆數 |
|------|----------------|----------|-------------|---------|---------|
| 106 | `1G90xbpj9JC-_3X2vv4i0lfDUmIPrBZsZ94-LKQj_-FE` | 2017/01~2018/06 | 1~69 | 58 | 293 |
| 107 | `13iwro7zS4Da_Z6Xnopn6nHlMfOYil-Id5ib2HyUrH2E` | 2018/07~2019/06 | 3~144 | 70 | 402 |
| 108 | `1RLv3XuGjeDZd3CEQOh-0Cn2azIJmozkwnI7gDliXC3U` | 2019/07~2020/06 | 37~213 | 109 | 811 |
| 109 | `1G7_Y7pDE__l3cpoG8TTbduweRQmIoQIlO7Q9010tb68` | 2020/07~2021/08 | 37~348 | 232 | 1,403 |
| 110 | `1zdzsxq2j17VVjY7gpETBX0kvkrQBAnFuv6MRztkFqa0` | 2021/09~2022/08 | 37~426 | 225 | 1,360 |
| 111 | `1GjCfmj1PiVdqITR1YuqYIf0AP5jHp5inTMoRpbcUGME` | 2022/09~2023/08 | 105~525 | 227 | 1,416 |
| 112 | `1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU` | 2023/09~2024/08 | 240~611 | 230 | 1,416 |
| 113 | `1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps` | 2024/09~2025/08 | 365~694 | 224 | 1,371 |
| 114 | `1-sX_OHLI3o-xaW3_a1_vhH1tHh9wBk_FrUgCwJfS29I` | 2025/09~2026/08 | 444~705 | 151 | 735 |

### 各學年 Sheets 格式差異

#### 計費日期表

| 格式 | 學年 | Col A 標頭 | Col D | 日期起始欄 |
|------|------|-----------|-------|-----------|
| A | 106 | 識別碼 | ❌ 無次數欄 | **col 3** |
| B | 107 | 識別碼 | 發單次數 | col 4 |
| C | 108~114 | 識別碼/識別號/空 | 應發單次數 | col 4 |

#### 繳費金額表

| 格式 | 學年 | 金額起始欄 | 差異 |
|------|------|-----------|------|
| 舊 | 106~109 | col 4~5 | 無「驗算」欄 |
| 新 | 110~114 | **col 6** | 多一欄「驗算」 |

#### 繳費日期表

| 格式 | 學年 | 日期起始欄 |
|------|------|-----------|
| 舊 | 106 | col 3 |
| 新 | 107~114 | col 6 |

#### 學費收支總表（費率門檻 col S/T）

| 格式 | 學年 | 有門檻？ |
|------|------|---------|
| 無 | 106 | ❌ |
| 有 | 107~114 | ✅ col S=預備收費門檻, col T=收費門檻 |

#### 學費收支總表（書籍雜費 col X~AA）

| 格式 | 學年 | 有雜費？ | 欄位 |
|------|------|---------|------|
| 無 | 106~110 | ❌ | — |
| 有 | 111~114 | ✅ | col 23=上雜費金額, 24=上雜費日期, 25=下雜費金額, 26=下雜費日期 |

### 匯入時需要 3 個 format branch

```
if (year === '106')      → 格式 A（無次數欄、無門檻、金額 col4、繳費 col3）
else if (year <= '109')  → 格式 B（有次數欄、金額 col5、繳費 col6）
else                     → 格式 C（有驗算欄、金額 col6、繳費 col6）
```

---

## 三、DB 匯入狀態（2026/03/17 快照）

### 收費單（invoices）

| 學年 | 匯入進度 | 筆數 |
|------|---------|------|
| 106 | ✅ 100% | 293 |
| 107 | ✅ 100% | 402 |
| 108 | ✅ 100% | 811 |
| 109 | ✅ 100% | 1,403 |
| 110 | ✅ 100% | 1,360 |
| 111 | ✅ 100% | 1,416 |
| 112 | ✅ 100% | 1,414 |
| 113 | ✅ 100% | 1,371 |
| **114** | ✅ 100% | **735** |
| **合計** | | **9,205** |

### 書籍雜費（semester_fees）

| 學年 | 筆數 | 說明 |
|------|------|------|
| 106~110 | — | Sheets 無雜費欄位 |
| 111 | 261 | ✅ |
| 112 | 288 | ✅ |
| 113 | 303 | ✅ |
| 114 | 190 | ✅ |
| **合計** | **1,042** | |

### 學生（enrollments）

- 總計 703 筆，其中 596 筆有 cohort（年次）欄位
- 完整檢核報表：`reports/audit-all-sheets.txt`

---

## 四、後端模組清單

### src/lib/（核心模組 20 個）

| 檔案 | 職責 | 主要 export |
|------|------|------------|
| `prisma.ts` | DB 連線 singleton（Prisma 7 + pg adapter） | `prisma` |
| `sheets.ts` | Google Sheets API 封裝 | `readSheet()`, `writeSheet()`, `listSheetNames()` |
| `sheets-billing-reader.ts` | 讀取 4 張計費相關 Sheet → 結構化資料（多學年支援） | `readBillingHistoryForYear()`, `readBillingHistory()` |
| `billing-engine.ts` | 計費引擎（純函式，無副作用） | `calculateBilling()` |
| `rate-resolver.ts` | 費率方案判斷（A/B/C），支援 cohort | `resolveRateConfig()`, `resolveAllRateConfigs()` |
| `attendance-reader.ts` | 從 DB 取可計費出勤紀錄 | `getBillableAttendance()`, `getLastInvoiceEndDate()` |
| `invoice-generator.ts` | 新收費單生成協調器 | `generateInvoice()`, `generateAllInvoices()` |
| `billing-history-importer.ts` | Sheets 歷史收費 → DB invoices（多學年支援） | `pullBillingHistory()`, `pullBillingHistoryForYear()` |
| `sync-engine.ts` | Sheets → DB 全量同步（學生+出勤+收費，多學年支援） | `pullAll()`, `pullMultipleYears()`, `parseCohort()` |
| `sheets-sync.ts` | DB → Sheets 回寫 | `syncInvoiceStatus()`, `syncStudentStatus()` |
| `pdf-renderer.ts` | LaTeX → PDF 編譯 | `renderInvoicePdf()` |
| `audit-engine.ts` | DB↔Sheets 同步檢核 + DB 內部交叉檢核 | `runAudit()` |
| `audit.ts` | audit_log CRUD | `createAuditLog()`, `getAuditHistory()` |
| **`year-config.ts`** | 🆕 學年設定層（9 學年 Sheets 格式映射） | `getYearConfig()`, `YEAR_CONFIGS`, `MiscFeeFormat` |
| **`serial-utils.ts`** | 🆕 序號/雜湊統一生成 | `makeSerial()`, `makeHistoricalSerial()`, `makeHash()` |
| **`multi-year-importer.ts`** | 🆕 歷年匯入協調器 | `importAllHistoricalYears()` |
| **`semester-fee-importer.ts`** | 🆕 書籍雜費匯入器 | `importAllSemesterFees()`, `importSemesterFeesForYear()` |
| **`attendance-utils.ts`** | 🆕 出勤日期工具統一 | `extractBillableDates()`, `countTotalY()`, `serialToDate()` |
| **`plan-config.ts`** | 🆕 費率方案集中定義 | `PLAN_A/B/C_850/C_900`, `planFromThresholds()`, `planFromCohort()` |
| **`script-init.ts`** | 🆕 腳本共用初始化 | `runScript()`, `createSheetsApi()` |

### src/app/api/（API Routes 10 條）

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/sync/pull` | POST | Sheets → DB（target: students/attendance/billing/all） |
| `/api/sync/push` | POST | DB → Sheets（target: invoices/students/all） |
| `/api/students` | GET/POST | 學生列表/新增 |
| `/api/attendance` | GET/POST | 出勤查詢/更新 |
| `/api/billing/status` | GET | 各學生計費狀態總覽 |
| `/api/invoices/generate` | POST | 正常模式生成收費單 |
| `/api/invoices/force-generate` | POST | 強制模式生成收費單 |
| `/api/invoices/[id]/pdf` | POST/GET | 生成/下載 PDF |
| `/api/verify/[hash]` | GET/POST | QR 驗證 / 標記已繳 |
| `/api/audit` | GET | 查詢變更紀錄 |

### scripts/（CLI 腳本）

| 檔案 | 用途 | 備註 |
|------|------|------|
| `billing-pipeline.ts` | 統一 CLI 入口（--import-history / --pdf-only / --force） | 主力腳本 |
| `run-sync.ts` | 高階協調（sync / generate / audit） | 主力腳本 |
| `pull-billing-history.ts` | 直接呼叫 pullBillingHistory() | |
| `import-historical.ts` | 🆕 歷年 106~113 匯入（--years / --dry-run / --billing-only） | `npm run import:historical` |
| `import-semester-fees.ts` | 🆕 書籍雜費匯入 111~114（--dry-run / --years） | |
| `backfill-cohort.ts` | 🆕 回填 cohort 欄位 | 一次性腳本 |
| `audit-all-sheets.ts` | 9 學年 Sheets vs DB 同步檢核 | |
| `compare-sheet-formats.ts` | 比對各年格式差異 | |
| `compare-flags.ts` | Sheet FLAG vs DB FLAG 比對 | |
| ~~`generate-invoices-new.ts`~~ | ❌ 已刪除 | 被 billing-pipeline.ts 取代 |
| ~~`generate-pdfs.ts`~~ | ❌ 已刪除 | 被 billing-pipeline.ts --pdf-only 取代 |
| ~~`import-invoices.ts`~~ | ❌ 已刪除 | 被 billing-pipeline.ts --import-history 取代 |

### 模組依賴圖

```
ENTRY POINTS
  Scripts (CLI)                    API Routes (/api/*)
  ├─ billing-pipeline.ts           ├─ /sync/pull → sync-engine
  ├─ run-sync.ts                   ├─ /sync/push → sheets-sync
  ├─ import-historical.ts          ├─ /invoices/generate → invoice-generator
  ├─ import-semester-fees.ts       └─ /verify/[hash] → prisma direct
  └─ audit-all-sheets.ts
         ↓
ORCHESTRATORS（協調層）
  invoice-generator.ts         → generateInvoice/All()
  billing-history-importer.ts  → pullBillingHistory/ForYear()
  sync-engine.ts               → pullAll/MultipleYears()
  multi-year-importer.ts       → importAllHistoricalYears()
  semester-fee-importer.ts     → importAllSemesterFees()
  audit-engine.ts              → runAudit()
  sheets-sync.ts               → syncInvoiceStatus/StudentStatus()
         ↓
CONFIG（設定層）
  year-config.ts               → YEAR_CONFIGS, getYearConfig()
  serial-utils.ts              → makeSerial(), makeHash()
         ↓
ENGINES（計算引擎，純函數）
  billing-engine.ts            → calculateBilling()
  rate-resolver.ts             → resolveRateConfig()（支援 cohort）
  attendance-reader.ts         → getBillableAttendance()
  pdf-renderer.ts              → renderInvoicePdf()
         ↓
DATA LAYER（資料層）
  prisma.ts                    → PostgreSQL (GCP Cloud SQL)
  sheets.ts                    → Google Sheets API v4
  sheets-billing-reader.ts     → readBillingHistoryForYear()
  audit.ts                     → audit_log CRUD
```

---

## 五、已知重複程式碼問題

### 🔴 嚴重：重複定義（會導致不一致 bug）

| 問題 | 重複次數 | 涉及檔案 |
|------|---------|---------|
| `YEAR_CODE = '26'` | 4 份 | billing-history-importer:42, invoice-generator:27, generate-invoices-new:28, generate-pdfs:32 |
| `makeSerial()` | 4 份 | 同上 |
| `makeHash()` | 4 份 | 同上 |
| 出勤遍歷（days[] → Y/YY 日期） | 7 份 | attendance-reader, billing-history-importer, sync-engine, generate-pdfs, generate-invoices-new, audit-detail, audit-engine |
| Prisma 初始化 | 5 份 | billing-pipeline, pull-billing-history, generate-invoices-new, generate-pdfs, check-db |
| Sheets 驗證 | 4 份 | generate-pdfs, dump-sheets, test-sheets, inspect-columns |
| `serialToDate()` + `formatDate()` | 3 份 | sheets-billing-reader, generate-pdfs, attendance-reader |

### ⚠️ makeSerial 的 slice 不一致 bug

| 位置 | shortId 取法 | 結果 |
|------|-------------|------|
| billing-history-importer.ts | `sheetsId.slice(-3)` | ✅ 3 碼（如 "583"） |
| invoice-generator.ts | `sheetsId.slice(-3)` | ✅ 3 碼 |
| generate-invoices-new.ts | `sheetsId.slice(-2)` | ❌ **2 碼**（如 "83"） |
| generate-pdfs.ts | `sheetsId.slice(-2)` | ❌ **2 碼** |

### 🟡 硬編碼問題

| 項目 | 位置 | 影響 |
|------|------|------|
| `YEAR_CODE = '26'` | 4 個檔案 | 每年換學年要手動改 4 處 |
| `'114學生資料表'` | sync-engine.ts:36 | 每年換學年要手動改 |
| XeLaTeX 路徑 | pdf-renderer.ts:15 | 絕對路徑，換機器壞 |
| 印章圖片路徑 | pdf-renderer.ts:13-14 | 絕對路徑，換機器壞 |
| `sessionInfoText = '5次15H'` | pdf-renderer.ts:127 | **方案 A 學生會顯示錯誤（應為 4次12H）** |
| 費率 750/800 門檻 | rate-resolver.ts:71-76 | 加方案 C 要改程式碼 |

---

## 六、重構計畫：新增 5 個共用模組

### 目標架構

```
src/lib/
├── serial-utils.ts        ← NEW  序號/雜湊統一生成
├── attendance-utils.ts    ← NEW  出勤日期提取統一
├── year-config.ts         ← NEW  學年設定（sheet名/欄位偏移/年碼）
├── plan-config.ts         ← NEW  費率方案資料驅動化
├── script-init.ts         ← NEW  腳本共用初始化
│
├── billing-engine.ts           ✅ 不動（已模組化）
├── rate-resolver.ts            🔧 改用 plan-config
├── sheets-billing-reader.ts    🔧 加 spreadsheetId + format 參數
├── billing-history-importer.ts 🔧 改用 serial-utils + attendance-utils
├── invoice-generator.ts        🔧 改用 serial-utils
├── sync-engine.ts              🔧 改用 year-config
├── audit-engine.ts             🔧 拆分計算 vs 報表輸出
├── pdf-renderer.ts             🔧 路徑改 env + 修 sessionInfo bug
└── ...
```

### 模組 1：`serial-utils.ts`

**消除**：4 份 makeSerial + makeHash + YEAR_CODE

```ts
// 動態計算 YEAR_CODE：學年 + 1911 的後兩碼
export function getYearCode(academicYear: number): string;  // 114 → '26'

// 統一 serial = "YY-SSS-MM-C-NN"
export function makeSerial(
  yearCode: string, sheetsId: string, monthStr: string,
  classCode: string, seq: number
): string;

// 統一 hash = SHA256("serial|sheetsId|amount|subject") 前 8 碼大寫
export function makeHash(
  serial: string, sheetsId: string, amount: number, subject: string
): string;
```

### 模組 2：`attendance-utils.ts`

**消除**：7 份出勤遍歷 + 3 份日期轉換

```ts
// Excel serial → Date
export function serialToDate(serial: number): Date;

// Date → "YYYY/MM/DD"
export function formatDate(d: Date): string;

// DB monthly_attendance.days[] → 可計費日期清單
export function extractBillableDates(
  days: number[], year: number, month: number
): { date: Date; dateStr: string; code: 2 | 3 }[];

// days[] → 總 Y 值（YY=2, Y=1）
export function countYFromDays(days: number[]): number;
```

### 模組 3：`year-config.ts`

**消除**：硬編碼的 sheet 名稱 / spreadsheet ID / 欄位偏移

```ts
export interface YearConfig {
  academicYear: number;           // 106~114
  spreadsheetId: string;
  yearCode: string;               // '17'~'26'
  studentSheetName: string;       // '114學生資料表' / '學生資料總表'
  monthRange: string[];           // ['2025/09', ..., '2026/08']
  billingFormat: {
    hasCountCol: boolean;         // 106=false, 107+=true
    dateStartCol: number;         // 106=3, 107+=4
  };
  feeFormat: {
    hasValidationCol: boolean;    // 106~109=false, 110+=true
    amountStartCol: number;       // 106=4, 107-109=5, 110+=6
    countCol: number;             // 106=N/A, 107-109=4, 110+=5
  };
  paymentFormat: {
    dateStartCol: number;         // 106=3, 107+=6
  };
  summaryFormat: {
    hasThresholdCols: boolean;    // 106=false, 107+=true
    thresholdColS: number;        // 18
    thresholdColT: number;        // 19
  };
}

export function getYearConfig(year: number): YearConfig;
export function getAllYearConfigs(): YearConfig[];

// 9 個學年的完整設定
export const YEAR_CONFIGS: Record<number, YearConfig>;
```

### 模組 4：`plan-config.ts`

**消除**：rate-resolver 中的硬編碼門檻值

```ts
export interface PlanDefinition {
  name: string;                // 'A' | 'B' | 'C-850' | 'C-900'
  fullSessionFee: number;      // 750 / 800 / 850 / 900
  halfSessionFee: number;      // 375 / 400 / 425 / 450
  settlementSessions: number;  // 4 / 5
  hoursPerSession: number;     // 3.0
  totalAmount: number;         // 3000 / 4000 / 3400 / 3600
  sessionInfoText: string;     // '4次12H' / '5次15H'
}

// 門檻值 → 方案
export function planFromThresholds(prepThreshold: number, feeThreshold: number): PlanDefinition;

// 屆次/班名 → 方案
export function planFromClassName(className: string, academicYear: number): PlanDefinition;

export const PLAN_A: PlanDefinition;
export const PLAN_B: PlanDefinition;
export const PLAN_C_850: PlanDefinition;
export const PLAN_C_900: PlanDefinition;
```

### 模組 5：`script-init.ts`

**消除**：5 份 Prisma 初始化 + 4 份 Sheets 驗證

```ts
// 腳本用 Prisma client（非 singleton，腳本結束時 disconnect）
export function createScriptPrisma(): PrismaClient;

// 腳本用 Google Sheets API client
export function createSheetsApi(): sheets_v4.Sheets;
```

---

## 七、重構執行順序

| 步驟 | 動作 | 目的 | 狀態 |
|------|------|------|------|
| **1** | 建 `year-config.ts` | 歷年匯入的前置條件 | ✅ 含 miscFee 映射 |
| **2** | 建 `serial-utils.ts` | 統一序號生成，修 slice bug | ✅ |
| **3** | 建 `attendance-utils.ts` | 消除最大量重複（7 份） | ✅ extractBillableDates/countTotalY |
| **4** | 建 `plan-config.ts` | 費率資料驅動化 | ✅ PLAN_A/B/C_850/C_900 |
| **5** | 建 `script-init.ts` | 統一腳本初始化 | ✅ runScript() + createSheetsApi() |
| **6** | 改造 `sheets-billing-reader.ts` | 接受 YearConfig | ✅ `readBillingHistoryForYear()` |
| **7** | 改造 `billing-history-importer.ts` | 用 serial-utils | ✅ `pullBillingHistoryForYear()` |
| **8** | 改造 `invoice-generator.ts` | 用 serial-utils | ✅ |
| **9** | 改造 `rate-resolver.ts` | 支援 cohort | ✅ Strategy 2: cohort-based |
| **10** | 寫 `multi-year-importer.ts` | 匯入 106~113 歷史（8,470→6,775 筆） | ✅ 已執行 |
| **10b** | 寫 `semester-fee-importer.ts` | 匯入 111~114 書籍雜費（1,042 筆） | ✅ 已執行 |
| **11** | 修 `pdf-renderer.ts` 硬編碼 | 路徑改 env + sessionInfo 動態化 | ✅ STAMP_DIR/XELATEX_PATH env |
| **12** | 刪除 deprecated scripts | generate-invoices-new, generate-pdfs, import-invoices | ✅ 已刪除 3 檔 |

---

## 八、歷年匯入計畫

### 目標

從 Sheets 匯入 106~113 學年共 8,470 筆歷史收費到 DB invoices 表。

### 匯入腳本：`multi-year-importer.ts`

```
multi-year-importer.ts
  ├─ 遍歷 YEAR_CONFIGS（106→113，114 已完成跳過）
  ├─ 對每個學年：
  │   ├─ 用 YearConfig 取得 spreadsheetId + 欄位偏移
  │   ├─ readSheet(計費日期表) → 解析日期對
  │   ├─ readSheet(繳費金額表) → 解析金額
  │   ├─ readSheet(繳費日期表) → 解析繳費日期
  │   ├─ 對每個學生：
  │   │   ├─ 確保 person + enrollment 存在（upsert）
  │   │   ├─ 對每筆收費：
  │   │   │   ├─ 檢查 DB 是否已存在（by startDate+endDate）
  │   │   │   ├─ makeSerial() + makeHash()
  │   │   │   └─ 建立 invoice（amount=sheetAmount, status=paid）
  │   │   └─ 若有 paymentDate → 建立 payment
  │   └─ 統計：成功/跳過/失敗
  └─ 輸出匯入報表
```

### 注意事項

1. **學生跨年重疊**：同一 sheetsId 可能出現在多個學年，person 只建一次，enrollment 可能需更新 classInfo
2. **106 學年無門檻值**：費率需由 className 推斷或使用 fallback
3. **serial number 的 YEAR_CODE**：需動態計算（如 106 學年 = '17'）
4. **dry-run 模式**：先跑一次不寫 DB，確認格式解析正確

---

## 九、交互檢核工具清單

| 工具 | 檔案 | 比對方向 | 目前狀態 |
|------|------|---------|---------|
| Sheets↔DB 同步檢核 | `scripts/audit-all-sheets.ts` | 9 學年 Sheet 計費日期表 vs DB invoices | ✅ 已完成 |
| Sheet FLAG 比對 | `scripts/compare-flags.ts` | Sheet 最後日期 vs DB 最後 endDate | ✅ 已完成 |
| DB 內部 4 項檢核 | `src/lib/audit-engine.ts` | Y值↔張數↔金額 三角驗算 | ✅ 已完成 |
| 格式比對 | `scripts/compare-sheet-formats.ts` | 各年 Sheet 欄位結構差異 | ✅ 已完成 |
| 金額交叉驗算 | `billing-history-importer.ts` | Sheet金額 vs 計算金額（匯入時） | ✅ 已完成 |
| **歷年匯入** | `multi-year-importer.ts` | 106~113 Sheets → DB | ✅ 6,775 invoices |
| **書籍雜費匯入** | `semester-fee-importer.ts` | 111~114 Sheets → DB | ✅ 1,042 semester_fees |

---

## 十、環境變數

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 連線字串（GCP Cloud SQL） |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 114 學年試算表 ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | GCP Service Account JSON 金鑰路徑 |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | ⚠️ 開發用，正式環境需移除 |

### 待新增的環境變數（重構後）

| 變數 | 說明 |
|------|------|
| `XELATEX_PATH` | XeLaTeX 執行檔路徑（取代硬編碼） |
| `STAMP_DIR` | 印章圖片目錄（取代硬編碼絕對路徑） |
| `BASE_URL` | 驗證連結 base URL（取代硬編碼 jpl.app） |

---

## 十一、package.json scripts

```json
{
  "db:pull-sheets": "npx tsx scripts/migrate-114.ts",
  "billing:pipeline": "npx tsx scripts/billing-pipeline.ts",
  "billing:import": "npx tsx scripts/billing-pipeline.ts --import-history --clean",
  "billing:pdf": "npx tsx scripts/billing-pipeline.ts --pdf-only",
  "import:historical": "npx tsx scripts/import-historical.ts",
  "import:historical:dry": "npx tsx scripts/import-historical.ts --dry-run"
}
```

### CLI 用法範例

```bash
# 歷年收費匯入
npx tsx scripts/import-historical.ts --dry-run              # 預覽
npx tsx scripts/import-historical.ts                         # 執行（106~113）
npx tsx scripts/import-historical.ts --years 112,113         # 指定學年
npx tsx scripts/import-historical.ts --billing-only          # 只匯收費，不匯學生/出勤

# 書籍雜費匯入
npx tsx scripts/import-semester-fees.ts --dry-run            # 預覽
npx tsx scripts/import-semester-fees.ts                       # 執行（111~114）
npx tsx scripts/import-semester-fees.ts --years 114           # 指定學年

# cohort 回填
npx tsx scripts/backfill-cohort.ts                            # 一次性
```

---

## 十二、已知問題清單

| # | 問題 | 嚴重度 | 狀態 |
|---|------|--------|------|
| 1 | makeSerial slice(-2) vs slice(-3) 不一致 | 🔴 | ✅ 已修（serial-utils.ts 統一為 slice(-3)） |
| 2 | pdf-renderer sessionInfoText 硬編碼 '5次15H'，方案 A 顯示錯誤 | 🟡 | ✅ 已修（動態取 plan-config） |
| 3 | YEAR_CODE 硬編碼 4 處 | 🟡 | ✅ 已修（serial-utils + year-config 取代） |
| 4 | '114學生資料表' 硬編碼 | 🟡 | ✅ 已修（year-config.studentSheetName） |
| 5 | XeLaTeX/印章路徑硬編碼 | 🟡 | ✅ 已修（STAMP_DIR/XELATEX_PATH env） |
| 6 | SSL 警告（pg-connection-string） | 🔵 | 功能不影響 |
| 7 | NODE_TLS_REJECT_UNAUTHORIZED=0 | 🔵 | 正式環境需移除 |
| 8 | deprecated scripts 未清理 | 🔵 | ✅ 已刪 3 檔 |
