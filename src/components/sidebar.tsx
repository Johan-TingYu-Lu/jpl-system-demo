'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ClipboardCheck,
  Receipt,
  CreditCard,
  CheckCircle2,
  RefreshCw,
  BookOpen,
  Users,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/', label: '總覽', icon: LayoutDashboard },
  { href: '/attendance', label: '點名', icon: ClipboardCheck },
  { href: '/billing', label: '收費管理', icon: Receipt },
  { href: '/billing/paid', label: '已銷帳收費單', icon: CheckCircle2 },
  { href: '/billing/sync', label: '同步確認', icon: RefreshCw },
  { href: '/semester-fees', label: '書籍雜費', icon: BookOpen },
  { href: '/students', label: '學生管理', icon: Users },
];

export default function Sidebar({ userName }: { userName?: string | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <>
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">JPL 管理系統</h1>
        <p className="text-xs text-gray-500 mt-0.5">尬數理工文理補習班</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-gray-200">
        {userName && (
          <p className="px-3 py-1 text-xs text-gray-500 truncate">{userName}</p>
        )}
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors w-full"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            登出
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 bg-white rounded-lg shadow-md p-2"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar: desktop = always visible, mobile = slide in */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-60 bg-white border-r border-gray-200 flex flex-col z-50 transition-transform',
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Mobile close */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden absolute top-3 right-3"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>
        {navContent}
      </aside>
    </>
  );
}
