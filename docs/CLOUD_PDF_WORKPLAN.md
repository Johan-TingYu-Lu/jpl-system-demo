# 雲端版 PDF 收費單生成 — 工作項目

## 目標
在 Cloud Run 上直接生成 PDF 收費單，不依賴本機 XeLaTeX。

---

## 工作項目

### 1. Dockerfile 改造
- [ ] 基礎映像從 `node:22-alpine` 改為 `node:22-bookworm-slim`（Debian，支援中文字體）
- [ ] 安裝 `texlive-xetex texlive-latex-extra texlive-lang-chinese`（TeX Live 套件）
- [ ] 安裝 `texlive-fonts-recommended`（基礎字體）
- [ ] 預估映像大小增加：~150MB → ~800MB–1GB

### 2. 中文字體（標楷體）
- [ ] 從本機 `C:\Windows\Fonts\kaiu.ttf` 複製標楷體字體檔到專案 `assets/fonts/`
- [ ] Dockerfile 中複製字體到 `/usr/local/share/fonts/` 並執行 `fc-cache -fv`
- [ ] 驗證 XeLaTeX 能正確載入標楷體

### 3. 印章圖檔
- [ ] 從 `C:\Users\johan\Documents\NEW_SYSTEM\Stamp\` 複製印章圖檔到專案 `assets/stamps/`
  - `印花稅 (1).jpg`
  - `大印數位檔.jpg`
- [ ] 更新 `pdf-renderer.ts` 的 `STAMP_DIR` fallback 路徑
- [ ] Dockerfile 中確保 `assets/` 複製到 production image

### 4. LaTeX 模板
- [ ] 確認 `templates/invoice.tex` 已包含在 Docker image
- [ ] 驗證 `qrcode` LaTeX 套件可用（可能需要額外安裝 `texlive-pictures`）

### 5. PDF 輸出路徑
- [ ] Cloud Run 容器檔案系統是暫時的，PDF 需要：
  - **方案 A**：直接 stream 回瀏覽器（不存檔），用完即棄
  - **方案 B**：存到 GCS bucket，提供下載連結
- [ ] 建議先用方案 A（最簡單），需修改 `pdf-renderer.ts`：
  - 編譯 XeLaTeX → 讀取 PDF → 回傳 Buffer → 不保留檔案
  - 或用 `/tmp` 暫存（Cloud Run 有 in-memory `/tmp`）

### 6. 環境變數更新
- [ ] `XELATEX_PATH`：改為 `/usr/bin/xelatex`（Linux 路徑）
- [ ] `STAMP_DIR`：改為 `/app/assets/stamps`
- [ ] Cloud Run env vars 更新

### 7. 前端整合
- [ ] 收費管理頁面：「生成」按鈕成功後，顯示「下載 PDF」連結
- [ ] 新增 `/api/invoices/[id]/pdf` 的 GET 路由（已存在）
  - 修改：不讀本地檔案，改為即時編譯或從 GCS 取得
- [ ] 考慮批次下載（ZIP 打包多張收費單）

### 8. 測試驗證
- [ ] 本地 Docker build + 測試 PDF 生成
- [ ] 部署到 Cloud Run 測試
- [ ] 驗證 PDF 格式與現有收費單一致（對比樣本）
- [ ] 驗證 QR Code 可掃描

---

## 成本預估

| 項目 | 變化 |
|------|------|
| Docker 映像大小 | 150MB → ~800MB |
| 冷啟動時間 | 3s → 10-15s |
| 記憶體需求 | 256MB → 512MB |
| 每月 PDF 量 | ~20-30 張 |
| **月增成本** | **< $1 USD** |

## 風險

1. **標楷體版權**：標楷體是 Microsoft 授權字體，商業用途需確認授權
   - 替代方案：使用 Noto Sans CJK（Google 開源字體），但樣式不同
2. **冷啟動延遲**：映像變大會增加首次請求延遲，但後續請求不受影響
3. **記憶體限制**：XeLaTeX 編譯需要 ~256MB RAM，需確保 Cloud Run 分配足夠

---

## 執行順序建議
1. 先做 1-4（Docker + 字體 + 印章 + 模板）
2. 再做 5-6（輸出路徑 + 環境變數）
3. 最後做 7-8（前端 + 測試）
4. 預估工時：2-3 小時
