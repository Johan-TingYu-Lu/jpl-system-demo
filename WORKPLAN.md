# JPL 補習班管理系統 — 工作計畫

> 最後更新：2026/03/15

## 已完成

### 後端
- [x] API 4 條：sync / students / attendance / verify
- [x] 計費引擎（YY/Y 計算、拆分邏輯、自動「註」生成）
- [x] 收費單 PDF 生成（XeLaTeX）— 可正常運作
- [x] Sheets 回寫（`generate_and_sync.ts sync`）— 可正常運作
- [x] 回寫 `--only` 篩選功能（避免全量同步汙染資料）
- [x] audit_log 回朔機制
- [x] DB 為 source of truth，Sheets 為輔助

### 業務規則（全部已確認 2026/03/15）
- [x] 費率方案 A（保留）/ B（現行）/ C（未來，邏輯同 A/B，僅金額不同）
- [x] 日期列：每行 5 格，最多 2 行（10 個日期）
- [x] 「註」欄位：系統自動生成拆分說明
- [x] 收費單結構：上半收費單 + 撕線 + 下半收據 + 第二頁付款說明
- [x] QR Code + 印章三枚 + 收費單編號 / 驗證碼

## 待辦

### 1. sync 腳本改善（優先）
- [ ] sync 執行前加 dry-run 模式（`--dry-run` 只印不寫）
- [ ] sync 加 audit log 記錄（目前 sync 沒有寫 audit_log）
- [ ] sync 完成後自動把 invoice status 從 `draft` 改為 `synced`，避免重複同步

### 2. 前端開發（主要工作）
- [ ] 規劃前端頁面範圍與路由
- [ ] Dashboard 首頁（學生總覽、待處理收費單）
- [ ] 學生管理頁
- [ ] 出席紀錄頁（記錄 Y / YY）
- [ ] 收費單管理頁（檢視、生成、下載 PDF）
- [ ] 費率方案設定頁
- [ ] QR Code 掃碼繳費確認頁

### 3. 其他
- [ ] 強制輸出功能（畢業生結算）
- [ ] 方案 C 上線時的切換機制
- [ ] 生產環境部署（GCP）

## 已知問題
- sync 無 `--only` 時會同步所有 draft invoice，操作需謹慎
- SSL 警告（pg-connection-string），功能不受影響，未來版本需處理
- `NODE_TLS_REJECT_UNAUTHORIZED=0` 不安全，正式環境需移除

## 日常操作流程
```bash
# 1. 生成 PDF
npx tsx scripts/generate_and_sync.ts generate

# 2. 手動校對 PDF（在 generated_invoices_latex/ 目錄）

# 3. 回寫 Sheets（指定學生）
npx tsx scripts/generate_and_sync.ts sync --only 546,579,611

# 3b. 回寫全部（謹慎使用）
npx tsx scripts/generate_and_sync.ts sync
```
