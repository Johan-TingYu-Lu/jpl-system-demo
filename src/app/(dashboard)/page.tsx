import prisma from '@/lib/prisma';
import { LayoutDashboard, Users, Receipt, BookOpen, AlertCircle } from 'lucide-react';
import { calendarYearToAcademicYear } from '@/lib/year-config';

/** 取得當前學年代碼 */
function getCurrentAcademicYear(): number {
  const now = new Date();
  return calendarYearToAcademicYear(now.getFullYear(), now.getMonth() + 1);
}

async function getStats() {
  const currentYear = getCurrentAcademicYear();

  // 在學學生 = status active（endYear 歷史資料可能為 NULL，不做過濾）
  const activeStudents = await prisma.enrollment.count({
    where: { status: 'active' },
  });

  // 只算當前學年的 invoices（根據 issuedDate 落在該學年區間）
  const startDate = new Date(currentYear + 1911, 7, 1);  // 學年 8/1 開始
  const endDate = new Date(currentYear + 1912, 6, 30);   // 隔年 7/31 結束

  const [yearInvoices, unpaidInvoices, semesterFeesPending] = await Promise.all([
    prisma.invoice.count({
      where: {
        issuedDate: { gte: startDate, lte: endDate },
        enrollment: { status: 'active' },
      },
    }),
    prisma.invoice.count({
      where: {
        status: { in: ['draft', 'sent'] },
        enrollment: { status: 'active' },
      },
    }),
    prisma.semesterFee.count({
      where: {
        status: 'pending',
        academicYear: currentYear,
      },
    }),
  ]);

  // 最近收費單：只顯示在學學生的
  const recentInvoices = await prisma.invoice.findMany({
    where: {
      enrollment: { status: 'active' },
    },
    take: 8,
    orderBy: { createdAt: 'desc' },
    include: {
      enrollment: {
        include: { person: { select: { name: true } } },
      },
    },
  });

  return { activeStudents, yearInvoices, unpaidInvoices, semesterFeesPending, recentInvoices, currentYear };
}

export default async function DashboardPage() {
  const stats = await getStats();

  const cards = [
    { label: '在學學生', value: stats.activeStudents, icon: Users, color: 'text-blue-600 bg-blue-50' },
    { label: `${stats.currentYear} 收費單`, value: stats.yearInvoices, icon: Receipt, color: 'text-green-600 bg-green-50' },
    { label: '未繳費', value: stats.unpaidInvoices, icon: AlertCircle, color: stats.unpaidInvoices > 0 ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50' },
    { label: '雜費待收', value: stats.semesterFeesPending, icon: BookOpen, color: stats.semesterFeesPending > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="w-6 h-6 text-gray-400" />
        <h1 className="text-2xl font-bold text-gray-900">總覽</h1>
        <span className="text-sm text-gray-400 ml-auto">{stats.currentYear} 學年</span>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                <p className="text-sm text-gray-500">{card.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent invoices */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">最近收費單</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {stats.recentInvoices.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400">尚無收費單</div>
          ) : (
            stats.recentInvoices.map(inv => (
              <div key={inv.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">{inv.enrollment.person.name}</span>
                  <span className="text-sm text-gray-500 ml-2">{inv.enrollment.className}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">${inv.amount.toLocaleString()}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    inv.status === 'paid' ? 'bg-green-50 text-green-700' :
                    inv.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {inv.status === 'paid' ? '已繳' : inv.status === 'draft' ? '草稿' : '已發'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
