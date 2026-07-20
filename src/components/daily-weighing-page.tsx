'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Scale, Loader2, Save, History, RefreshCw } from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { toast } from 'sonner';
import { formatWeight } from '@/lib/helpers';
import { getThailandTodayDateString } from '@/lib/thailand-date';

const TOLERANCE = 0.10;

// ST-38: client mirror of the server's AggregatedProduct shape.
interface AggregateItem {
  productId: string;
  productName: string;
  purchaseInWeight: number;
  saleOutWeight: number;
  sortingSourceOutWeight: number;
  sortingOutputInWeight: number;
  transferSourceOutWeight: number;
  transferOutputInWeight: number;
  adjustmentNetWeight: number;
  dailyNet: number;
  movementCount: number;
}

// ST-38: client-side row state — only actualWeighedWeight + note are user-editable.
// All source-breakdown fields are READ-ONLY (server-computed at save time).
interface WeighingItem {
  productId: string;
  productName: string;
  purchaseInWeight: number;
  saleOutWeight: number;
  sortingSourceOutWeight: number;
  sortingOutputInWeight: number;
  transferSourceOutWeight: number;
  transferOutputInWeight: number;
  adjustmentNetWeight: number;
  dailyNet: number;
  movementCount: number;
  actualWeighedWeight: string;
  note: string;
}

// ST-38: session detail (read-only) — mirrors the new schema fields.
interface SessionItem {
  id: string;
  productId: string;
  purchaseWeight: number;
  purchaseBillCount: number;
  sortingOutputWeight: number;
  sortingBillCount: number;
  dismantlingOutputWeight: number;
  dismantlingRecordCount: number;
  expectedTotalWeight: number;
  actualWeighedWeight: number | null;
  differenceWeight: number | null;
  status: string;
  note: string | null;
  product: { name: string };
}

interface Session {
  id: string;
  weighingDate: string;
  category: string;
  status: string;
  note: string | null;
  createdAt: string;
  items: SessionItem[];
}

export default function DailyWeighingPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(getThailandTodayDateString);
  const [category, setCategory] = useState('ทองแดง');
  const [aggregateItems, setAggregateItems] = useState<AggregateItem[]>([]);
  const [weighingItems, setWeighingItems] = useState<WeighingItem[]>([]);
  const [note, setNote] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [detailSession, setDetailSession] = useState<Session | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [baselineMissing, setBaselineMissing] = useState(false);
  const [baselineDate, setBaselineDate] = useState<string | null>(null);

  // Convert CE date to Buddhist display
  function toBuddhistDate(isoDate: string): string {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear() + 543;
    return `${day}/${month}/${year}`;
  }

  async function loadAggregate() {
    setLoading(true);
    setAggregateItems([]);
    setWeighingItems([]);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/daily-weighing?action=daily-movements&date=${date}&category=${encodeURIComponent(category)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
        return;
      }
      setBaselineMissing(false); // ST-53: daily movements don't require a baseline
      setBaselineDate(null);
      const items: AggregateItem[] = data.items || [];
      setAggregateItems(items);
      setWeighingItems(
        items.map((item) => ({
          ...item,
          actualWeighedWeight: '',
          note: '',
        }))
      );
      if (items.length === 0) {
        toast.info(`ไม่มียอด${category}ของวันที่ ${toBuddhistDate(date)}`);
      }
    } catch {
      toast.error('โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/daily-weighing?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSessions(data.sessions || []);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadHistory);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const token = getAuthToken();
      // ST-35/ST-38 trust boundary: client sends ONLY productId, actualWeighedWeight, note.
      // Server recomputes ALL source totals (purchaseWeight, sortingOutputWeight,
      // dismantlingOutputWeight, expectedTotalWeight, difference, status).
      const items = weighingItems.map(item => ({
        productId: item.productId,
        actualWeighedWeight: item.actualWeighedWeight === '' ? null : parseFloat(item.actualWeighedWeight),
        note: item.note || undefined,
      }));

      const res = await fetch('/api/daily-weighing', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          weighingDate: date,
          category,
          note: note || undefined,
          items,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`บันทึกผลชั่งสำเร็จ (${items.length} รายการ)`);
        setAggregateItems([]);
        setWeighingItems([]);
        setNote('');
        loadHistory();
      } else {
        toast.error(data.error || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  function getStatusBadge(status: string) {
    if (status === 'MATCH') return <Badge className="bg-green-100 text-green-700 text-[10px]">ตรง</Badge>;
    if (status === 'DIFFERENCE') return <Badge className="bg-red-100 text-red-700 text-[10px]">ต่าง</Badge>;
    return <Badge className="bg-gray-100 text-gray-500 text-[10px]">ยังไม่ชั่ง</Badge>;
  }

  // Calculate totals
  const totalPurchase = weighingItems.reduce((s, i) => s + i.purchaseInWeight, 0);
  const totalSorting = weighingItems.reduce((s, i) => s - i.sortingSourceOutWeight + i.sortingOutputInWeight, 0);
  const totalDismantling = weighingItems.reduce((s, i) => s - i.transferSourceOutWeight + i.transferOutputInWeight, 0);
  const totalExpected = weighingItems.reduce((s, i) => s + i.dailyNet, 0);
  const hasNotStarted = false; // ST-53: daily movements don't have NOT_STARTED state
  const totalActual = weighingItems.reduce((s, i) => s + (parseFloat(i.actualWeighedWeight) || 0), 0);
  const totalDiff = Math.round((totalActual - totalExpected) * 100) / 100;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-5 w-5" /> ชั่งยอดทองแดง/ทองเหลืองประจำวัน
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">วันที่</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-sm"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">{toBuddhistDate(date)} (พ.ศ.)</p>
            </div>
            <div>
              <Label className="text-xs">หมวดสินค้า</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ทองแดง">ทองแดง</SelectItem>
                  <SelectItem value="ทองเหลือง">ทองเหลือง</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={loadAggregate} disabled={loading || !date} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                โหลดข้อมูล
              </Button>
            </div>
            <div className="flex items-end">
              {weighingItems.length > 0 && (
                <Button
                  onClick={handleSave}
                  disabled={saving || baselineMissing || hasNotStarted}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  บันทึกผลชั่ง
                </Button>
              )}
            </div>
          </div>
          {weighingItems.length > 0 && (
            <div className="mt-2">
              <Input
                placeholder="หมายเหตุ (ถ้ามี)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="text-sm"
              />
            </div>
          )}
          {weighingItems.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-2">
              ยอดสุทธิของวันในระบบ = รายการเข้า - รายการออก ± การปรับยอด (เฉพาะวันที่เลือกเท่านั้น ไม่รวมยอดยกมา)
            </p>
          )}
          {baselineMissing && (
            <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              ยังไม่มีฐานสต็อกที่ Owner อนุมัติ ระบบจึงไม่สร้างยอดคงเหลือสมมติและปิดการบันทึกผลเปรียบเทียบไว้
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      {weighingItems.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="space-y-3 p-3 md:hidden">
              {weighingItems.map((item, idx) => {
                const actual = parseFloat(item.actualWeighedWeight);
                const hasActual = item.actualWeighedWeight !== '' && Number.isFinite(actual);
                const diff = hasActual ? Math.round((actual - item.dailyNet) * 100) / 100 : null;
                const status = diff === null ? 'NOT_WEIGHED' : Math.abs(diff) <= TOLERANCE ? 'MATCH' : 'DIFFERENCE';
                return (
                  <section key={item.productId} className="rounded-lg border bg-white p-3" aria-label={item.productName}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-medium">{item.productName}</p><p className="text-xs text-gray-500">ยอดสุทธิของวันในระบบ</p></div>
                      <p className="text-lg font-semibold tabular-nums">{formatWeight(item.dailyNet)} กก.</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">น้ำหนักชั่งจริง</Label><Input type="number" min="0" step="0.01" value={item.actualWeighedWeight} onChange={event => setWeighingItems(previous => previous.map((row, rowIndex) => rowIndex === idx ? { ...row, actualWeighedWeight: event.target.value } : row))} /></div>
                      <div><p className="text-xs text-gray-500">ส่วนต่าง</p><p className={`mt-2 font-semibold ${diff === null ? 'text-gray-400' : diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>{diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff}`}</p></div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">{getStatusBadge(status)}<details className="text-xs"><summary className="cursor-pointer text-blue-700">ดูรายการเคลื่อนไหว</summary><div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600"><span>ซื้อเข้า / ขายออก</span><span className="text-right">+{formatWeight(item.purchaseInWeight)} / -{formatWeight(item.saleOutWeight)}</span><span>คัดแยก เข้า / ออก</span><span className="text-right">+{formatWeight(item.sortingOutputInWeight)} / -{formatWeight(item.sortingSourceOutWeight)}</span><span>แกะ/ย้าย เข้า / ออก</span><span className="text-right">+{formatWeight(item.transferOutputInWeight)} / -{formatWeight(item.transferSourceOutWeight)}</span><span>ปรับยอดสุทธิ</span><span className="text-right">{formatWeight(item.adjustmentNetWeight)}</span></div></details></div>
                  </section>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">สินค้า</TableHead>
                    <TableHead className="text-right min-w-24">ซื้อเข้า</TableHead>
                    <TableHead className="text-right min-w-24">ขายออก</TableHead>
                    <TableHead className="text-right min-w-24">ต้นทางคัดแยก</TableHead>
                    <TableHead className="text-right min-w-24">ผลผลิตคัดแยก</TableHead>
                    <TableHead className="text-right min-w-24">ต้นทางแกะ/ย้าย</TableHead>
                    <TableHead className="text-right min-w-24">ผลผลิตแกะ/ย้าย</TableHead>
                    <TableHead className="text-right min-w-24">ปรับยอดสุทธิ</TableHead>
                    <TableHead className="text-right min-w-28">ยอดสุทธิของวันในระบบ</TableHead>
                    <TableHead className="text-right min-w-28">น้ำหนักชั่งรวมจริง (กก.)</TableHead>
                    <TableHead className="text-right min-w-24">ส่วนต่าง (กก.)</TableHead>
                    <TableHead className="text-center min-w-20">สถานะ</TableHead>
                    <TableHead className="min-w-32">หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weighingItems.map((item, idx) => {
                    const actual = parseFloat(item.actualWeighedWeight) || null;
                    const diff = actual !== null ? Math.round((actual - item.dailyNet) * 100) / 100 : null;
                    const status = actual === null ? 'NOT_WEIGHED' : Math.abs(diff!) <= TOLERANCE ? 'MATCH' : 'DIFFERENCE';
                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-medium text-sm">{item.productName}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.purchaseInWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.saleOutWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.sortingSourceOutWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.sortingOutputInWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.transferSourceOutWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.transferOutputInWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.adjustmentNetWeight)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatWeight(item.dailyNet)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={item.actualWeighedWeight}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0)) {
                                setWeighingItems(prev => prev.map((it, i) => i === idx ? { ...it, actualWeighedWeight: val } : it));
                              }
                            }}
                            placeholder="—"
                            className="text-sm h-8 w-24 text-right"
                            step="0.01"
                          />
                        </TableCell>
                        <TableCell className={`text-right text-sm ${diff === null ? 'text-gray-400' : Math.abs(diff) <= TOLERANCE ? 'text-green-600' : 'text-red-600'}`}>
                          {diff === null ? '—' : (diff > 0 ? '+' : '') + diff}
                        </TableCell>
                        <TableCell className="text-center">{getStatusBadge(status)}</TableCell>
                        <TableCell>
                          <Input
                            value={item.note}
                            onChange={(e) => {
                              setWeighingItems(prev => prev.map((it, i) => i === idx ? { ...it, note: e.target.value } : it));
                            }}
                            placeholder="—"
                            className="text-sm h-8"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Total row */}
                  <TableRow className="border-t-2 bg-gray-50">
                    <TableCell className="font-bold text-sm">รวม</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(totalPurchase)}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(totalSorting)}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(totalDismantling)}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(totalExpected)}</TableCell>
                    <TableCell className="text-center text-sm">—</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(totalActual)}</TableCell>
                    <TableCell className={`text-right font-bold text-sm ${Math.abs(totalDiff) <= TOLERANCE ? 'text-green-600' : 'text-red-600'}`}>
                      {totalDiff > 0 ? '+' : ''}{totalDiff}
                    </TableCell>
                    <TableCell className="text-center">—</TableCell>
                    <TableCell>—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" /> ประวัติการชั่ง
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50"
                  onClick={() => { setDetailSession(s); setDetailOpen(true); }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{toBuddhistDate(s.weighingDate)}</span>
                    <Badge variant="secondary" className="text-[10px]">{s.category}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{s.items.length} รายการ</span>
                    <span>{new Date(s.createdAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ผลชั่ง {detailSession && toBuddhistDate(detailSession.weighingDate)} — {detailSession?.category}</DialogTitle>
            <DialogDescription>
              บันทึกเมื่อ {detailSession && new Date(detailSession.createdAt).toLocaleString('th-TH')}
            </DialogDescription>
          </DialogHeader>
          {detailSession && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">สินค้า</TableHead>
                    <TableHead className="text-right min-w-24">ซื้อเข้า</TableHead>
                    <TableHead className="text-right min-w-24">คัดแยก</TableHead>
                    <TableHead className="text-right min-w-24">แกะของ</TableHead>
                    <TableHead className="text-right min-w-28">รวมในระบบ</TableHead>
                    <TableHead className="text-center min-w-20">เอกสาร</TableHead>
                    <TableHead className="text-right min-w-24">ชั่งจริง</TableHead>
                    <TableHead className="text-right min-w-24">ส่วนต่าง</TableHead>
                    <TableHead className="text-center min-w-20">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailSession.items.map((item) => {
                    const totalDocCount = item.purchaseBillCount + item.sortingBillCount + item.dismantlingRecordCount;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm font-medium">{item.product.name}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.purchaseWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.sortingOutputWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.dismantlingOutputWeight)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{formatWeight(item.expectedTotalWeight)}</TableCell>
                        <TableCell className="text-center text-sm">{totalDocCount}</TableCell>
                        <TableCell className="text-right text-sm">{item.actualWeighedWeight === null ? '—' : formatWeight(item.actualWeighedWeight)}</TableCell>
                        <TableCell className={`text-right text-sm ${item.differenceWeight === null ? 'text-gray-400' : Math.abs(item.differenceWeight) <= TOLERANCE ? 'text-green-600' : 'text-red-600'}`}>
                          {item.differenceWeight === null ? '—' : (item.differenceWeight > 0 ? '+' : '') + item.differenceWeight}
                        </TableCell>
                        <TableCell className="text-center">{getStatusBadge(item.status)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Detail total row */}
                  <TableRow className="border-t-2 bg-gray-50">
                    <TableCell className="font-bold text-sm">รวม</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + i.purchaseWeight, 0))}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + i.sortingOutputWeight, 0))}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + i.dismantlingOutputWeight, 0))}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + i.expectedTotalWeight, 0))}</TableCell>
                    <TableCell className="text-center text-sm">—</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + (i.actualWeighedWeight ?? 0), 0))}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatWeight(detailSession.items.reduce((s, i) => s + (i.differenceWeight ?? 0), 0))}</TableCell>
                    <TableCell className="text-center">—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          {detailSession?.note && (
            <div className="mt-2 p-2 rounded bg-gray-50 text-sm text-gray-600">
              หมายเหตุ: {detailSession.note}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">ปิด</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
