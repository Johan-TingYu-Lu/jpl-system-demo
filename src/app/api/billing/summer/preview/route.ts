/**
 * POST /api/billing/summer/preview
 *
 * 暑期結算 dry-run：回傳每位高一高二學生會開出什麼（節次、Y、金額、跳過原因）。
 * 只讀，不寫任何東西、不開單。
 */
import { NextResponse } from 'next/server';
import { previewSummerSettlement } from '@/lib/summer-settlement';

export async function POST() {
  try {
    const lines = await previewSummerSettlement();
    const willBill = lines.filter(l => l.skip === null);
    const summary = {
      totalStudents: lines.length,
      willBill: willBill.length,
      skipped: lines.length - willBill.length,
      totalAmount: willBill.reduce((s, l) => s + l.totalFee, 0),
    };
    return NextResponse.json({ success: true, summary, lines });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
