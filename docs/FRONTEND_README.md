# JPL 補習班管理系統 — 前端

## 技術架構

- **框架**: Next.js 16 App Router + Turbopack
- **認證**: NextAuth v5 (Google OAuth)
- **樣式**: Tailwind CSS v4 + PostCSS
- **圖示**: lucide-react
- **資料**: Server Components + Prisma 7 直接查詢（無 API 層）
- **變動**: Server Actions（點名儲存）

## 頁面結構

```
src/app/
├── layout.tsx              # Root layout (Geist 字體)
├── login/page.tsx          # Google OAuth 登入頁
├── (dashboard)/
│   ├── layout.tsx          # 側邊欄 + auth 檢查
│   ├── page.tsx            # 總覽 (stats + 最近收費單)
│   ├── attendance/
│   │   ├── page.tsx        # 班級列表（依年次分組）
│   │   └── [className]/
│   │       ├── page.tsx    # 點名表（server component）
│   │       ├── attendance-form.tsx  # 互動點名（client）
│   │       └── actions.ts  # saveAttendance server action
│   ├── billing/page.tsx    # 收費管理（所有學生）
│   ├── semester-fees/page.tsx  # 書籍雜費（114 學年）
│   └── students/page.tsx   # 學生管理
```

## 認證機制

- Google OAuth via NextAuth v5
- `ALLOWED_EMAILS` 白名單控制（空值 = 全部放行）
- Dashboard layout 層 `auth()` 檢查 session
- 開發模式：`.env` 設 `AUTH_BYPASS=1` 跳過驗證

## 開發

```bash
# 需先設定 .env（見 .env.example 或現有 .env）
npm run dev
# 開發模式預覽（跳過登入）
# 確認 .env 中 AUTH_BYPASS=1
```

## 部署前須設定

1. GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID
   - Authorized redirect URI: `https://your-domain/api/auth/callback/google`
2. `.env` 填入:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `ALLOWED_EMAILS` (呂老師的 Google email)
   - `NEXTAUTH_URL` (部署後的 URL)
   - `NEXTAUTH_SECRET` (用 `openssl rand -base64 32` 生成)
3. 移除 `AUTH_BYPASS=1`

## 點名功能

- 選班級 → 選日期（預設今天）→ 點學生狀態按鈕
- 狀態循環：未到 → YY → Y → 到 → 未到
- 快速操作：全部 YY / 全部 Y / 全部清除
- 日期導航：左右箭頭 + 日期選擇器
- 底部「儲存點名」按鈕（sticky）

## 已知待辦

- [ ] 學生詳細頁 `/students/[sheetsId]`
- [ ] 收費單生成 / PDF 下載按鈕
- [ ] 書籍雜費標記已繳按鈕
- [ ] 同步工具頁面 `/sync`
- [ ] 手機版 UI 微調
