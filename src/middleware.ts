/**
 * Auth middleware — 保護所有頁面，/login 和 /api/verify 除外
 *
 * 開發模式：設 AUTH_BYPASS=1 於 .env 可跳過驗證
 * 正式環境：透過 NextAuth 的 auth() 在 layout 層檢查 session
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === '1';

export function middleware(request: NextRequest) {
  if (DEV_BYPASS) {
    return NextResponse.next();
  }
  // Production: auth check 在 (dashboard)/layout.tsx 的 auth() 處理
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|pay|api/auth|api/verify|api/invoices/.*/pay|_next/static|_next/image|favicon.ico).*)',
  ],
};
