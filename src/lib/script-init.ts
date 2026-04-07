/**
 * script-init.ts — 腳本共用初始化
 *
 * 消除 23+ 份 scripts 中重複的 Prisma 初始化程式碼。
 *
 * Usage:
 *   import { prisma, initScript } from '../src/lib/script-init';
 *   // prisma 已可直接使用（透過 src/lib/prisma.ts singleton）
 *   // initScript() 提供 dotenv 載入 + 優雅 disconnect
 *
 * 或者最簡單的：
 *   import 'dotenv/config';
 *   import prisma from '../src/lib/prisma';
 *   // 腳本結束時 await prisma.$disconnect();
 *
 * 本模組提供一個 `runScript()` wrapper 來自動處理 dotenv + disconnect + error：
 *
 *   import { runScript, prisma } from '../src/lib/script-init';
 *   runScript(async () => { ... });
 */
import 'dotenv/config';
import prisma from './prisma';

// Re-export prisma for convenience
export { prisma };

/**
 * 腳本 wrapper：載入 dotenv、執行函式、自動 disconnect + error handling
 */
export function runScript(fn: () => Promise<void>): void {
  fn()
    .catch((e: unknown) => {
      console.error('❌ Script error:', e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

/**
 * 取得 Google Sheets API client（避免每個腳本重複初始化）
 */
export async function createSheetsApi() {
  // 延遲 import 避免非 Sheets 腳本載入 googleapis
  const { google } = await import('googleapis');
  const fs = await import('fs');

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set');

  const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  return google.sheets({ version: 'v4', auth });
}
