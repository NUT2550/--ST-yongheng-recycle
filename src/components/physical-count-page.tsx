'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Scale, Loader2, Save, Eye, Lock, History, RefreshCw, CheckCircle2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { toast } from 'sonner';
import { formatWeight, formatBaht } from '@/lib/helpers';

interface ProductStock {
  id: string;
  name: string;
  systemWeight: number;
  averageCost: number;
  systemValue: number;
}

interface PhysicalCountItem {
  productId: string;
  productName: string;
  systemWeight: number;
  physicalWeight: string;
  averageCost: number;
  note: string;
}

interface Session {
  id: string;
  countDate: string;
  group: string;
  status: string;
  note: string | null;
  items: Array<{
    id: string;
    productId: string;
    systemWeight: number;
    physicalWeight: number;
    differenceWeight: number;
    averageCost: number;
    valueDifference: number;
    note: string | null;
    product: { name: string };
  }>;
}

export default function PhysicalCountPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [group, setGroup] = useState('ทองแดง');
  const [products, setProducts] = useState<ProductStock[]>([]);
  const [items, setItems] = useState<PhysicalCountItem[]>([]);
  const [note, setNote] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detailSession, setDetailSession] = useState<Session | null>(null);
  const [applying, setApplying] = useState(false);
  // ST-9: Confirm-preview dialog state (2-step confirmation before Apply)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmItems, setConfirmItems] = useState<Array<{
    productId: string;
    productName: string;
    currentStock: number;
    physical: number;
    difference: number;
    avgCost: number;
    valueDiff: number;
    afterWeight: number;
  }>>([]);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmSessionId, setConfirmSessionId] = useState('');

  const token = getAuthToken();

  // Load products when group changes
  async function loadProducts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/physical-counts?action=products&category=${encodeURIComponent(group)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'โหลดไม่ได้' }));
        toast.error(d.error || 'โหลดไม่ได้');
        setProducts([]);
        setItems([]);
        return;
      }
      const data = await res.json();
      setProducts(data.products || []);
      setItems((data.products || []).map((p: ProductStock) => ({
        productId: p.id,
        productName: p.name,
        systemWeight: p.systemWeight,
        physicalWeight: '',
        averageCost: p.averageCost,
        note: '',
      })));
    } catch {
      toast.error('โหลดข้อมูลไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  // Load history
  async function loadHistory() {
    try {
      const res = await fetch('/api/physical-counts?limit=20', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch { /* non-fatal */ }
  }

  // ST-9: Apply a DRAFT physical count session — adjusts stock to match physical count.
  async function handleApply(sessionId: string, applyNote: string) {
    setApplying(true);
    try {
      const res = await fetch(`/api/physical-counts/${sessionId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ note: applyNote || undefined }),
      });
      const data = await res.json().catch(() => ({ error: 'Apply ไม่สำเร็จ' }));
      if (res.ok) {
        toast.success(`Apply สำเร็จ — ${data.adjustmentsApplied || 0} รายการปรับสต็อก`);
        setDetailSession(null);
        setConfirmOpen(false);
        loadHistory();
      } else {
        toast.error(data.error || 'Apply ไม่สำเร็จ');
      }
    } catch {
      toast.error('Apply ไม่สำเร็จ — ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setApplying(false);
    }
  }

  // ST-9: Step 1 of 2-step confirmation — fetch live stock + open confirm dialog.
  // Re-reads CURRENT stock (not the draft snapshot) so the preview is accurate at apply time.
  async function handleConfirmApply(session: Session) {
    try {
      // Fetch current stock for all products in the session
      const previewItems: Array<{
        productId: string;
        productName: string;
        currentStock: number;
        physical: number;
        difference: number;
        avgCost: number;
        valueDiff: number;
        afterWeight: number;
      }> = [];
      for (const item of session.items) {
        // Use the products endpoint to get current stock for this product's category
        // (or we could add a dedicated endpoint — for now, use the existing stock API)
        const stockRes = await fetch('/api/stock', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!stockRes.ok) {
          toast.error('ไม่สามารถโหลดสต็อกปัจจุบันได้');
          return;
        }
        const stockData = await stockRes.json();
        // Find this product across all categories
        let currentStock = 0;
        let avgCost = item.averageCost;
        for (const cat of stockData) {
          const prod = cat.products?.find((p: { id: string }) => p.id === item.productId);
          if (prod) {
            currentStock = prod.totalWeight || 0;
            avgCost = prod.avgCostPerKg || item.averageCost;
            break;
          }
        }
        const difference = Math.round((item.physicalWeight - currentStock) * 100) / 100;
        const afterWeight = Math.round((currentStock + difference) * 100) / 100;
        const valueDiff = Math.round(difference * avgCost * 100) / 100;
        if (difference !== 0) {
          previewItems.push({
            productId: item.productId,
            productName: item.product.name,
            currentStock,
            physical: item.physicalWeight,
            difference,
            avgCost,
            valueDiff,
            afterWeight,
          });
        }
      }
      setConfirmItems(previewItems);
      setConfirmSessionId(session.id);
      setConfirmNote('');
      setConfirmOpen(true);
    } catch {
      toast.error('ไม่สามารถเตรียมข้อมูล Preview ได้');
    }
  }

  useEffect(() => { loadHistory(); }, []);

  // Calculate totals
  const totals = useMemo(() => {
    let systemWeight = 0, physicalWeight = 0, diffWeight = 0, diffValue = 0;
    for (const item of items) {
      systemWeight += item.systemWeight;
      const phys = parseFloat(item.physicalWeight) || 0;
      physicalWeight += phys;
      const diff = phys - item.systemWeight;
      diffWeight += diff;
      diffValue += diff * item.averageCost;
    }
    return {
      systemWeight: Math.round(systemWeight * 100) / 100,
      physicalWeight: Math.round(physicalWeight * 100) / 100,
      diffWeight: Math.round(diffWeight * 100) / 100,
      diffValue: Math.round(diffValue * 100) / 100,
    };
  }, [items]);

  // Items with non-zero difference (for preview)
  const previewItems = useMemo(() => {
    return items.filter(item => {
      const phys = parseFloat(item.physicalWeight) || 0;
      return Math.abs(phys - item.systemWeight) > 0.001;
    });
  }, [items]);

  // Save draft
  async function handleSave() {
    const itemsWithData = items.filter(item => item.physicalWeight !== '');
    if (itemsWithData.length === 0) {
      toast.error('กรุณากรอกน้ำหนักชั่งจริงอย่างน้อย 1 รายการ');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        countDate: new Date(date).toISOString(),
        group,
        note,
        items: itemsWithData.map(item => {
          const phys = parseFloat(item.physicalWeight) || 0;
          const diff = phys - item.systemWeight;
          return {
            productId: item.productId,
            systemWeight: item.systemWeight,
            physicalWeight: phys,
            differenceWeight: Math.round(diff * 100) / 100,
            averageCost: item.averageCost,
            valueDifference: Math.round(diff * item.averageCost * 100) / 100,
            note: item.note || null,
          };
        }),
      };
      const res = await fetch('/api/physical-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success('บันทึกร่างการชั่งสำเร็จ');
        loadHistory();
      } else {
        const d = await res.json().catch(() => ({ error: 'บันทึกไม่สำเร็จ' }));
        toast.error(d.error || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Preview-only warning */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-800">
        <Scale className="h-5 w-5 shrink-0" />
        <span>หน้านี้สำหรับ <strong>บันทึกและดูตัวอย่างการชั่งสต็อกจริง</strong> เท่านั้น — ยังไม่ปรับสต็อก ไม่สร้าง StockLot ไม่เปลี่ยนปริมาณสินค้า</span>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Scale className="h-5 w-5" /> ชั่งสต็อกจริง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">วันที่</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">หมวดหมู่</Label>
              <Select value={group} onValueChange={(v) => { setGroup(v); setItems([]); }}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ทองแดง">ทองแดง</SelectItem>
                  <SelectItem value="ทองเหลือง">ทองเหลือง</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">หมายเหตุ</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" className="text-sm" />
            </div>
            <div className="flex items-end">
              <Button onClick={loadProducts} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                โหลดข้อมูล
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {products.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">รายการสินค้า</TableHead>
                    <TableHead className="text-right">น้ำหนักในระบบ (กก.)</TableHead>
                    <TableHead className="text-right">ต้นทุนเฉลี่ย/กก.</TableHead>
                    <TableHead className="text-right">มูลค่าในระบบ</TableHead>
                    <TableHead className="text-right">น้ำหนักชั่งจริง (กก.)</TableHead>
                    <TableHead className="text-right">ส่วนต่าง (กก.)</TableHead>
                    <TableHead className="text-right">มูลค่าส่วนต่าง</TableHead>
                    <TableHead className="w-32">หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => {
                    const phys = parseFloat(item.physicalWeight) || 0;
                    const diff = phys - item.systemWeight;
                    const valDiff = diff * item.averageCost;
                    return (
                      <TableRow key={item.productId}>
                        <TableCell className="font-medium text-sm">{item.productName}</TableCell>
                        <TableCell className="text-right text-sm">{formatWeight(item.systemWeight)}</TableCell>
                        <TableCell className="text-right text-sm">{formatBaht(item.averageCost)}</TableCell>
                        <TableCell className="text-right text-sm">{formatBaht(item.systemWeight * item.averageCost)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={item.physicalWeight}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '' || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0)) {
                                setItems(prev => prev.map((it, i) => i === idx ? { ...it, physicalWeight: val } : it));
                              }
                            }}
                            placeholder="0"
                            className="text-sm h-8 w-24 text-right"
                            step="0.01"
                            min="0"
                          />
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {diff > 0 ? '+' : ''}{formatWeight(diff)}
                        </TableCell>
                        <TableCell className={`text-right text-sm ${valDiff > 0 ? 'text-green-600' : valDiff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {valDiff > 0 ? '+' : ''}{formatBaht(valDiff)}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.note}
                            onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, note: e.target.value } : it))}
                            placeholder=""
                            className="text-sm h-8"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  <TableRow className="bg-gray-50 font-semibold">
                    <TableCell>รวม</TableCell>
                    <TableCell className="text-right">{formatWeight(totals.systemWeight)}</TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right">{formatBaht(totals.systemWeight * items.reduce((s, i) => s + i.averageCost, 0))}</TableCell>
                    <TableCell className="text-right">{formatWeight(totals.physicalWeight)}</TableCell>
                    <TableCell className={`text-right ${totals.diffWeight > 0 ? 'text-green-600' : totals.diffWeight < 0 ? 'text-red-600' : ''}`}>
                      {totals.diffWeight > 0 ? '+' : ''}{formatWeight(totals.diffWeight)}
                    </TableCell>
                    <TableCell className={`text-right ${totals.diffValue > 0 ? 'text-green-600' : totals.diffValue < 0 ? 'text-red-600' : ''}`}>
                      {totals.diffValue > 0 ? '+' : ''}{formatBaht(totals.diffValue)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      {products.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            บันทึกร่างการชั่ง
          </Button>
          <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={previewItems.length === 0}>
            <Eye className="h-4 w-4 mr-1" />
            Preview Adjustment ({previewItems.length})
          </Button>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Lock className="h-3 w-3" />
            บันทึกก่อน แล้ว Apply ได้จากประวัติด้านล่าง
          </span>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview Adjustment — {group} ({date})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-gray-500">รายการที่มีส่วนต่าง ({previewItems.length} รายการ):</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">สต็อกในระบบ</TableHead>
                  <TableHead className="text-right">ชั่งจริง</TableHead>
                  <TableHead className="text-right">ส่วนต่าง</TableHead>
                  <TableHead className="text-right">ต้นทุน/กก.</TableHead>
                  <TableHead className="text-right">มูลค่าส่วนต่าง</TableHead>
                  <TableHead>ทิศทาง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewItems.map(item => {
                  const phys = parseFloat(item.physicalWeight) || 0;
                  const diff = phys - item.systemWeight;
                  const valDiff = diff * item.averageCost;
                  return (
                    <TableRow key={item.productId}>
                      <TableCell className="text-sm font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right text-sm">{formatWeight(item.systemWeight)}</TableCell>
                      <TableCell className="text-right text-sm">{formatWeight(phys)}</TableCell>
                      <TableCell className={`text-right text-sm ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diff > 0 ? '+' : ''}{formatWeight(diff)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatBaht(item.averageCost)}</TableCell>
                      <TableCell className={`text-right text-sm ${valDiff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {valDiff > 0 ? '+' : ''}{formatBaht(valDiff)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={diff > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                          {diff > 0 ? 'เพิ่มสต็อก' : 'ลดสต็อก'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex justify-between p-2 bg-gray-50 rounded text-sm font-medium">
              <span>รวมส่วนต่าง: {totals.diffWeight > 0 ? '+' : ''}{formatWeight(totals.diffWeight)} กก.</span>
              <span>รวมมูลค่า: {totals.diffValue > 0 ? '+' : ''}{formatBaht(totals.diffValue)} บาท</span>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">ปิด</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><History className="h-5 w-5" /> ประวัติการชั่ง</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">ยังไม่มีบันทึกการชั่ง</p>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => {
                const totalDiff = s.items.reduce((sum, i) => sum + i.differenceWeight, 0);
                const totalVal = s.items.reduce((sum, i) => sum + i.valueDifference, 0);
                return (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border bg-white hover:bg-gray-50 cursor-pointer"
                    onClick={() => setDetailSession(s)}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{new Date(s.countDate).toLocaleDateString('th-TH')}</span>
                        <Badge variant="secondary" className="text-[10px]">{s.group}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${s.status === 'DRAFT' ? 'bg-yellow-50 text-yellow-700' : s.status === 'APPLIED' ? 'bg-green-50 text-green-700' : ''}`}>
                          {s.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500">{s.items.length} รายการ{s.note ? ` · ${s.note}` : ''}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium ${totalDiff > 0 ? 'text-green-600' : totalDiff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {totalDiff > 0 ? '+' : ''}{formatWeight(totalDiff)} กก.
                      </div>
                      <div className={`text-xs ${totalVal > 0 ? 'text-green-600' : totalVal < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {totalVal > 0 ? '+' : ''}{formatBaht(totalVal)} บาท
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detailSession} onOpenChange={(o) => !o && setDetailSession(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>รายละเอียดการชั่ง — {detailSession?.group} ({detailSession ? new Date(detailSession.countDate).toLocaleDateString('th-TH') : ''})</DialogTitle>
          </DialogHeader>
          {detailSession && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">ในระบบ</TableHead>
                  <TableHead className="text-right">ชั่งจริง</TableHead>
                  <TableHead className="text-right">ส่วนต่าง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailSession.items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">{item.product.name}</TableCell>
                    <TableCell className="text-right text-sm">{formatWeight(item.systemWeight)}</TableCell>
                    <TableCell className="text-right text-sm">{formatWeight(item.physicalWeight)}</TableCell>
                    <TableCell className={`text-right text-sm ${item.differenceWeight > 0 ? 'text-green-600' : item.differenceWeight < 0 ? 'text-red-600' : ''}`}>
                      {item.differenceWeight > 0 ? '+' : ''}{formatWeight(item.differenceWeight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {detailSession?.status === 'DRAFT' && (
              <Button
                onClick={() => detailSession && handleConfirmApply(detailSession)}
                disabled={applying}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                ดู Preview และ Apply
              </Button>
            )}
            <DialogClose asChild><Button variant="outline">ปิด</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ST-9: Confirm-preview dialog (2-step confirmation before Apply) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-red-600">⚠️ ยืนยันการ Apply — จะปรับสต็อกจริง</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              ตรวจสอบรายการด้านล่างให้ถูกต้อง ก่อนกด "ยืนยัน Apply" — ระบบจะสร้าง STOCK_ADJUSTMENT และเปลี่ยนสถานะเป็น APPLIED ทันที
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">สต็อกในระบบ</TableHead>
                  <TableHead className="text-right">ชั่งจริง</TableHead>
                  <TableHead className="text-right">ส่วนต่าง</TableHead>
                  <TableHead className="text-right">ต้นทุน/กก.</TableHead>
                  <TableHead className="text-right">มูลค่าส่วนต่าง</TableHead>
                  <TableHead className="text-right">ยอดหลัง Apply</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {confirmItems.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell className="text-sm font-medium">{item.productName}</TableCell>
                    <TableCell className="text-right text-sm">{formatWeight(item.currentStock)}</TableCell>
                    <TableCell className="text-right text-sm">{formatWeight(item.physical)}</TableCell>
                    <TableCell className={`text-right text-sm ${item.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.difference > 0 ? '+' : ''}{formatWeight(item.difference)}
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatBaht(item.avgCost)}</TableCell>
                    <TableCell className={`text-right text-sm ${item.valueDiff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.valueDiff > 0 ? '+' : ''}{formatBaht(item.valueDiff)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatWeight(item.afterWeight)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1.5">
              <Label className="text-xs">หมายเหตุ (ไม่บังคับ)</Label>
              <Input
                value={confirmNote}
                onChange={(e) => setConfirmNote(e.target.value)}
                placeholder="เช่น ชั่งท้ายวัน วันที่ X"
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Button
              onClick={() => handleApply(confirmSessionId, confirmNote)}
              disabled={applying}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              ยืนยัน Apply (ปรับสต็อกจริง)
            </Button>
            <DialogClose asChild><Button variant="outline">ยกเลิก</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
