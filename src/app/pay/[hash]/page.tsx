/**
 * /pay/[hash] — 掃碼銷帳頁面
 *
 * 掃描收費單 QR code 後：
 * 1. 未登入 → 跳轉 Google OAuth 登入
 * 2. 非 johansoros@gmail.com → 顯示無權限
 * 3. 已登入且是呂老師 → 顯示收費單資訊 + 一鍵銷帳
 */
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth/config';
import { redirect } from 'next/navigation';
import { PayButton } from './PayButton';

interface Props {
  params: Promise<{ hash: string }>;
}

export default async function PayPage({ params }: Props) {
  const { hash } = await params;

  // 1. 查找 invoice by hashCode
  const invoice = await prisma.invoice.findFirst({
    where: { hashCode: hash },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
  });

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-sm">
          <div className="text-4xl mb-4">❌</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">找不到收費單</h1>
          <p className="text-gray-500">驗證碼無效或收費單不存在。</p>
        </div>
      </div>
    );
  }

  // 2. 檢查登入狀態
  const session = await auth();
  if (!session?.user?.email) {
    // 未登入 → 跳轉登入，登入後回來
    redirect(`/api/auth/signin?callbackUrl=/pay/${hash}`);
  }

  const isAuthorized = session.user.email.toLowerCase() === 'johansoros@gmail.com';

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-sm">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">無權限</h1>
          <p className="text-gray-500">只有管理者可以進行銷帳操作。</p>
          <p className="text-xs text-gray-400 mt-2">登入帳號：{session.user.email}</p>
        </div>
      </div>
    );
  }

  // 3. 已登入且有權限 → 顯示收費單資訊
  const isPaid = invoice.status === 'paid';
  const startDate = invoice.startDate.toISOString().slice(0, 10);
  const endDate = invoice.endDate.toISOString().slice(0, 10);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">{isPaid ? '✅' : '📋'}</div>
          <h1 className="text-xl font-bold text-gray-900">
            {isPaid ? '已銷帳' : '收費單銷帳'}
          </h1>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">編號</span>
            <span className="font-mono font-medium">{invoice.serialNumber}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">學生</span>
            <span className="font-medium">{invoice.enrollment.person.name}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">科目</span>
            <span>{invoice.enrollment.subject}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">期間</span>
            <span>{startDate} ~ {endDate}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">金額</span>
            <span className="text-lg font-bold text-blue-700">${invoice.amount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">狀態</span>
            <span className={`font-medium ${isPaid ? 'text-green-600' : 'text-amber-600'}`}>
              {isPaid ? '已繳費' : '待收費'}
            </span>
          </div>
          {isPaid && invoice.paidDate && (
            <div className="flex justify-between py-2 border-t border-gray-100">
              <span className="text-gray-500">繳費日期</span>
              <span className="text-green-600">{invoice.paidDate.toISOString().slice(0, 10)}</span>
            </div>
          )}
        </div>

        {!isPaid && (
          <PayButton invoiceId={invoice.id} serial={invoice.serialNumber} />
        )}

        {isPaid && (
          <div className="text-center text-sm text-gray-400">
            此收費單已銷帳完成。
          </div>
        )}
      </div>
    </div>
  );
}
