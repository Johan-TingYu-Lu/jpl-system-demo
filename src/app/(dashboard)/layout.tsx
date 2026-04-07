import { auth } from '@/lib/auth/config';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/sidebar';

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === '1';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName: string | null | undefined = '呂老師（開發模式）';

  if (!DEV_BYPASS) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    userName = session.user.name;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar userName={userName} />
      <main className="lg:ml-60 min-h-screen">
        <div className="p-4 lg:p-6 pt-14 lg:pt-6">
          {children}
        </div>
      </main>
    </div>
  );
}
