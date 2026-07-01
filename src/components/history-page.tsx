'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchBuyBills,
  fetchSellBills,
  fetchSortingBills,
  fetchStockTransfers,
} from '@/lib/api';
import { BuyBill, SellBill, SortingBill, StockTransfer } from '@/lib/types';
import { formatBaht, formatWeight, formatDate } from '@/lib/helpers';
import { formulaHint } from '@/lib/safe-math';
import { getAuthToken } from '@/lib/api';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ShoppingCart,
  Coins,
  RefreshCw,
  PackageOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  Loader2,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';

type HistoryTab = 'buy' | 'sell' | 'sort' | 'transfer';
const PAGE_SIZE = 10;

// Format a price, showing "-" when 0 means unknown/missing cost (not a real zero).
// Use this for FIFO/source costs where 0 typically indicates missing data.
// For buy prices where 0 is a real transaction value, use formatBaht directly.
function priceOrDash(value: number): string {
  if (value === 0) return '-';
  return formatBaht(value);
}

export function HistoryPage() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('buy');
  const [page, setPage] = useState(1);
  const [showCancelled, setShowCancelled] = useState(false);

  // Buy
  const [buyBills, setBuyBills] = useState<BuyBill[]>([]);
  const [buyTotal, setBuyTotal] = useState(0);
  // Sell
  const [sellBills, setSellBills] = useState<SellBill[]>([]);
  const [sellTotal, setSellTotal] = useState(0);
  // Sort
  const [sortBills, setSortBills] = useState<SortingBill[]>([]);
  const [sortTotal, setSortTotal] = useState(0);
  // Transfer
  const [transferBills, setTransferBills] = useState<StockTransfer[]>([]);
  const [transferTotal, setTransferTotal] = useState(0);

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
      const res = await fetchBuyBills(page, PAGE_SIZE, showCancelled);
      setBuyBills(res.bills);
      setBuyTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page, showCancelled]);

  const loadSellBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSellBills(page, PAGE_SIZE, showCancelled);
      setSellBills(res.bills);
      setSellTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page, showCancelled]);

  const loadSortBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSortingBills(page, PAGE_SIZE, showCancelled);
      setSortBills(res.bills);
      setSortTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page, showCancelled]);

  const loadTransferBills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStockTransfers(page, PAGE_SIZE, showCancelled);
      setTransferBills(res.bills);
      setTransferTotal(res.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [page, showCancelled]);

  // Load data on tab/page/showCancelled change
  useEffect(() => {
    if (activeTab === 'buy') loadBuyBills();
    else if (activeTab === 'sell') loadSellBills();
    else if (activeTab === 'sort') loadSortBills();
    else loadTransferBills();
  }, [activeTab, page, showCancelled, loadBuyBills, loadSellBills, loadSortBills, loadTransferBills]);

  // Reset page on tab change
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as HistoryTab);
    setPage(1);
    setExpandedIds(new Set());
  };

  const handleToggleCancelled = (checked: boolean) => {
    setShowCancelled(checked);
    setPage(1);
    setExpandedIds(new Set());
  };

  const totalPages = (() => {
    if (activeTab === 'buy') return Math.ceil(buyTotal / PAGE_SIZE);
    if (activeTab === 'sell') return Math.ceil(sellTotal / PAGE_SIZE);
    if (activeTab === 'sort') return Math.ceil(sortTotal / PAGE_SIZE);
    return Math.ceil(transferTotal / PAGE_SIZE);
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">ประวัติรายการ</h2>
          <p className="text-gray-500 mt-1">ดูประวัติรับซื้อ ขาย และคัดแยก</p>
        </div>
        {/* Toggle: show cancelled bills */}
        <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 transition-colors self-start">
          <Switch
            checked={showCancelled}
            onCheckedChange={handleToggleCancelled}
            aria-label="แสดงบิลที่ยกเลิกแล้ว"
          />
          <span className="text-sm text-gray-700 flex items-center gap-1">
            <Ban className="h-3.5 w-3.5 text-red-500" />
            แสดงบิลที่ยกเลิกแล้ว
          </span>
        </label>
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full grid grid-cols-4">
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
          <TabsTrigger value="transfer" className="text-xs sm:text-sm gap-1">
            <PackageOpen className="h-3.5 w-3.5" />
            แกะของ
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
              onRefresh={loadBuyBills}
            />
          )}
          {activeTab === 'sell' && (
            <BillList
              bills={sellBills}
              total={sellTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="sell"
              onRefresh={loadSellBills}
            />
          )}
          {activeTab === 'sort' && (
            <BillList
              bills={sortBills}
              total={sortTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="sort"
              onRefresh={loadSortBills}
            />
          )}
          {activeTab === 'transfer' && (
            <BillList
              bills={transferBills}
              total={transferTotal}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              type="transfer"
              onRefresh={loadTransferBills}
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

/* ---- Bill List (handles all 4 types) ---- */
function BillList({
  bills,
  total,
  expandedIds,
  toggleExpand,
  type,
  onRefresh,
}: {
  bills: BuyBill[] | SellBill[] | SortingBill[] | StockTransfer[];
  total: number;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  type: 'buy' | 'sell' | 'sort' | 'transfer';
  onRefresh: () => void;
}) {
  if (bills.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-gray-400 text-center py-8 text-sm">
            ยังไม่มีข้อมูล{type === 'buy' ? 'รับซื้อ' : type === 'sell' ? 'ขาย' : type === 'sort' ? 'คัดแยก' : 'แกะของ'}
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
          if (type === 'buy') return <BuyBillCard key={bill.id} bill={bill as BuyBill} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} />;
          if (type === 'sell') return <SellBillCard key={bill.id} bill={bill as SellBill} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} />;
          if (type === 'sort') return <SortBillCard key={bill.id} bill={bill as SortingBill} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} />;
          return <TransferBillCard key={bill.id} bill={bill as StockTransfer} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} />;
        })}
      </div>
    </div>
  );
}

/* ---- Cancelled badge for collapsed header ---- */
function CancelledBadge() {
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0">
      <Ban className="h-2.5 w-2.5 mr-0.5" />
      ยกเลิกแล้ว
    </Badge>
  );
}

/* ---- Cancelled notice block (shown in expanded view) ---- */
function CancelledNotice({ reason, cancelledAt }: { reason: string | null; cancelledAt: string | null }) {
  return (
    <div className="mt-2 p-2.5 rounded-md bg-red-50 border border-red-200">
      <div className="flex items-center gap-1.5 text-red-700 font-medium text-xs">
        <Ban className="h-3.5 w-3.5" />
        ยกเลิกแล้ว
        {cancelledAt && (
          <span className="text-red-500 font-normal">
            · {formatDate(cancelledAt)}
          </span>
        )}
      </div>
      {reason && (
        <p className="text-red-600 mt-1 text-xs">เหตุผล: {reason}</p>
      )}
    </div>
  );
}

/* ---- Buy Bill Card ---- */
function BuyBillCard({
  bill,
  isExpanded,
  toggleExpand,
  onRefresh,
}: {
  bill: BuyBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
  onRefresh: () => void;
}) {
  const cancelled = bill.isCancelled === true;
  return (
    <Card className={cancelled ? 'border-red-200 bg-red-50/30' : ''}>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <ShoppingCart className="h-4 w-4 text-green-600 shrink-0" />
                    <span className={`text-sm font-medium ${cancelled ? 'text-gray-500' : 'text-gray-900'}`}>
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
                    {cancelled && <CancelledBadge />}
                  </div>
                  <p className="text-xs text-gray-500">
                    {bill.items.length} รายการ
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold ${cancelled ? 'text-gray-400 line-through' : 'text-green-700'}`}>
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
            {/* Header row (desktop) */}
            <div className="hidden sm:grid grid-cols-[1fr_60px_90px_100px] gap-x-2 pb-1.5 mb-1 border-b text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              <div>สินค้า</div>
              <div className="text-right">น้ำหนัก</div>
              <div className="text-right">ราคาซื้อ/กก.</div>
              <div className="text-right">จำนวนเงิน</div>
            </div>
            <div className="space-y-0.5">
              {bill.items.map((item) => (
                <div key={item.id}>
                  {/* Desktop grid row */}
                  <div className="hidden sm:grid grid-cols-[1fr_60px_90px_100px] gap-x-2 text-xs sm:text-sm items-start py-0.5">
                    <span className="text-gray-700 truncate">
                      {item.product.name}
                      {item.weightExpression && (
                        <span className="block text-[10px] text-gray-400">
                          {formulaHint(item.weightExpression)}
                        </span>
                      )}
                    </span>
                    <span className="text-gray-600 text-right">{formatWeight(item.weight)}</span>
                    <span className="text-gray-600 text-right">{formatBaht(item.pricePerKg)}</span>
                    <span className="font-medium text-gray-900 text-right">{formatBaht(item.totalAmount)} บาท</span>
                  </div>
                  {/* Mobile stacked layout */}
                  <div className="sm:hidden py-1 border-b border-gray-100 last:border-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-gray-800 text-sm font-medium truncate">{item.product.name}</span>
                      <span className="font-medium text-gray-900 text-sm shrink-0">{formatBaht(item.totalAmount)} บาท</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                      <span>
                        {formatWeight(item.weight)}
                        {item.weightExpression && (
                          <span className="text-[10px] text-gray-400 ml-1">({formulaHint(item.weightExpression)})</span>
                        )}
                      </span>
                      <span>ราคาซื้อ {formatBaht(item.pricePerKg)}/กก.</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Bill-level summary */}
            <div className="flex justify-between text-xs text-gray-500 mt-2 pt-1.5 border-t border-gray-100">
              <span>น้ำหนักรวม · ยอดซื้อรวม</span>
              <span>{formatWeight(bill.items.reduce((s, i) => s + i.weight, 0))} · {formatBaht(bill.totalAmount)} บาท</span>
            </div>
            {bill.note && (
              <p className="text-xs text-gray-400 mt-2">หมายเหตุ: {bill.note}</p>
            )}
            {cancelled && (
              <CancelledNotice reason={bill.cancelReason} cancelledAt={bill.cancelledAt} />
            )}
            <BillActions billId={bill.id} billType="buy" onRefresh={onRefresh} isCancelled={cancelled} />
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
  onRefresh,
}: {
  bill: SellBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
  onRefresh: () => void;
}) {
  const profit = bill.totalAmount - bill.totalCost;
  const cancelled = bill.isCancelled === true;

  return (
    <Card className={cancelled ? 'border-red-200 bg-red-50/30' : ''}>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Coins className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className={`text-sm font-medium ${cancelled ? 'text-gray-500' : 'text-gray-900'}`}>
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
                    {cancelled && <CancelledBadge />}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatDate(bill.date)} · {bill.items.length} รายการ
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${cancelled ? 'text-gray-400 line-through' : 'text-blue-700'}`}>
                    {formatBaht(bill.totalAmount)} บาท
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      cancelled ? 'text-gray-400 line-through' : profit >= 0 ? 'text-green-600' : 'text-red-600'
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
            {/* Header row (desktop) */}
            <div className="hidden sm:grid grid-cols-[1fr_54px_80px_80px_92px] gap-x-2 pb-1.5 mb-1 border-b text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              <div>สินค้า</div>
              <div className="text-right">น้ำหนัก</div>
              <div className="text-right">ราคาขาย/กก.</div>
              <div className="text-right">ต้นทุน/กก.</div>
              <div className="text-right">จำนวนเงิน</div>
            </div>
            <div className="space-y-0.5">
              {bill.items.map((item) => {
                const itemProfit = item.totalAmount - item.totalCost;
                return (
                  <div key={item.id}>
                    {/* Desktop grid row */}
                    <div className="hidden sm:grid grid-cols-[1fr_54px_80px_80px_92px] gap-x-2 text-xs sm:text-sm items-start py-0.5">
                      <span className="text-gray-700 truncate">
                        {item.product.name}
                        {item.weightExpression && (
                          <span className="block text-[10px] text-gray-400">
                            {formulaHint(item.weightExpression)}
                          </span>
                        )}
                      </span>
                      <span className="text-gray-600 text-right">{formatWeight(item.weight)}</span>
                      <span className="text-gray-600 text-right">{formatBaht(item.pricePerKg)}</span>
                      <span className="text-gray-500 text-right">{priceOrDash(item.costPerKg)}</span>
                      <span className="font-medium text-gray-900 text-right">{formatBaht(item.totalAmount)} บาท</span>
                    </div>
                    {/* Mobile stacked layout */}
                    <div className="sm:hidden py-1 border-b border-gray-100 last:border-0">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-800 text-sm font-medium truncate">{item.product.name}</span>
                        <span className="font-medium text-gray-900 text-sm shrink-0">{formatBaht(item.totalAmount)} บาท</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                        <span>
                          {formatWeight(item.weight)}
                          {item.weightExpression && (
                            <span className="text-[10px] text-gray-400 ml-1">({formulaHint(item.weightExpression)})</span>
                          )}
                        </span>
                        <span>ขาย {formatBaht(item.pricePerKg)}/กก.</span>
                      </div>
                      <div className="flex justify-between text-[11px] mt-0.5">
                        <span className="text-gray-400">ต้นทุน/กก.</span>
                        <span className={itemProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {priceOrDash(item.costPerKg)}{item.costPerKg > 0 ? ` · กำไร ${formatBaht(itemProfit)}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Separator className="my-2" />
            {/* Bill-level summary */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>ยอดขายรวม</span>
              <span>{formatBaht(bill.totalAmount)} บาท</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>ต้นทุนรวม (ราคาต้นทาง)</span>
              <span>{formatBaht(bill.totalCost)} บาท</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="font-medium text-gray-700">กำไร/ขาดทุน</span>
              <span className={`font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatBaht(profit)} บาท
              </span>
            </div>
            {bill.note && (
              <p className="text-xs text-gray-400 mt-2">หมายเหตุ: {bill.note}</p>
            )}
            {cancelled && (
              <CancelledNotice reason={bill.cancelReason} cancelledAt={bill.cancelledAt} />
            )}
            <BillActions billId={bill.id} billType="sell" onRefresh={onRefresh} isCancelled={cancelled} />
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
  onRefresh,
}: {
  bill: SortingBill;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
  onRefresh: () => void;
}) {
  const cancelled = bill.isCancelled === true;
  // Room number: prefer dedicated field; fall back to legacy "ห้อง XX" in note
  const legacyRoom = bill.roomNumber ? null : (bill.note?.match(/ห้อง\s*(\d+)/)?.[1] ?? null);
  const roomDisplay = bill.roomNumber || legacyRoom;
  return (
    <Card className={cancelled ? 'border-red-200 bg-red-50/30' : ''}>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <RefreshCw className="h-4 w-4 text-purple-600 shrink-0" />
                    <span className={`text-sm font-medium ${cancelled ? 'text-gray-500' : 'text-gray-900'}`}>
                      {formatDate(bill.date)}
                    </span>
                    {roomDisplay && (
                      <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-100 text-[10px] px-1.5 py-0 shrink-0">
                        เลขห้อง {roomDisplay}
                      </Badge>
                    )}
                    {cancelled && <CancelledBadge />}
                  </div>
                  <p className="text-xs text-gray-500">
                    จาก: {bill.sourceProduct.name} · {formatWeight(bill.sourceWeight)}
                    {bill.sourceWeightExpression && (
                      <span className="text-[10px] text-gray-400 ml-1">
                        ({formulaHint(bill.sourceWeightExpression)})
                      </span>
                    )}{' '}
                    → {bill.items.length} รายการ
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
            {/* Header row (desktop) */}
            <div className="hidden sm:grid grid-cols-[1fr_54px_76px_76px_92px] gap-x-2 pb-1.5 mb-1 border-b text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              <div>สินค้า</div>
              <div className="text-right">น้ำหนัก</div>
              <div className="text-right">ราคา/กก.</div>
              <div className="text-right">ต้นทุน/กก.</div>
              <div className="text-right">มูลค่า</div>
            </div>
            <div className="space-y-0.5">
              {bill.items.map((item) => {
                const priceDash = item.isWaste || item.sortedPricePerKg === 0;
                return (
                  <div key={item.id}>
                    {/* Desktop grid row */}
                    <div className="hidden sm:grid grid-cols-[1fr_54px_76px_76px_92px] gap-x-2 text-xs sm:text-sm items-start py-0.5">
                      <span className="text-gray-700 truncate flex items-center gap-1.5">
                        {item.product.name}
                        {item.isWaste && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0">
                            เศษ
                          </Badge>
                        )}
                        {item.weightExpression && (
                          <span className="text-[10px] text-gray-400">{formulaHint(item.weightExpression)}</span>
                        )}
                      </span>
                      <span className="text-gray-600 text-right">{formatWeight(item.weight)}</span>
                      <span className="text-gray-600 text-right">{priceDash ? '-' : formatBaht(item.sortedPricePerKg)}</span>
                      <span className="text-gray-500 text-right">{item.costPerKg > 0 ? formatBaht(item.costPerKg) : '-'}</span>
                      <span className="font-medium text-gray-900 text-right">{item.totalCost > 0 ? `${formatBaht(item.totalCost)} บาท` : '-'}</span>
                    </div>
                    {/* Mobile stacked layout */}
                    <div className="sm:hidden py-1 border-b border-gray-100 last:border-0">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-800 text-sm font-medium truncate flex items-center gap-1.5">
                          {item.product.name}
                          {item.isWaste && (
                            <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0">
                              เศษ
                            </Badge>
                          )}
                        </span>
                        <span className="font-medium text-gray-900 text-sm shrink-0">{item.totalCost > 0 ? `${formatBaht(item.totalCost)} บาท` : '-'}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                        <span>
                          {formatWeight(item.weight)}
                          {item.weightExpression && (
                            <span className="text-[10px] text-gray-400 ml-1">({formulaHint(item.weightExpression)})</span>
                          )}
                        </span>
                        <span>ราคา {priceDash ? '-' : formatBaht(item.sortedPricePerKg)}/กก.</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-400 mt-0.5">
                        <span>ต้นทุน/กก.</span>
                        <span>{item.costPerKg > 0 ? formatBaht(item.costPerKg) : '-'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Separator className="my-2" />
            {/* Bill-level summary */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>ราคารับซื้อต้นทาง/กก.</span>
              <span>{bill.sourcePricePerKg > 0 ? formatBaht(bill.sourcePricePerKg) : '-'}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>น้ำหนักชั่งรวม</span>
              <span>
                {formatWeight(bill.weighedTotal)}
                {bill.weighedTotalExpression && (
                  <span className="text-[10px] text-gray-400 ml-1">
                    ({formulaHint(bill.weighedTotalExpression)})
                  </span>
                )}
              </span>
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
            {cancelled && (
              <CancelledNotice reason={bill.cancelReason} cancelledAt={bill.cancelledAt} />
            )}
            <BillActions billId={bill.id} billType="sort" onRefresh={onRefresh} isCancelled={cancelled} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---- Transfer (แกะของ/ย้ายสต็อก) Bill Card ---- */
function TransferBillCard({
  bill,
  isExpanded,
  toggleExpand,
  onRefresh,
}: {
  bill: StockTransfer;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
  onRefresh: () => void;
}) {
  const cancelled = bill.isCancelled === true;
  return (
    <Card className={cancelled ? 'border-red-200 bg-red-50/30' : ''}>
      <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(bill.id)}>
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <PackageOpen className="h-4 w-4 text-cyan-600 shrink-0" />
                    <span className={`text-sm font-medium ${cancelled ? 'text-gray-500' : 'text-gray-900'}`}>
                      {formatDate(bill.date)}
                    </span>
                    {cancelled && <CancelledBadge />}
                  </div>
                  <p className="text-xs text-gray-500">
                    จาก: {bill.sourceProduct.name} · {formatWeight(bill.sourceWeight)}
                    {bill.sourceWeightExpression && (
                      <span className="text-[10px] text-gray-400 ml-1">
                        ({formulaHint(bill.sourceWeightExpression)})
                      </span>
                    )}{' '}
                    → {bill.items.length} รายการ
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
            {/* Header row (desktop) */}
            <div className="hidden sm:grid grid-cols-[1fr_54px_76px_76px_92px] gap-x-2 pb-1.5 mb-1 border-b text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              <div>สินค้า</div>
              <div className="text-right">น้ำหนัก</div>
              <div className="text-right">ต้นทุน/กก.</div>
              <div className="text-right">มูลค่า</div>
              <div className="text-right">&nbsp;</div>
            </div>
            <div className="space-y-0.5">
              {bill.items.map((item) => {
                const priceDash = item.isWaste || item.costPerKg === 0;
                return (
                  <div key={item.id}>
                    {/* Desktop grid row */}
                    <div className="hidden sm:grid grid-cols-[1fr_54px_76px_76px_92px] gap-x-2 text-xs sm:text-sm items-start py-0.5">
                      <span className="text-gray-700 truncate flex items-center gap-1.5">
                        {item.product.name}
                        {item.isWaste && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0">
                            เศษ
                          </Badge>
                        )}
                        {item.weightExpression && (
                          <span className="text-[10px] text-gray-400">{formulaHint(item.weightExpression)}</span>
                        )}
                      </span>
                      <span className="text-gray-600 text-right">{formatWeight(item.weight)}</span>
                      <span className="text-gray-500 text-right">{item.costPerKg > 0 ? formatBaht(item.costPerKg) : '-'}</span>
                      <span className="text-gray-500 text-right">{item.totalCost > 0 ? formatBaht(item.totalCost) : '-'}</span>
                      <span className="text-right text-gray-400 text-[10px]">บาท</span>
                    </div>
                    {/* Mobile stacked layout */}
                    <div className="sm:hidden py-1 border-b border-gray-100 last:border-0">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-800 text-sm font-medium truncate flex items-center gap-1.5">
                          {item.product.name}
                          {item.isWaste && (
                            <Badge variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] px-1.5 py-0 shrink-0">
                              เศษ
                            </Badge>
                          )}
                        </span>
                        <span className="font-medium text-gray-900 text-sm shrink-0">{item.totalCost > 0 ? `${formatBaht(item.totalCost)} บาท` : '-'}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                        <span>
                          {formatWeight(item.weight)}
                          {item.weightExpression && (
                            <span className="text-[10px] text-gray-400 ml-1">({formulaHint(item.weightExpression)})</span>
                          )}
                        </span>
                        <span>ต้นทุน {item.costPerKg > 0 ? formatBaht(item.costPerKg) : '-'}/กก.</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <Separator className="my-2" />
            {/* Bill-level summary */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>ต้นทุนรับซื้อต้นทาง/กก.</span>
              <span>{bill.sourceCostPerKg > 0 ? formatBaht(bill.sourceCostPerKg) : '-'}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>ต้นทุนต้นทางรวม</span>
              <span>{bill.sourceTotalCost > 0 ? `${formatBaht(bill.sourceTotalCost)} บาท` : '-'}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>น้ำหนักชั่งรวม</span>
              <span>
                {formatWeight(bill.weighedTotal)}
                {bill.weighedTotalExpression && (
                  <span className="text-[10px] text-gray-400 ml-1">
                    ({formulaHint(bill.weighedTotalExpression)})
                  </span>
                )}
              </span>
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
            {cancelled && (
              <CancelledNotice reason={bill.cancelReason} cancelledAt={bill.cancelledAt} />
            )}
            <BillActions billId={bill.id} billType="transfer" onRefresh={onRefresh} isCancelled={cancelled} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---- Bill Actions Component (Cancel + Edit) ---- */
function BillActions({ billId, billType, onRefresh, isCancelled }: { billId: string; billType: 'buy' | 'sell' | 'sort' | 'transfer'; onRefresh: () => void; isCancelled: boolean }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const apiPath = billType === 'buy' ? 'buy-bills' : billType === 'sell' ? 'sell-bills' : billType === 'sort' ? 'sorting-bills' : 'stock-transfers';

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error('กรุณาระบุเหตุผลในการยกเลิก');
      return;
    }
    setCancelLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/${apiPath}/${billId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ยกเลิกไม่สำเร็จ');
        return;
      }
      toast.success('ยกเลิกบิลสำเร็จ — สต็อกถูกปรับย้อนกลับแล้ว');
      setCancelOpen(false);
      setCancelReason('');
      onRefresh();
    } catch (err) {
      toast.error('ยกเลิกไม่สำเร็จ: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleEdit = async () => {
    setEditLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/${apiPath}/${billId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ note: editNote.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'แก้ไขไม่สำเร็จ');
        return;
      }
      toast.success('แก้ไขหมายเหตุสำเร็จ');
      setEditOpen(false);
      onRefresh();
    } catch (err) {
      toast.error('แก้ไขไม่สำเร็จ: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <div className="flex gap-2 mt-3 pt-3 border-t">
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => setEditOpen(true)}
        disabled={isCancelled}
      >
        <Pencil className="h-3 w-3 mr-1" />
        แก้ไข
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
        onClick={() => setCancelOpen(true)}
        disabled={isCancelled}
      >
        <Trash2 className="h-3 w-3 mr-1" />
        ยกเลิกบิล
      </Button>

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              ยืนยันยกเลิกบิลนี้?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              ระบบจะปรับสต็อกย้อนกลับและเก็บประวัติไว้
            </p>
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">เหตุผลในการยกเลิก</Label>
              <Textarea
                id="cancel-reason"
                placeholder="ระบุเหตุผล เช่น กรอกผิด / บิลซ้ำ / ลูกค้ายกเลิก"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">ยกเลิก</Button>
            </DialogClose>
            <Button
              onClick={handleCancel}
              disabled={cancelLoading || !cancelReason.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelLoading ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังยกเลิก...</>
              ) : (
                'ยืนยันยกเลิกบิล'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-amber-600" />
              แก้ไขบิล
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-note">หมายเหตุ</Label>
              <Textarea
                id="edit-note"
                placeholder="แก้ไขหมายเหตุ..."
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={3}
              />
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              <p className="font-medium mb-1">⚠️ การแก้ไขที่กระทบสต็อก</p>
              <p>การแก้น้ำหนัก/สินค้าโดยตรงยังไม่เปิดใช้ เพราะต้องกระทบสต็อก ให้ยกเลิกบิลแล้วสร้างใหม่แทน</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">ยกเลิก</Button>
            </DialogClose>
            <Button
              onClick={handleEdit}
              disabled={editLoading}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {editLoading ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังบันทึก...</>
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
