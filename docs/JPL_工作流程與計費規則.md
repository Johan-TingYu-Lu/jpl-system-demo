# JPL 補習班管理系統 — 工作流程與計費規則

> 最後更新：2026/03/16

---

## 一、系統架構

```
Google Sheets（出勤 + 計費歷史）
       ↓ sync (run-sync.ts sync)
  PostgreSQL (GCP Cloud SQL)
       ↓ generate (run-sync.ts generate)
  收費單記錄 (invoices table, status=draft)
       ↓ generate PDF (generate_and_sync.ts generate)
  LaTeX → XeLaTeX → PDF
       ↓ sync back (generate_and_sync.ts sync)
  Google Sheets 計費日期表（回寫 FLAG）
```

### 資料流細節

```
Google Sheets                    DB                          Output
┌──────────────┐           ┌───────────┐
│ 114學生資料表  │──pull──→  │ persons   │
│ YYYY/MM上課紀錄│──pull──→  │ monthly_  │
│              │           │ attendance│
│ 計費日期表    │           │           │            ┌─────────┐
│ 繳費金額表    │──import──→│ invoices  │──render──→ │  PDF    │
│ 繳費日期表    │           │ payments  │            │ (.tex)  │
│ 學費收支總表  │           │           │            └─────────┘
└──────────────┘           └───────────┘
```

### 核心模組

| 模組 | 功能 |
|------|------|
| `sync-engine.ts` | 學生資料 + 出席紀錄（Sheets → DB） |
| `billing-history-importer.ts` | 歷史收費紀錄（Sheets → DB） |
| `rate-resolver.ts` | 費率方案判斷（Sheet 門檻值 → 屆次 → DB fallback） |
| `billing-engine.ts` | 計費引擎（純函式，無副作用） |
| `invoice-generator.ts` | 新收費單生成（DB attendance → billing-engine → DB invoices） |
| `generate_and_sync.ts` | PDF 生成 + Sheets 回寫 |

---

## 二、出勤 Status Code

| Sheet 值 | DB Code | 意義 | 計費 |
|-----------|---------|------|------|
| `YY`      | 3       | 全堂（3hr, 2Y） | ✅ 收 fullSessionFee |
| `Y`       | 2       | 半堂（1.5hr, 1Y） | ✅ 收 halfSessionFee |
| `V`       | 1       | 請假 | ❌ 不計費 |
| `N` / 空白 | 0      | 未到 / 無紀錄 | ❌ 不計費 |

> **程式碼對應** (`sync-engine.ts`):
> `'YY'→3, 'Y'→2, 'V'→1, 'N'/空白→0`

儲存方式：`monthly_attendance.days` 為 `Int[]`（長度 31），index 0 = 1 號。

---

## 三、費率方案

| 方案 | 屆次 | fullSessionFee (YY) | halfSessionFee (Y) | 結算門檻 | 總額 |
|------|------|---------------------|---------------------|----------|------|
| 方案 A | 115 屆（高三） | $750 | $375 | 4次 (8Y) | $3,000 |
| 方案 B | 116/117 屆 | $800 | $400 | 5次 (10Y) | $4,000 |
| 方案 C-850 | 特殊 | $850 | $425 | 4次 (8Y) | $3,400 |
| 方案 C-900 | 特殊 | $900 | $450 | 4次 (8Y) | $3,600 |

- **結算門檻**：累計 Y 值達到 `settlementSessions × 2` 時觸發收費單
- **拆分（Split）**：若最後一筆 YY 會超過門檻，只計 1Y 本期、另 1Y 留下期

### 費率解析優先順序 (`rate-resolver.ts`)

1. **學費收支總表門檻值**（最可靠）
   - Column S = 750 且 Column T = -3000 → 方案 A
   - Column S = 800 且 Column T = -4000 → 方案 B
2. **className 屆次解析**
   - 含 "(115)" 或 "高三班" → 方案 A
   - 含 "(116)"/"(117)" 或 "高二班"/"高一班" → 方案 B
3. **DB Class → RateConfig**（fallback）
   - 透過 enrollment.classCode → Class → RateConfig
4. **Ultimate fallback**：方案 B

> **注意**：Class 只有 "N" 和 "M" 兩種，無法區分屆次，所以不能只靠 Class 判斷。

---

## 四、收費單生命週期

```
draft → (PDF 生成) → draft+PDF → (校對) → (sync to Sheets) → paid
```

| Status | 說明 |
|--------|------|
| `draft` | 剛建立，待生成 PDF |
| `draft` + `pdf_path` | PDF 已生成，待校對 |
| `paid` | 已同步到 Sheets 計費日期表，已收費 |

> **重要**：`invoice-generator.ts` 建立 invoice 時使用 `status: 'draft'`。
> `generate_and_sync.ts` 查詢也用 `WHERE status='draft'`。兩者必須一致。

---

## 五、操作指令（現行腳本）

### 1. Sheets → DB 全同步（學生、出勤、計費歷史）

```bash
npx tsx scripts/run-sync.ts sync
```

- 同步 persons、enrollments、monthly_attendance
- 匯入 Sheets 計費日期表的歷史 FLAG

### 2. 生成收費單記錄（含 FLAG 同步）

```bash
npx tsx scripts/run-sync.ts generate
```

- 自動先執行 `pullBillingHistory()`（同步 FLAG）
- 掃描所有 active enrollment
- 累計 Y 值達門檻 → 建立 invoice（status=draft）
- 支援 while loop：同一學生若出勤夠多，可連續生成多張

### 3. 生成 PDF

```bash
npx tsx scripts/generate_and_sync.ts generate
```

- 查詢 `WHERE status='draft' AND pdf_path IS NULL`
- XeLaTeX 編譯 → 輸出到 `generated_invoices_latex/`
- 成功後更新 `pdf_path`

### 4. 同步回 Sheets（校對 PDF 後）

```bash
npx tsx scripts/generate_and_sync.ts sync
```

- 查詢 `WHERE status='draft' AND pdf_path IS NOT NULL`
- 回寫計費日期表（count +1, 新增 start/end date）
- 可選：`--only 546,579` 只同步指定 sheets_id

### 5. FLAG 比對工具

```bash
npx tsx scripts/compare-flags.ts
```

- 比對 Sheet 計費日期表 vs DB 最後 invoice end_date
- 顯示不一致清單

---

## 六、標準工作流（月度出帳）

```
Step 1: 確認 Google Sheets 出勤已更新
Step 2: npx tsx scripts/run-sync.ts sync          # 同步 Sheets → DB
Step 3: npx tsx scripts/run-sync.ts generate       # 生成收費單記錄
Step 4: npx tsx scripts/generate_and_sync.ts generate  # 生成 PDF
Step 5: 手動校對 PDF（檢查日期、金額、學生姓名）
Step 6: npx tsx scripts/generate_and_sync.ts sync  # 回寫 Sheets
```

### 校對重點

- 日期是否正確（特別注意月份跨越）
- 金額是否符合方案
- 學生姓名、班級
- 拆分註記是否合理

---

## 七、Serial Number 格式

```
YY-SSS-MM-C-NN
```

| 欄位 | 說明 | 程式碼 | 範例 |
|------|------|--------|------|
| YY | 學年碼 | `YEAR_CODE = '26'` | 26（114 學年 = 2026） |
| SSS | sheetsId 末 3 碼 | `sheetsId.slice(-3).padStart(3, '0')` | 583 |
| MM | 計費起始月份 | `months[0]`（2 位） | 01 |
| C | classCode | `enrollment.classCode` | M / N |
| NN | 該 enrollment 第幾張 | `existingCount + 1`（2 位） | 05 |

範例：`26-583-01-M-05` = 26 學年、學生 583、1 月起、M 班、第 5 張

### Hash 生成

```
SHA256("{serial}|{sheetsId}|{amount}|{subject}")
取前 8 字元，大寫
```

用途：QR Code 驗證連結 `https://jpl.app/verify/{hash}`

---

## 八、計費演算法 (`billing-engine.ts`)

### 正常模式（normal）

1. 按日期順序遍歷出席紀錄
2. 累加 Y 值：YY=2Y, Y=1Y
3. 當累積達到結算點（方案 A: 8Y, 方案 B: 10Y）時，產生收費單
4. **拆分邏輯**：若最後一筆 YY 會超過結算點
   - 只取所需的 Y（例如需 1Y 就只算半堂）
   - 剩餘 Y 歸入下期
   - 產生拆分註記

### 計算公式

```
結算 Y 數 = settlementSessions × 2
結算金額 = settlementSessions × fullSessionFee

實際金額 = Σ(每筆 fee)
  其中：YY 正常 → fullSessionFee
       Y 正常 → halfSessionFee
       YY 拆分 → halfSessionFee（只算一半）
```

### 拆分範例

方案 B，已累積 9Y，下一筆是 YY（2Y）：
- 需 10Y - 9Y = 1Y → 拆分
- 此 YY 只算 1Y，收 $400
- 剩餘 1Y 歸入下期
- 本期總額 = 9Y 的金額 + $400 = $4,000
- 註記：`(註：MM/DD上課3小時，計費1.5hr，尚有1.5hr未記入本次收費，下次收取)`

### 強制模式（force）

- 不等結算點，有多少算多少
- 用於學生退班或學期末結算

---

## 九、收費單 PDF 格式

- 引擎：XeLaTeX（`templates/invoice.tex` 模板）
- 日期表：每行 5 格，最多 2 行（純 YY 為 1 行 5 格；有拆分則 2 行 10 格）
- 印花稅章 + 大印章
- QR Code（驗證連結）
- 「註」欄位：拆分時自動生成

### 模板佔位符

| 佔位符 | 值 |
|-------|---|
| `<<SERIAL>>` | 序號 |
| `<<HASH>>` | 驗證碼 |
| `<<NAME>>` | 學生姓名 |
| `<<SUBJECT>>` | 科目 |
| `<<BILLING_DATE>>` | 開立日期 |
| `<<TOTAL_FEE>>` | 金額 |
| `<<SESSION_INFO>>` | 次數+時數（如 "5次15H"） |
| `<<DATE_TABLE_TOP>>` | 日期表（含標題） |
| `<<DATE_TABLE_BOTTOM>>` | 日期表（不含標題） |
| `<<QR_URL>>` | 驗證連結 |
| `<<STAMP_TAX_PATH>>` | 印花稅章圖片 |
| `<<STAMP_LARGE_PATH>>` | 大印章圖片 |

---

## 十、FLAG 機制

**FLAG = 上一張收費單的 endDate**

```
getLastInvoiceEndDate(enrollmentId) → Date | null
getBillableAttendance(enrollmentId, afterDate) → AttendanceEntry[]
```

- 新收費單的 `startDate` = FLAG 之後的第一筆出勤日期
- 若沒有歷史收費單（FLAG = null），則從該學生最早的出席紀錄開始計費
- `pullBillingHistory()` 從 Sheets 計費日期表同步歷史 FLAG 到 DB

### FLAG 同步注意事項

1. Sheet 計費日期表的日期對是 (startDate, endDate)
2. DB 的 FLAG = 最後一張 invoice 的 end_date
3. 若兩邊不一致（compare-flags.ts 可偵測），需手動釐清
4. 日期格式問題：Sheet 有時用 DD/MM/YYYY（Excel 自動轉），DB 一律 YYYY-MM-DD

---

## 十一、日期跳脫（正常現象）

- 學生請假（V）、缺席、寒暑假等會造成日期不連續
- 系統只計算 Y/YY 出勤，中間的 V/N 自然跳過
- 例：591 林彥祺 2/8 請假(V) → 日期從 2/1 跳到 2/22
- **這不是 bug**，收費單上顯示的就是實際上課日期

---

## 十二、過渡期注意事項

1. **DB 與 Sheets 雙向同步**：DB 為主，但必須回寫 Sheets 保持一致
2. **歷史資料**：2025 年的收費單從 Sheets 計費日期表匯入，status=paid
3. **永久停止學生**：status='永久停止'，generateInvoice 直接跳過
4. **金額不符警告**：早期收費單（方案 A 第 1 張）可能有手動調整的金額差異，屬已知情況

---

## 十三、交互檢核邏輯

### 核心概念

系統中有三個數字必須互相一致：

```
上課次數（Y 值）  ←→  收費單張數  ←→  收入金額
      ↑                    ↑              ↑
  出勤紀錄統計        DB invoices 表    Σ(amount)
```

任何一對不一致，就代表有錯（多開、少開、漏計出勤、金額錯誤）。

### 四項檢核等式

#### ① 上課次數 → 收費單張數

```
floor(totalY ÷ settlementY) = invoiceCount
```

| 項目 | 來源 |
|------|------|
| totalY | DB: 所有 monthly_attendance 中 status=2(Y) 或 3(YY) 的加總。YY=2Y, Y=1Y |
| settlementY | 方案 A: 8Y, 方案 B: 10Y（= settlementSessions × 2） |
| invoiceCount | DB: 該 enrollment 的 invoices 張數 |

**範例（方案 B）**：學生上了 27 次全堂（YY）
```
totalY = 27 × 2 = 54Y
settlementY = 10Y
期望張數 = floor(54 ÷ 10) = 5 張
```

**不一致 → 可能原因**：
- 大於期望 → 多開了收費單（重複生成）
- 小於期望 → FLAG 錯誤導致漏算、或 pullBillingHistory 漏匯入

#### ② 收費單張數 → 收入金額

```
invoiceCount × planAmount = totalRevenue
```

| 項目 | 來源 |
|------|------|
| planAmount | 方案 A: $3,000, 方案 B: $4,000 |
| totalRevenue | DB: Σ(invoices.amount) for this enrollment |

**例外**：
- 拆分收費單的金額仍然 = planAmount（拆分只影響 Y 分配，不影響總金額）
- 歷史第 1 張可能有手動調整（已知情況，warning 容許）

#### ③ 未結算餘額

```
unbilledY = totalY - (invoiceCount × settlementY)
```

**必須滿足**：`0 ≤ unbilledY < settlementY`

| 條件 | 意義 |
|------|------|
| unbilledY = 0 | 剛好結算完，沒有餘額 |
| 0 < unbilledY < settlementY | 正常，等下次湊滿門檻 |
| unbilledY < 0 | 多開了收費單（嚴重錯誤） |
| unbilledY ≥ settlementY | 漏開了收費單（FLAG 或 generate 有問題） |

#### ④ 三角驗算（最終確認）

```
totalRevenue = floor(totalY ÷ settlementY) × planAmount
```

直接從出勤紀錄算出應收金額，跳過中間步驟驗算。

### 檢核範例

```
學生：591 林彥祺（方案 B, $800/次, 5次結算, $4,000/張）

出勤統計：
  YY × 25 次 = 50Y
  Y  × 0 次  = 0Y
  totalY = 50Y

① 期望張數 = floor(50 ÷ 10) = 5 張
   DB 實際 = 5 張 ✅

② 期望收入 = 5 × $4,000 = $20,000
   DB 實際 = $20,000 ✅

③ 未結算 = 50 - (5 × 10) = 0Y
   0 ≤ 0 < 10 ✅

④ 三角驗算 = floor(50 ÷ 10) × $4,000 = $20,000 ✅
```

### 拆分情況的檢核

拆分不影響等式成立。例：

```
學生累積 9Y，下一筆 YY（2Y）→ 拆分
  本期：取 1Y → 湊滿 10Y → 開單 $4,000
  下期：餘 1Y 帶入

totalY 仍然正確計算（拆分只是把 1Y 延後，不會憑空多出或消失）
```

### 實作狀態

> **目前狀態：待實作**
>
> 現有系統只有：
> - `compare-flags.ts`：比對 Sheet FLAG vs DB FLAG（單項檢核）
> - `billing-history-importer.ts`：匯入時 Sheet 金額 vs 計算金額比對（warning）
>
> 尚未實作完整的三角交互檢核。建議加入 `scripts/run-sync.ts audit` 指令。

---

## 十四、DB Schema

### invoices

| 欄位 | 類型 | 說明 |
|------|------|------|
| serialNumber | String @unique | 序號（如 26-583-01-M-05） |
| hashCode | String | 驗證碼（SHA256 前 8 碼） |
| enrollmentId | Int | FK → enrollments |
| startDate | DateTime | 計費起始日期 |
| endDate | DateTime | 計費結束日期（= 下一期 FLAG） |
| amount | Int | 金額 |
| yyCount | Int | YY 次數 |
| yCount | Int | Y 次數 |
| totalY | Int | 總 Y 數 |
| records | Json | 計費明細 JSONB |
| note | String? | 拆分註記 |
| pdfPath | String? | PDF 檔案路徑 |
| status | String | **draft** / **paid** |
| issuedDate | DateTime? | 開立日期 |

### payments

| 欄位 | 類型 | 說明 |
|------|------|------|
| enrollmentId | Int | FK → enrollments |
| invoiceId | Int | FK → invoices |
| amount | Int | 繳費金額 |
| paymentDate | DateTime | 繳費日期 |
| method | String | 繳費方式 |
| transferRef | String? | 轉帳編號 |

### monthly_attendance

| 欄位 | 類型 | 說明 |
|------|------|------|
| enrollmentId | Int | FK → enrollments |
| year | Int | 年份 |
| month | Int | 月份 |
| days | Int[] | 長度 31 陣列，index 0 = 1 號，值 0/1/2/3 |

---

## 十五、歷史匯入邏輯 (`billing-history-importer.ts`)

### 資料來源

| 資料 | Google Sheet | 欄位位置 |
|------|-------------|---------|
| 起止日期 | 計費日期表 | col A=sheetsId, col D=張數, col E+ 成對日期 |
| 收費金額 | 繳費金額表 | col A=sheetsId, col F=張數, col G+ 金額 |
| 繳費日期 | 繳費日期表 | col A=sheetsId, col E=張數, col G+ Excel 序號 |
| 費率門檻 | 學費收支總表 | col S=prepThreshold, col T=feeThreshold |

### 處理流程

1. 從 Sheets 取得 startDate, endDate, sheetAmount, paymentDate
2. 查 DB monthly_attendance 取得該區間出席紀錄
3. 用 billing-engine 計算 records JSONB + 驗證金額
4. **金額以 Sheet 為準**（歷史 truth）
5. 若 Sheet 金額 ≠ 計算金額 → 記錄 warning（不阻斷）
6. 建立 invoice（serial, hash, amount=sheetAmount, status）
7. 若有 paymentDate → 建立 payment + 標記 status='paid'

---

## 十六、已知問題與修正紀錄

| 日期 | 問題 | 修正 |
|------|------|------|
| 2026/03/16 | `invoice-generator.ts` 建立 status='pending'，但 `generate_and_sync.ts` 查 'draft' | 統一改為 'draft' |
| 2026/03/16 | 歷史 invoice 日期時區偏差（UTC-1天） | 批次修正 1432 筆 |
| 2026/03/16 | 583 林胤呈 第 5 張漏建（同 start date 01/25 被跳過） | 手動補建 |
| 2026/03/16 | serial 跳號（如 01,02,04,05 缺 03）| 歷史匯入遺留，不影響功能 |
