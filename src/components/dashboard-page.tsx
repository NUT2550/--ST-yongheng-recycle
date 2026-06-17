'use client';

import { useState, useEffect } from 'react';
import { fetchDashboard } from '@/lib/api';
import { DashboardData } from '@/lib/types';
import { formatBaht, formatWeight, formatDate } from '@/lib/helpers';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Package,
  ShoppingCart,
  Coins,
  Truck,
  Scissors,
  Weight,
} from 'lucide-react';

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  if (loading) return <DashboardSkeleton />;

  const d = data;

  // Group products by category
  const productsByCategory = new Map<string, { categoryName: string; products: DashboardData['productDetails'] }>();
  if (d) {
    for (const p of d.productDetails) {
      if (!productsByCategory.has(p.categoryId)) {
        productsByCategory.set(p.categoryId, { categoryName: p.categoryName, products: [] });
      }
      productsByCategory.get(p.categoryId)!.products.push(p);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">แดชบอร์ด</h2>
        <p className="text-gray-500 mt-1">
          ภาพรวมสถานะร้านยงเฮง มหาชัย รีไซเคิล
        </p>
      </div>

      {/* Summary Cards - Stock */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <SummaryCard
          title="สต๊อกทั้งหมด"
          value={d ? formatWeight(d.totalStockWeight) : '— กก.'}
          desc={d ? `ต้นทุนรวม ${formatBaht(d.totalStockCost)} บาท` : '— บาท'}
          icon={Package}
          theme="amber"
        />
        <SummaryCard
          title="สต๊อกจากการซื้อ"
          value={d ? formatWeight(d.buyStockWeight) : '— กก.'}
          desc={d ? `ต้นทุน ${formatBaht(d.buyStockCost)} บาท` : '— บาท'}
          icon={Truck}
          theme="green"
        />
        <SummaryCard
          title="สต๊อกจากคัดแยก"
          value={d ? formatWeight(d.sortingStockWeight) : '— กก.'}
          desc={d ? `ต้นทุน ${formatBaht(d.sortingStockCost)} บาท` : '— บาท'}
          icon={Scissors}
          theme="purple"
        />
      </div>

      {/* Today summary */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <SummaryCard
          title="รับซื้อวันนี้"
          value={d ? `${formatBaht(d.todayBuyAmount)} บาท` : '— บาท'}
          desc={d ? formatWeight(d.todayBuyWeight) : '— กก.'}
          icon={ShoppingCart}
          theme="green"
        />
        <SummaryCard
          title="ขายวันนี้"
          value={d ? `${formatBaht(d.todaySellAmount)} บาท` : '— บาท'}
          desc={d ? formatWeight(d.todaySellWeight) : '— กก.'}
          icon={Coins}
          theme="sky"
        />
      </div>

      {/* Detailed Stock by Category & Product */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Weight className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-lg font-semibold text-gray-900">
              รายละเอียดสต๊อกทั้งหมด
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {d && productsByCategory.size > 0 ? (
            <div className="divide-y divide-gray-100">
              {Array.from(productsByCategory.entries()).map(([catId, { categoryName, products }]) => {
                const catWeight = products.reduce((s, p) => s + p.totalWeight, 0);
                const catCost = products.reduce((s, p) => s + p.totalCost, 0);
                const catBuyCost = products.reduce((s, p) => s + p.buyCost, 0);
                const catSortCost = products.reduce((s, p) => s + p.sortingCost, 0);
                const isExpanded = expandedCategories.has(catId);
                const productsWithStock = products.filter((p) => p.totalWeight > 0);
                const productsNoStock = products.filter((p) => p.totalWeight === 0);

                return (
                  <div key={catId}>
                    {/* Category header - clickable to expand */}
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-gray-50/50 transition-colors"
                      onClick={() => toggleCategory(catId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant="secondary"
                            className="bg-amber-100 text-amber-800 hover:bg-amber-100 shrink-0"
                          >
                            {categoryName}
                          </Badge>
                          <span className="text-sm font-medium text-gray-700">
                            {productsWithStock.length} รายการ
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm shrink-0">
                          <span className="font-medium text-gray-900">
                            {formatWeight(catWeight)}
                          </span>
                          <span className="font-medium text-gray-900 hidden sm:inline">
                            {formatBaht(catCost)} บาท
                          </span>
                          <span className={`text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            ▼
                          </span>
                        </div>
                      </div>
                      {/* Sub-row: cost breakdown */}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>ซื้อ: {formatBaht(catBuyCost)} บาท</span>
                        <span>·</span>
                        <span>คัดแยก: {formatBaht(catSortCost)} บาท</span>
                      </div>
                    </button>

                    {/* Expanded product list */}
                    {isExpanded && (
                      <div className="bg-gray-50/50 border-t border-gray-100">
                        {productsWithStock.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 bg-gray-100/50">
                                  <th className="text-left py-2 px-4 font-medium text-gray-500 text-xs">ชื่อสินค้า</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">น้ำหนัก</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs hidden sm:table-cell">น้ำหนักจากซื้อ</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs hidden sm:table-cell">น้ำหนักจากคัดแยก</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">ต้นทุนเฉลี่ย/กก.</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs">ต้นทุนรวม</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs hidden sm:table-cell">ต้นทุนจากซื้อ</th>
                                  <th className="text-right py-2 px-3 font-medium text-gray-500 text-xs hidden sm:table-cell">ต้นทุนจากคัดแยก</th>
                                </tr>
                              </thead>
                              <tbody>
                                {productsWithStock.map((p) => (
                                  <tr key={p.productId} className="border-b border-gray-100 last:border-0">
                                    <td className="py-2 px-4 text-gray-900 font-medium text-xs sm:text-sm">
                                      {p.productName}
                                    </td>
                                    <td className="text-right py-2 px-3 text-gray-900 font-medium text-xs sm:text-sm">
                                      {formatWeight(p.totalWeight)}
                                    </td>
                                    <td className="text-right py-2 px-3 text-green-700 text-xs sm:text-sm hidden sm:table-cell">
                                      {p.buyWeight > 0 ? formatWeight(p.buyWeight) : '—'}
                                    </td>
                                    <td className="text-right py-2 px-3 text-purple-700 text-xs sm:text-sm hidden sm:table-cell">
                                      {p.sortingWeight > 0 ? formatWeight(p.sortingWeight) : '—'}
                                    </td>
                                    <td className="text-right py-2 px-3 text-gray-600 text-xs sm:text-sm">
                                      {formatBaht(p.avgCostPerKg)}
                                    </td>
                                    <td className="text-right py-2 px-3 text-gray-900 font-medium text-xs sm:text-sm">
                                      {formatBaht(p.totalCost)}
                                    </td>
                                    <td className="text-right py-2 px-3 text-green-700 text-xs sm:text-sm hidden sm:table-cell">
                                      {p.buyCost > 0 ? formatBaht(p.buyCost) : '—'}
                                    </td>
                                    <td className="text-right py-2 px-3 text-purple-700 text-xs sm:text-sm hidden sm:table-cell">
                                      {p.sortingCost > 0 ? formatBaht(p.sortingCost) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {productsNoStock.length > 0 && (
                          <div className="px-4 py-2 border-t border-gray-100">
                            <p className="text-xs text-gray-400 mb-1">ไม่มีสต๊อก ({productsNoStock.length} รายการ)</p>
                            <div className="flex flex-wrap gap-1">
                              {productsNoStock.map((p) => (
                                <Badge
                                  key={p.productId}
                                  variant="secondary"
                                  className="bg-gray-100 text-gray-400 hover:bg-gray-100 text-[10px]"
                                >
                                  {p.productName}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8 text-sm">
              ยังไม่มีข้อมูลสต๊อก
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Recent Buy Bills */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-green-600" />
              <CardTitle className="text-base font-semibold text-gray-900">
                รับซื้อล่าสุด
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {d && d.recentBuyBills.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {d.recentBuyBills.slice(0, 5).map((bill) => (
                  <div
                    key={bill.id}
                    className="flex items-center justify-between py-3 px-4 hover:bg-gray-50/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {formatDate(bill.date)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {bill.items.length} รายการ
                        {bill.isCredit && (
                          <Badge
                            variant="secondary"
                            className="ml-2 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0"
                          >
                            เครดิต
                          </Badge>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-green-700 whitespace-nowrap ml-2">
                      {formatBaht(bill.totalAmount)} บาท
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8 text-sm">
                ยังไม่มีข้อมูลรับซื้อ
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent Sell Bills */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-sky-600" />
              <CardTitle className="text-base font-semibold text-gray-900">
                ขายล่าสุด
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {d && d.recentSellBills.length > 0 ? (
              <div className="divide-y divide-gray-50">
                {d.recentSellBills.slice(0, 5).map((bill) => (
                  <div
                    key={bill.id}
                    className="flex items-center justify-between py-3 px-4 hover:bg-gray-50/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {bill.customer
                          ? bill.customer.name
                          : formatDate(bill.date)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(bill.date)} · {bill.items.length} รายการ
                        {bill.isCredit && (
                          <Badge
                            variant="secondary"
                            className="ml-2 bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px] px-1.5 py-0"
                          >
                            เครดิต
                          </Badge>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-sky-700 whitespace-nowrap ml-2">
                      {formatBaht(bill.totalAmount)} บาท
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8 text-sm">
                ยังไม่มีข้อมูลขาย
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ---- Summary Card ---- */
const themeMap: Record<string, { bg: string; iconBg: string; iconText: string; valueText: string; descText: string }> = {
  amber: {
    bg: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-600',
    valueText: 'text-amber-800',
    descText: 'text-amber-600',
  },
  green: {
    bg: 'bg-green-50 border-green-200',
    iconBg: 'bg-green-100',
    iconText: 'text-green-600',
    valueText: 'text-green-800',
    descText: 'text-green-600',
  },
  sky: {
    bg: 'bg-sky-50 border-sky-200',
    iconBg: 'bg-sky-100',
    iconText: 'text-sky-600',
    valueText: 'text-sky-800',
    descText: 'text-sky-600',
  },
  purple: {
    bg: 'bg-purple-50 border-purple-200',
    iconBg: 'bg-purple-100',
    iconText: 'text-purple-600',
    valueText: 'text-purple-800',
    descText: 'text-purple-600',
  },
};

function SummaryCard({
  title,
  value,
  desc,
  icon: Icon,
  theme,
}: {
  title: string;
  value: string;
  desc: string;
  icon: React.ElementType;
  theme: string;
}) {
  const t = themeMap[theme] ?? themeMap.amber;
  return (
    <Card className={`border ${t.bg}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${t.iconBg}`}>
            <Icon className={`h-4 w-4 ${t.iconText}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-600 truncate">{title}</p>
            <p className={`text-base sm:text-lg font-bold ${t.valueText} truncate`}>
              {value}
            </p>
            <p className={`text-xs ${t.descText} truncate`}>{desc}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---- Skeleton ---- */
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 sm:p-4 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 sm:p-4 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
