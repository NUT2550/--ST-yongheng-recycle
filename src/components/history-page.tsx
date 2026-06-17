'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchBuyBills,
  fetchSellBills,
  fetchSortingBills,
} from '@/lib/api';
import { BuyBill, SellBill, SortingBill } from '@/lib/types';
import { formatBaht, formatWeight, formatDate } from '@/lib/helpers';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ShoppingCart,
  Coins,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type HistoryTab = 'buy' | 'sell' | 'sort';
const PAGE_SIZE = 10;

export function HistoryPage() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('buy');
  const [page, setPage] = useState(1);

  // Buy
  const [buyBills, setBuyBills] = useState<BuyBill[]>([]);
  const [buyTotal, setBuyTotal] = useState(0);
  // Sell
  const [sellBills, setSellBills] = useState<SellBill[]>([]);
  const [sellTotal, setSellTotal] = useState(0);
  // Sort
  const [sortBills, setSortBills] = useState<SortingBill[]>([]);
  const [sortTotal, setSortTotal] = useState(0);

  const [loading, setLoading] = useState(true);

  // Expanded bill IDs
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadBuyBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBuyBills(page, PAGE_SIZE);
      setBuyBills(res.bills);
      setBuyTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadSellBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSellBills(page, PAGE_SIZE);
      setSellBills(res.bills);
      setSellTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadSortBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSortingBills(page, PAGE_SIZE);
      setSortBills(res.bills);
      setSortTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page]);

  // Load data on tab/page change
  useEffect(() => {
    if (activeTab === 'buy') loadBuyBills();
    else if (activeTab === 'sell') loadSellBills();
    else loadSortBills();
  }, [activeTab, page, loadBuyBills, loadSellBills, loadSortBills]);

  // Reset page on tab change
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as HistoryTab);
    setPage(1);
    setExpandedIds(new Set());
  };

  const totalPages = (() => {
    if (activeTab === 'buy') return Math.ceil(buyTotal / PAGE_SIZE);
    if (activeTab === 'sell') return Math.ceil(sellTotal / PAGE_SIZE);
    return Math.ceil(sortTotal / PAGE_SIZE);
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">ประวัติรายการ</h2>
        <p className="text-gray-500 mt-1">ดูประวัติรับซื้อ ขาย และคัดแยก</p>
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="buy" className="text-xs sm:text-sm gap-1">
            <ShoppingCart className="h-3.5 w-3.5" />
            รับซื้อ
          </TabsTrigger>
          <TabsTrigger value="sell" className="text-xs sm:text-sm gap-1">
            <Coins className="h-3.5 w-3.5" />
            ขาย
          </TabsTrigger>
          <TabsTrigger value="sort" className="text-xs sm:text-sm gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
            คัดแยก
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Transaction List */}
      {loading ? (
        <HistorySkeleton />
      ) : (
        <>
          {activeTab === 'buy' && (
            <BillList
              bills={buyBills}
              total={buyTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="buy"
            />
          )}
          {activeTab === 'sell' && (
            <BillList
              bills={sellBills}
              total={sellTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="sell"
            />
          )}
          {activeTab === 'sort' && (
            <BillList
              bills={sortBills}
              total={sortTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="sort"
            />
          )}
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-600">
            หน้า {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---- Bill List (handles all 3 types) ---- */
function BillList({
  bills,
  total,
  expandedIds,
  toggleExpand,
  type,
}: {
  bills: BuyBill[] | SellBill[] | SortingBill[];
  total: number;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  type: 'buy' | 'sell' | 'sort';
}) {
  if (bills.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-400 text-center py-8 text-sm">
            ยังไม่มีข้อมูล{type === 'buy' ? 'รับซื้อ' : type === 'sell' ? 'ขาย' : 'คัดแยก'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 text-right">
        ทั้งหมด {total} รายการ
      </p>
      <div className="space-y-2">
        {bills.map((bill) => {
          const isExpanded = expandedIds.has(bill.id);
          if (type === 'buy') return <BuyBillCard key={bill.id} bill={bill as BuyBill} isExpanded={isExpanded} toggleExpand={toggleExpand} />;
          if (type === 'sell') return <SellBillCard key={bill.id} bill={bill as SellBill} isExpanded={isExpanded} toggleExpand={toggleExpand} />;
          return <SortBillCard key={bill.id} bill={bill as SortingBill} isExpanded={isExpanded} toggleExpand={toggleExpand} />;
        })}
      </div>
    </div>
  );
}

/* ---- Buy Bill Card ---- */
function BuyBillCard({
  bill,
  isExpanded,
  toggleExpand,
}: {
  bill: BuyBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
}) {
  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <ShoppingCart className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="text-sm font-medium text-gray-900">
                      {formatDate(bill.date)}
                    </span>
                    {bill.isCredit && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0 shrink-0"
                      >
                        เครดิต
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {bill.items.length} รายการ
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-green-700">
                    {formatBaht(bill.totalAmount)} บาท
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 sm:px-4 pb-3 sm:pb-4">
            <Separator className="mb-3" />
            <div className="space-y-1.5">
              {bill.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs sm:text-sm"
                >
                  <span className="text-gray-700 truncate mr-2">
                    {item.product.name}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-500">
                      {formatWeight(item.weight)}
                    </span>
                    <span className="text-gray-500">
                      @{formatBaht(item.pricePerKg)}
                    </span>
                    <span className="font-medium text-gray-900 min-w-[80px] text-right">
                      {formatBaht(item.totalAmount)} บาท
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {bill.note && (
              <p className="text-xs text-gray-400 mt-2">หมายเหตุ: {bill.note}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---- Sell Bill Card ---- */
function SellBillCard({
  bill,
  isExpanded,
  toggleExpand,
}: {
  bill: SellBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
}) {
  const profit = bill.totalAmount - bill.totalCost;

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Coins className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-medium text-gray-900">
                      {bill.customer ? bill.customer.name : formatDate(bill.date)}
                    </span>
                    {bill.isCredit && (
                      <Badge
                        variant="secondary"
                        className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px] px-1.5 py-0 shrink-0"
                      >
                        เครดิต
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatDate(bill.date)} · {bill.items.length} รายการ
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-blue-700">
                    {formatBaht(bill.totalAmount)} บาท
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      profit >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    กำไร {formatBaht(profit)} บาท
                  </p>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ml-auto ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 sm:px-4 pb-3 sm:pb-4">
            <Separator className="mb-3" />
            <div className="space-y-1.5">
              {bill.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs sm:text-sm"
                >
                  <span className="text-gray-700 truncate mr-2">
                    {item.product.name}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-500">
                      {formatWeight(item.weight)}
                    </span>
                    <span className="text-gray-500">
                      @{formatBaht(item.pricePerKg)}
                    </span>
                    <span className="font-medium text-gray-900 min-w-[80px] text-right">
                      {formatBaht(item.totalAmount)} บาท
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>ต้นทุนรวม</span>
              <span>{formatBaht(bill.totalCost)} บาท</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="font-medium text-gray-700">กำไร</span>
              <span className={`font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatBaht(profit)} บาท
              </span>
            </div>
            {bill.note && (
              <p className="text-xs text-gray-400 mt-2">หมายเหตุ: {bill.note}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---- Sorting Bill Card ---- */
function SortBillCard({
  bill,
  isExpanded,
  toggleExpand,
}: {
  bill: SortingBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
}) {
  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <RefreshCw className="h-4 w-4 text-purple-600 shrink-0" />
                    <span className="text-sm font-medium text-gray-900">
                      {formatDate(bill.date)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    จาก: {bill.sourceProduct.name} · {formatWeight(bill.sourceWeight)} →{' '}
                    {bill.items.length} รายการ
                  </p>
                  {bill.lossWeight > 0 && (
                    <p className="text-xs text-red-500 mt-0.5">
                      สูญเสีย: {formatWeight(bill.lossWeight)} ({formatBaht(bill.lossCost)} บาท)
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>
            </CardContent>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 sm:px-4 pb-3 sm:pb-4">
            <Separator className="mb-3" />
            <div className="space-y-1.5">
              {bill.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs sm:text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0 mr-2">
                    <span className="text-gray-700 truncate">
                      {item.product.name}
                    </span>
                    {item.isWaste && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0"
                      >
                        เศษ
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-500">
                      {formatWeight(item.weight)}
                    </span>
                    <span className="text-gray-500">
                      @{formatBaht(item.costPerKg)}
                    </span>
                    <span className="font-medium text-gray-900 min-w-[80px] text-right">
                      {formatBaht(item.totalCost)} บาท
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>น้ำหนักชั่งรวม</span>
              <span>{formatWeight(bill.weighedTotal)}</span>
            </div>
            {bill.lossWeight > 0 && (
              <div className="flex justify-between text-xs text-red-500">
                <span>สูญเสีย</span>
                <span>{formatWeight(bill.lossWeight)} · {formatBaht(bill.lossCost)} บาท</span>
              </div>
            )}
            {bill.note && (
              <p className="text-xs text-gray-400 mt-2">หมายเหตุ: {bill.note}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---- Skeleton ---- */
function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
