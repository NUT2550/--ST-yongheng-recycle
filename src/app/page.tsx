'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { PageTab } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  ShoppingCart,
  Coins,
  RefreshCw,
  PackageOpen,
  Package,
  CreditCard,
  ClipboardList,
  Menu,
  Factory,
  Gift,
  Users,
  LogOut,
  Loader2,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BuyPage } from '@/components/buy-page';
import { SellPage } from '@/components/sell-page';
import { SortPage } from '@/components/sort-page';
import { TransferPage } from '@/components/transfer-page';
import { DashboardPage } from '@/components/dashboard-page';
import { StockPage } from '@/components/stock-page';
import { CreditPage } from '@/components/credit-page';
import { BonusPage } from '@/components/bonus-page';
import { HistoryPage } from '@/components/history-page';
import UsersPage from '@/components/users-page';
import ProductsPage from '@/components/products-page';
import DailyWeighingPage from '@/components/daily-weighing-page';
import LoginPage from '@/components/login-page';
import { toast } from 'sonner';
import { getAuthToken, setAuthToken } from '@/lib/api';
import { canAccessPage } from '@/lib/permissions';

// Navigation items configuration
const navItems: Array<{
  tab: PageTab;
  label: string;
  icon: React.ElementType;
  color: string;
}> = [
  { tab: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard, color: 'text-amber-600' },
  { tab: 'buy', label: 'รับซื้อ', icon: ShoppingCart, color: 'text-green-600' },
  { tab: 'sell', label: 'ขาย', icon: Coins, color: 'text-blue-600' },
  { tab: 'sort', label: 'คัดแยก', icon: RefreshCw, color: 'text-purple-600' },
  { tab: 'transfer', label: 'แกะของ', icon: PackageOpen, color: 'text-cyan-600' },
  { tab: 'stock', label: 'สต๊อก', icon: Package, color: 'text-orange-600' },
  { tab: 'credit', label: 'เครดิต', icon: CreditCard, color: 'text-rose-600' },
  { tab: 'bonus', label: 'โบนัส', icon: Gift, color: 'text-pink-600' },
  { tab: 'history', label: 'ประวัติ', icon: ClipboardList, color: 'text-teal-600' },
  { tab: 'daily-weighing', label: 'ชั่งยอดซื้อทองแดง/ทองเหลือง', icon: Scale, color: 'text-emerald-600' },
];

// Page content renderer
function PageContent({ activeTab }: { activeTab: PageTab }) {
  switch (activeTab) {
    case 'dashboard':
      return <DashboardPage />;
    case 'buy':
      return <BuyPage />;
    case 'sell':
      return <SellPage />;
    case 'sort':
      return <SortPage />;
    case 'transfer':
      return <TransferPage />;
    case 'stock':
      return <StockPage />;
    case 'credit':
      return <CreditPage />;
    case 'bonus':
      return <BonusPage />;
    case 'history':
      return <HistoryPage />;
    case 'users':
      return <UsersPage />;
    case 'products':
      return <ProductsPage />;
    case 'daily-weighing':
      return <DailyWeighingPage />;
    default:
      return <DashboardPage />;
  }
}

// Sidebar navigation
function SidebarNav({
  activeTab,
  setActiveTab,
  orientation = 'vertical',
  onNavigate,
  items = navItems,
}: {
  activeTab: PageTab;
  setActiveTab: (tab: PageTab) => void;
  orientation?: 'vertical' | 'horizontal';
  onNavigate?: () => void;
  items?: Array<{ tab: PageTab; label: string; icon: React.ElementType; color: string }>;
}) {
  return (
    <nav
      className={cn(
        orientation === 'vertical'
          ? 'flex flex-col gap-1 p-3'
          : 'flex flex-row items-center justify-around gap-0 p-1'
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.tab;
        return (
          <Button
            key={item.tab}
            variant={isActive ? 'secondary' : 'ghost'}
            className={cn(
              orientation === 'vertical'
                ? 'justify-start gap-3 h-11 px-3 font-normal'
                : 'flex-col h-auto py-2 px-3 font-normal flex-1 min-w-0',
              isActive
                ? 'bg-amber-100 text-amber-900 hover:bg-amber-100 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            )}
            onClick={() => {
              setActiveTab(item.tab);
              onNavigate?.();
            }}
          >
            <Icon
              className={cn(
                orientation === 'vertical' ? 'h-5 w-5' : 'h-5 w-5',
                isActive ? item.color : 'text-gray-400'
              )}
            />
            <span
              className={cn(
                orientation === 'vertical' ? 'text-sm' : 'text-[11px] leading-tight',
                'truncate'
              )}
            >
              {item.label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}

// Main App component
export default function Home() {
  const { activeTab, setActiveTab } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const triggerZoneRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [user, setUser] = useState<{
    id: string;
    username: string;
    name: string;
    role: 'admin' | 'staff';
    permissions: Record<string, boolean>;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Check auth on mount
  const checkAuth = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/auth/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  async function handleLogout() {
    try {
      const token = getAuthToken();
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.success('ออกจากระบบสำเร็จ');
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    } finally {
      setAuthToken(null);
      setUser(null);
    }
  }

  // Mouse move handler for hover-to-reveal sidebar (declared before early returns to satisfy Rules of Hooks)
  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Only on desktop (lg+)
    if (window.innerWidth < 1024) return;

    const mouseX = e.clientX;

    // If mouse is within 20px of left edge, show sidebar
    if (mouseX <= 20) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setSidebarOpen(true);
      return;
    }

    // If sidebar is open and mouse moves outside sidebar area, start hide timer
    if (sidebarOpen && sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const isOverSidebar =
        mouseX >= sidebarRect.left &&
        mouseX <= sidebarRect.right &&
        e.clientY >= sidebarRect.top &&
        e.clientY <= sidebarRect.bottom;

      if (!isOverSidebar) {
        // Delay hide to prevent accidental close
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => {
            setSidebarOpen(false);
            hideTimerRef.current = null;
          }, 300);
        }
      } else {
        // Mouse is over sidebar, cancel hide timer
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }
    }
  }, [sidebarOpen]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [handleMouseMove]);

  // Close sidebar when clicking outside
  useEffect(() => {
    if (!sidebarOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    };

    // Delay adding listener to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [sidebarOpen]);

  // Show loading screen while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage onSuccess={checkAuth} />;
  }

  // Filter nav items based on role (admin only for users + products tabs)
  const permittedNavItems = navItems.filter((item) => canAccessPage(user, item.tab));
  const visibleNavItems = user.role === 'admin'
    ? [...navItems,
       { tab: 'products' as PageTab, label: 'สินค้า', icon: Package, color: 'text-indigo-600' },
       { tab: 'users' as PageTab, label: 'ผู้ใช้งาน', icon: Users, color: 'text-purple-600' }]
    : permittedNavItems;
  const safeActiveTab = visibleNavItems.some((item) => item.tab === activeTab)
    ? activeTab
    : 'dashboard';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center h-14 px-4 lg:px-6">
          {/* Mobile menu */}
          <div className="lg:hidden mr-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Menu className="h-5 w-5 text-gray-600" />
                  <span className="sr-only">เปิดเมนู</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetTitle className="sr-only">เมนูนำทาง</SheetTitle>
                <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-200">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-amber-600 text-white">
                    <Factory className="h-5 w-5" />
                  </div>
                  <div>
                    <h1 className="text-sm font-bold text-gray-900 leading-tight">
                      ยงเฮง มหาชัย
                    </h1>
                    <p className="text-[11px] text-gray-500 leading-tight">
                      รีไซเคิล
                    </p>
                  </div>
                </div>
                <ScrollArea className="h-[calc(100vh-3.5rem)]">
                  <SidebarNav
                    activeTab={safeActiveTab}
                    setActiveTab={setActiveTab}
                    orientation="vertical"
                    items={visibleNavItems}
                  />
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>

          {/* Logo & Shop name */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-amber-600 text-white">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight sm:text-base">
                บจก. ยงเฮง มหาชัย รีไซเคิล
              </h1>
              <p className="text-[11px] text-gray-500 leading-tight hidden sm:block">
                ร้านรับซื้อเหล็กและโลหะ
              </p>
            </div>
          </div>

          {/* Active tab indicator on mobile + user info + logout */}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <span className="text-gray-500">{user.name}</span>
              {user.role === 'admin' && (
                <Badge variant="secondary" className="bg-purple-100 text-purple-800 text-[10px]">
                  ผู้ดูแล
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">ออกจากระบบ</span>
            </Button>
            <div className="lg:hidden">
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 text-xs"
              >
                {visibleNavItems.find((item) => item.tab === safeActiveTab)?.label}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar - auto-hide with hover reveal */}
        <aside
          ref={sidebarRef}
          className={cn(
            'hidden lg:flex lg:flex-col bg-white border-r border-gray-200 z-40',
            'fixed top-14 left-0 bottom-0 w-64',
            'transition-transform duration-200 ease-in-out',
            sidebarOpen
              ? 'translate-x-0 shadow-xl'
              : '-translate-x-full'
          )}
        >
          <div className="flex items-center justify-center py-3 px-4 border-b border-gray-100">
            <span className="text-xs text-gray-400 font-medium tracking-wide">
              เมนูหลัก
            </span>
          </div>
          <ScrollArea className="flex-1">
            <SidebarNav
              activeTab={safeActiveTab}
              setActiveTab={setActiveTab}
              orientation="vertical"
              onNavigate={() => setSidebarOpen(false)}
              items={visibleNavItems}
            />
          </ScrollArea>
          <Separator />
          <div className="p-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-800 font-medium">💡 คำแนะนำ</p>
              <p className="text-[11px] text-amber-600 mt-1">
                เอาเมาส์ไปด้านซ้ายเพื่อเปิดเมนู
              </p>
            </div>
          </div>
        </aside>

        {/* Hover trigger zone - invisible strip on left edge */}
        <div
          ref={triggerZoneRef}
          className="hidden lg:block fixed top-14 left-0 bottom-0 w-[2px] z-30"
          onMouseEnter={() => setSidebarOpen(true)}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 max-w-7xl mx-auto">
            <PageContent activeTab={safeActiveTab} />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden sticky bottom-0 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] safe-area-bottom">
        <SidebarNav
          activeTab={safeActiveTab}
          setActiveTab={setActiveTab}
          orientation="horizontal"
          items={visibleNavItems}
        />
      </nav>
    </div>
  );
}
