/**
 * GET /api/invoices/[id]/receipt-image
 *
 * 回傳收費單「上半部」(收費單區塊) 的 PNG 圖片，方便截圖發家長。
 * 作法：沿用既有 PDF（pdfPath 或即時生成）→ pdftocairo 裁切第一頁上半部 → PNG。
 * 完全重用 XeLaTeX 排版，字型/對齊/日期格子全部與正式 PDF 一致。
 */
import { NextResponse } from 'next/server';
import { renderInvoicePdf } from '@/lib/pdf-renderer';
import prisma from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// pdftocairo：env 優先 → 從 XELATEX_PATH 同目錄推導 (MiKTeX 自帶) → PATH fallback (Linux/Cloud Run)
function resolvePdftocairo(): string {
  if (process.env.PDFTOCAIRO_PATH) return process.env.PDFTOCAIRO_PATH;
  const xelatex = process.env.XELATEX_PATH;
  if (xelatex) {
    const guess = path.join(path.dirname(xelatex), process.platform === 'win32' ? 'pdftocairo.exe' : 'pdftocairo');
    if (fs.existsSync(guess)) return guess;
  }
  const miktex = 'C:/Users/johan/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftocairo.exe';
  if (fs.existsSync(miktex)) return miktex;
  return 'pdftocairo'; // 交給 PATH
}

// A4 @ 150dpi = 1240 x 1754。上半部「收費單」到剪裁虛線約為頂端 ~33%。
const CROP = { dpi: 150, x: 0, y: 110, w: 1240, h: 460 };

async function resolvePdfPath(invoiceId: number): Promise<string | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { pdfPath: true },
  });
  if (invoice?.pdfPath && fs.existsSync(invoice.pdfPath)) return invoice.pdfPath;

  const result = await renderInvoicePdf(invoiceId);
  if (result.success && result.pdfPath && fs.existsSync(result.pdfPath)) return result.pdfPath;
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoiceId = parseInt(id);
  if (isNaN(invoiceId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const pdfPath = await resolvePdfPath(invoiceId);
  if (!pdfPath) {
    return NextResponse.json({ error: '無法取得 PDF（可能是無 records 的歷史收費單）' }, { status: 404 });
  }

  // 快取：PNG 放 PDF 旁邊，PDF 沒更新就重用
  const pngPath = pdfPath.replace(/\.pdf$/i, '_top.png');
  const fresh = fs.existsSync(pngPath) && fs.statSync(pngPath).mtimeMs >= fs.statSync(pdfPath).mtimeMs;

  if (!fresh) {
    // pdftocairo -singlefile 會輸出 <prefix>.png
    const prefix = pngPath.replace(/\.png$/i, '');
    try {
      execFileSync(resolvePdftocairo(), [
        '-png', '-r', String(CROP.dpi), '-f', '1', '-l', '1', '-singlefile',
        '-x', String(CROP.x), '-y', String(CROP.y), '-W', String(CROP.w), '-H', String(CROP.h),
        pdfPath, prefix,
      ], { timeout: 60000, stdio: 'pipe' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `裁切失敗: ${msg}` }, { status: 500 });
    }
  }

  if (!fs.existsSync(pngPath)) {
    return NextResponse.json({ error: 'PNG 生成失敗' }, { status: 500 });
  }

  const png = fs.readFileSync(pngPath);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
