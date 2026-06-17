'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchCreditEntries, payCreditEntry } from '@/lib/api';
import { CreditEntry } from '@/lib/types';
import { formatBaht, formatDate, getCurrentDateForInput } from '@/lib/helpers';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Banknote } from 'lucide-react';
import { toast } from 'sonner';

type FilterTab = 'all' | 'receivable' | 'payable' | 'settled';

// Helper to get remaining amount (shared between components)
function getRemaining(entry: CreditEntry) {
  return entry.amount - entry.paidAmount;
}

export function CreditPage() {
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // Payment dialog
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingEntry, setPayingEntry] = useState<CreditEntry | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const params: { type?: string; isSettled?: boolean } = {};
      if (activeTab === 'receivable') params.type = 'RECEIVABLE';
      else if (activeTab === 'payable') params.type = 'PAYABLE';
      else if (activeTab === 'settled') params.isSettled = true;

      const data = await fetchCreditEntries(params);
      // API returns { entries: [...] }
      const entryList = (data as unknown as { entries: CreditEntry[] }).entries || (data as unknown as CreditEntry[]);
      setEntries(entryList);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    loadEntries();
  }, [loadEntries]);

  // Computed summaries
  const totalReceivable = entries
    .filter((e) => e.type === 'RECEIVABLE' && !e.isSettled)
    .reduce((s, e) => s + (e.amount - e.paidAmount), 0);
  const totalPayable = entries
    .filter((e) => e.type === 'PAYABLE' && !e.isSettled)
    .reduce((s, e) => s + (e.amount - e.paidAmount), 0);

  // Open payment dialog
  const openPayDialog = (entry: CreditEntry) => {
    setPayingEntry(entry);
    setPayAmount(String(getRemaining(entry)));
    setPayDate(getCurrentDateForInput());
    setPayNote('');
    setPayDialogOpen(true);
  };

  // Submit payment
  const handlePay = async () => {
    if (!payingEntry) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      toast.error('กรุณาใส่จำนวนเงินให้ถูกต้อง');
      return;
    }
    if (amount > getRemaining(payingEntry)) {
      toast.error('จำนวนเงินเกินยอดคงเหลือ');
      return;
    }
    if (!payDate) {
      toast.error('กรุณาเลือกวันที่');
      return;
    }

    setPaying(true);
    try {
      await payCreditEntry(payingEntry.id, {
        amount,
        date: new Date(payDate).toISOString(),
        note: payNote || undefined,
      });
      toast.success('บันทึกชำระเงินสำเร็จ');
      setPayDialogOpen(false);
      setLoading(true);
      loadEntries();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการชำระเงิน'
      );
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">เครดิต</h2>
        <p className="text-gray-500 mt-1">
          จัดการรายการเครดิตค้างรับและค้างจ่าย
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownLeft className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-700">
                ค้างรับ (RECEIVABLE)
              </span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-amber-900">
              {formatBaht(totalReceivable)} บาท
            </p>
          </CardContent>
        </Card>
        <Card className="bg-rose-50 border-rose-200">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="h-4 w-4 text-rose-600" />
              <span className="text-xs font-medium text-rose-700">
                ค้างจ่าย (PAYABLE)
              </span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-rose-900">
              {formatBaht(totalPayable)} บาท
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as FilterTab)}
      >
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="all" className="text-xs sm:text-sm">
            ทั้งหมด
          </TabsTrigger>
          <TabsTrigger value="receivable" className="text-xs sm:text-sm">
            ค้างรับ
          </TabsTrigger>
          <TabsTrigger value="payable" className="text-xs sm:text-sm">
            ค้างจ่าย
          </TabsTrigger>
          <TabsTrigger value="settled" className="text-xs sm:text-sm">
            ชำระแล้ว
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Credit Entries List */}
      {loading ? (
        <CreditSkeleton />
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-400 text-center py-8 text-sm">
              ยังไม่มีข้อมูลเครดิต
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[calc(100vh-380px)]">
          <div className="space-y-3 pr-1">
            {entries.map((entry) => (
              <CreditEntryCard
                key={entry.id}
                entry={entry}
                onPay={() => openPayDialog(entry)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Payment Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ชำระเงิน</DialogTitle>
            <DialogDescription>
              บันทึกการชำระเงินสำหรับรายการเครดิต
            </DialogDescription>
          </DialogHeader>
          {payingEntry && (
            <div className="space-y-4">
              {/* Entry details */}
              <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      payingEntry.type === 'RECEIVABLE'
                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                        : 'bg-rose-100 text-rose-800 hover:bg-rose-100'
                    }
                  >
                    {payingEntry.type === 'RECEIVABLE' ? 'ค้างรับ' : 'ค้างจ่าย'}
                  </Badge>
                  {payingEntry.customer && (
                    <span className="text-sm text-gray-700">
                      {payingEntry.customer.name}
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">ยอดเต็ม</span>
                  <span className="font-medium">
                    {formatBaht(payingEntry.amount)} บาท
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">ชำระแล้ว</span>
                  <span className="font-medium">
                    {formatBaht(payingEntry.paidAmount)} บาท
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700 font-medium">คงเหลือ</span>
                  <span className="font-bold text-amber-800">
                    {formatBaht(getRemaining(payingEntry))} บาท
                  </span>
                </div>
              </div>

              {/* Payment form */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-amount">จำนวนเงิน (บาท)</Label>
                  <Input
                    id="pay-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    max={getRemaining(payingEntry)}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-date">วันที่ชำระ</Label>
                  <Input
                    id="pay-date"
                    type="datetime-local"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-note">หมายเหตุ (ไม่จำเป็น)</Label>
                  <Input
                    id="pay-note"
                    placeholder="หมายเหตุ..."
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPayDialogOpen(false)}
              disabled={paying}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handlePay}
              disabled={paying}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {paying ? 'กำลังบันทึก...' : 'บันทึกชำระเงิน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---- Credit Entry Card ---- */
function CreditEntryCard({
  entry,
  onPay,
}: {
  entry: CreditEntry;
  onPay: () => void;
}) {
  const isReceivable = entry.type === 'RECEIVABLE';
  const isSettled = entry.isSettled;

  return (
    <Card className={isSettled ? 'opacity-70' : ''}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Type badge + Customer */}
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="secondary"
                className={
                  isReceivable
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-100 shrink-0'
                    : 'bg-rose-100 text-rose-800 hover:bg-rose-100 shrink-0'
                }
              >
                {isReceivable ? 'ค้างรับ' : 'ค้างจ่าย'}
              </Badge>
              {entry.customer && (
                <span className="text-sm font-medium text-gray-900 truncate">
                  {entry.customer.name}
                </span>
              )}
              {isSettled && (
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-700 hover:bg-green-100 shrink-0"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  ชำระแล้ว
                </Badge>
              )}
            </div>

            {/* Amount info */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ยอดเต็ม</span>
                <span className="font-medium text-gray-900">
                  {formatBaht(entry.amount)} บาท
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ชำระแล้ว</span>
                <span className="font-medium text-green-700">
                  {formatBaht(entry.paidAmount)} บาท
                </span>
              </div>
              {!isSettled && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700 font-medium">คงเหลือ</span>
                  <span
                    className={`font-bold ${
                      isReceivable ? 'text-amber-800' : 'text-rose-800'
                    }`}
                  >
                    {formatBaht(getRemaining(entry))} บาท
                  </span>
                </div>
              )}
            </div>

            {/* Date + description */}
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span>{formatDate(entry.date)}</span>
              {entry.description && (
                <>
                  <span>·</span>
                  <span className="truncate">{entry.description}</span>
                </>
              )}
            </div>
          </div>

          {/* Pay button */}
          {!isSettled && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={onPay}
            >
              <Banknote className="h-3.5 w-3.5 mr-1" />
              ชำระเงิน
            </Button>
          )}
        </div>

        {/* Payment history */}
        {entry.payments.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-1">
              ประวัติชำระ ({entry.payments.length} ครั้ง)
            </p>
            <div className="space-y-1">
              {entry.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex justify-between text-xs text-gray-500"
                >
                  <span>{formatDate(payment.date)}</span>
                  <span className="font-medium text-green-700">
                    {formatBaht(payment.amount)} บาท
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---- Skeleton ---- */
function CreditSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-5 w-24" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
