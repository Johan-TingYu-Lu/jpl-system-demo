/**
 * POST /api/billing/summer/settle
 *
 * 逐生暑期結算。
 *   body: { sheetsId: string, confirm?: boolean }
 *   - confirm 不為 true → dry-run：只回傳會開多少，不寫
 *   - confirm === true   → 真的開單（一張合併 draft 單）
 */
import { NextResponse } from 'next/server';
import { settleOneStudent } from '@/lib/summer-settlement';

export async function POST(request: Request) {
  let body: { sheetsId?: string; confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '無效的請求' }, { status: 400 });
  }
  const sheetsId = body.sheetsId?.trim();
  if (!sheetsId) {
    return NextResponse.json({ success: false, error: '缺少 sheetsId' }, { status: 400 });
  }

  try {
    const line = await settleOneStudent(sheetsId, body.confirm !== true);
    return NextResponse.json({ success: true, dryRun: body.confirm !== true, line });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
