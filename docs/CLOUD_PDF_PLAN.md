# Cloud Run PDF 生成 — 工作項目

## 目標
讓 Cloud Run 上的 jpl-app 能直接生成收費單 PDF（目前只有本機可以）。

---

## 1. Docker 環境準備

### 1-1. 基礎映像改為 Debian
- 目前：`node:22-alpine`（無法裝 TeX Live）
- 改為：`node:22-bookworm-slim`（Debian，支援 apt 安裝）

### 1-2. 安裝 TeX Live（最小化）
```
apt-get install -y --no-install-recommends \
  texlive-xetex \
  texlive-latex-extra \
  texlive-fonts-recommended \
  lmodern
```
- 預估增加 ~500-700 MB

### 1-3. 安裝中文字體 — 標楷體
- 來源：`C:\Windows\Fonts\kaiu.ttf`
- 複製到專案：`fonts/kaiu.ttf`
- Dockerfile 中安裝到 `/usr/share/fonts/truetype/` + `fc-cache`

### 1-4. 複製印章圖檔
- `Stamp/印花稅 (1).jpg` → `assets/stamp-tax.jpg`
- `Stamp/大印數位檔.jpg` → `assets/stamp-large.jpg`
- Dockerfile COPY 到容器內

### 1-5. 複製 LaTeX 模板
- `templates/invoice.tex` → 確保 COPY 到容器

---

## 2. pdf-renderer.ts 調整

### 2-1. 路徑改為容器內路徑
- `STAMP_DIR` → `/app/assets/`
- `XELATEX_PATH` → `/usr/bin/xelatex`（TeX Live 預設）
- `TEMPLATE_PATH` → `/app/templates/invoice.tex`

### 2-2. 輸出目錄改為 `/tmp/`
- Cloud Run 檔案系統是唯讀的（除了 `/tmp/`）
- `OUTPUT_DIR` → `/tmp/invoices/`
- PDF 生成後直接回傳 response，不依賴持久儲存

### 2-3. （可選）上傳 GCS
- 生成 PDF 後上傳到 GCS bucket
- 好處：PDF 持久保存、可分享連結
- 暫不做，先用即時生成

---

## 3. 前端 — 收費管理頁面

### 3-1. 每行加「下載 PDF」按鈕
- 有 invoice 的行顯示「下載」按鈕
- 點擊 → `GET /api/invoices/[id]/pdf` → 瀏覽器下載

### 3-2. PDF API 調整
- `GET /api/invoices/[id]/pdf`：
  - 如果 `pdfPath` 存在且檔案在 → 直接回傳
  - 否則 → 即時呼叫 `renderInvoicePdf()` → 回傳
- 這樣不需要預先生成 PDF，按需即時產出

---

## 4. Dockerfile 最終結構

```dockerfile
# Stage 1: deps（不變）
FROM node:22-bookworm-slim AS deps
...

# Stage 2: builder（不變）
FROM node:22-bookworm-slim AS builder
...

# Stage 3: runner
FROM node:22-bookworm-slim AS runner

# 安裝 TeX Live + 字體
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-xetex texlive-latex-extra texlive-fonts-recommended \
    fontconfig && \
    rm -rf /var/lib/apt/lists/*

# 複製字體
COPY fonts/kaiu.ttf /usr/share/fonts/truetype/
RUN fc-cache -fv

# 複製印章 + 模板
COPY assets/ ./assets/
COPY templates/ ./templates/

# ...其餘不變
```

---

## 5. 環境變數

| 變數 | Cloud Run 值 | 說明 |
|------|-------------|------|
| `XELATEX_PATH` | `/usr/bin/xelatex` | TeX Live 預設路徑 |
| `STAMP_DIR` | `/app/assets` | 印章圖檔目錄 |
| `VERIFY_BASE_URL` | `https://jpl-app-28194680926.asia-east1.run.app/verify` | QR Code 連結 |

---

## 6. 成本影響

| 項目 | 變化 |
|------|------|
| Docker image 大小 | ~150 MB → ~800 MB |
| 冷啟動時間 | ~3 秒 → ~10-15 秒 |
| 記憶體需求 | 256 MB → 512 MB |
| 月增費用 | < $1 USD（免費額度內） |

---

## 7. 注意事項

- [ ] 標楷體 `kaiu.ttf` 是微軟字體，僅限合法授權使用（補習班有 Windows 授權）
- [ ] Cloud Run `/tmp/` 最大 512 MB，足夠暫存 PDF
- [ ] 印章圖檔不應公開（Docker image 是私有 Artifact Registry，OK）
- [ ] qrcode LaTeX 套件需確認是否在 `texlive-latex-extra` 內
- [ ] `dashundergaps` 套件需確認是否在 `texlive-latex-extra` 內

---

## 8. 執行順序

1. 複製字體、印章、模板到專案目錄
2. 修改 Dockerfile（改 base image + 安裝 TeX）
3. 修改 pdf-renderer.ts（路徑 + /tmp/ 輸出）
4. 修改 PDF API（即時生成模式）
5. 前端加「下載 PDF」按鈕
6. 本機 docker build 測試（如果有 Docker Desktop）
7. Cloud Build + Deploy
8. 線上測試生成 + 下載 PDF
