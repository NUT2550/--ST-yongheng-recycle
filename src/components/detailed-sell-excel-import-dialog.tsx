'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Product, SellCartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { getAuthToken } from '@/lib/api';
import * as XLSX from 'xlsx';

export interface PlannedSellBill {
  externalBillNumber: string;
  buyer: string;
  buyerCode: string;
  date: string;
  licensePlate: string;
  note: string;
  items: Array<{
    productName: string;
    productCode: string;
    productId: string | null;
    weight: number;
    pricePerKg: number;
    amount: number;
    matched: boolean;
  }>;
  totalWeight: number;
  totalAmount: number;
  excelTotalAmount: number;
  amountDiff: number;
  isDuplicate: boolean;
}

interface DetailedSellExcelImportDialogProps {
  products: Product[];
  onImport: (bills: Array<{
    externalBillNumber: string;
    date: string;
    buyer: string;
    note: string;
    items: SellCartItem[];
  }>) => void;
}

export function DetailedSellExcelImportDialog({ products, onImport }: DetailedSellExcelImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedSellBill[]>([]);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      m.set(p.name.trim().normalize('NFC'), p);
    }
    return m;
  }, [products]);

  const safeAliases: Record<string, string> = {
    'ทองแดงช็อต': 'ทองแดงปอกช็อต',
    'แสตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
    'แสตนเลส 202': 'สแตนเลส 202',
  };

  function fixThaiText(text: string): string {
    if (!text) return text;
    const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF);
    if (!hasGarbled) return text;
    try {
      const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF));
      return new TextDecoder('windows-874').decode(bytes);
    } catch {
      return text;
    }
  }

  function matchProduct(excelName: string): Product | null {
    const normalizedInput = excelName.replace(/อลูมีเนียม/g, 'อลูมิเนียม').replace(/แสตนเลส/g, 'สแตนเลส');
    const trimmed = normalizedInput.trim().normalize('NFC');
    if (productMap.has(trimmed)) return productMap.get(trimmed)!;
    const alias = safeAliases[normalizedInput.trim()]?.normalize('NFC');
    if (alias && productMap.has(alias)) return productMap.get(alias)!;
    const contains = products.filter(p => {
      const pn = p.name.normalize('NFC');
      return pn.includes(trimmed) || trimmed.includes(pn);
    });
    if (contains.length === 1) return contains[0];
    return null;
  }

  function parseThaiDate(dateStr: string): string {
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const buddhistYear = parseInt(parts[2]);
      const ceYear = buddhistYear - 543;
      return new Date(ceYear, month, day, 10, 0, 0).toISOString();
    }
    return new Date().toISOString();
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.xls') && !lowerName.endsWith('.xlsx')) {
      toast.error('ไฟล์ต้องเป็น .xls หรือ .xlsx เท่านั้น');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setLoading(true);
    setPlannedBills([]);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', codepage: 874 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];

      // ST-18: Detect sales format — report09 (per-product) vs report10 (per-buyer)
      const row3 = rows[3] || [];
      const lastRows = rows.slice(-5).map(r => (r || []).map(c => c == null ? '' : fixThaiText(String(c))).join(' ')).join(' ');
      const isReport10 = lastRows.includes('report10') || String(row3[0] || '').includes('ผู้ซื้อ');
      const detectedFormat = isReport10 ? 'report10' : 'report09';

      const bills: PlannedSellBill[] = [];
      let currentBill: PlannedSellBill | null = null;
      let currentBuyer = '';
      let currentBuyerCode = '';
      let currentProductName = '';

      if (isReport10) {
        // ST-18: report10 — per-buyer layout (same structure as purchase report04)
        // Row 3: col 0="ผู้ซื้อ", col 2="วัสดุ", col 3="ทะเบียน", col 4="หมายเหตุ"
        // Row 4: buyer summary (col 0=buyer code, col 1=buyer name, col 12=buyer total)
        // Row 5: bill header (col 1=date, col 2=bill#, col 3=license plate, col 4=note, col 12=bill total)
        // Row 6+: item rows (col 2=product code, col 3=product name, col 9=weight, col 11=price, col 12=amount)
        for (let i = 4; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

          if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue;
          if (fixThaiText(String(r[12] || '')).includes('report10') || fixThaiText(String(r[0] || '')).match(/^หน้าที่/)) continue;

          // Buyer summary row: col 0 = buyer code (4-digit), col 1 = buyer name, col 12 = buyer total
          if (r[0] && r[1] && !r[2] && r[12] != null && /^\d{4}$/.test(String(r[0]).trim())) {
            currentBuyerCode = String(r[0]).trim();
            currentBuyer = fixThaiText(String(r[1])).trim();
            continue;
          }

          // Bill header row: col 1 = date, col 2 = bill number (A...), col 3 = license plate, col 4 = note
          if (r[1] && r[2] && String(r[2]).trim().match(/^A\d+/i)) {
            if (currentBill) bills.push(currentBill);
            const dateStr = fixThaiText(String(r[1])).trim();
            const billNo = String(r[2]).trim();
            const licensePlate = r[3] ? fixThaiText(String(r[3])).trim() : '';
            const note = r[4] ? fixThaiText(String(r[4])).trim() : '';
            const excelTotal = parseFloat(String(r[12])) || 0;
            currentBill = {
              externalBillNumber: billNo,
              buyer: currentBuyer,
              buyerCode: currentBuyerCode,
              date: dateStr,
              licensePlate,
              note,
              items: [],
              totalWeight: 0,
              totalAmount: 0,
              excelTotalAmount: excelTotal,
              amountDiff: 0,
              isDuplicate: false,
            };
            continue;
          }

          // Item row: col 2 = product code (4-digit), col 3 = product name, col 9 = weight, col 11 = price, col 12 = amount
          if (r[2] && r[3] && r[9] != null && currentBill) {
            const productName = fixThaiText(String(r[3])).trim();
            const weight = parseFloat(String(r[9])) || 0;
            const pricePerKg = parseFloat(String(r[11])) || 0;
            const amount = parseFloat(String(r[12])) || 0;
            const matched = matchProduct(productName);

            currentBill.items.push({
              productName,
              productCode: String(r[2]).trim(),
              productId: matched?.id || null,
              weight,
              pricePerKg,
              amount,
              matched: !!matched,
            });
            currentBill.totalWeight += weight;
            currentBill.totalAmount += amount;
          }
        }
      } else {
        // report09: per-product layout (same as purchase report03)
        // Row 3: col 1="วัสดุ", col 2="ผู้ซื้อ"
        // Row 4: product summary (col 0=4-digit code, col 1=product name, col 9=weight, col 12=total)
        // Row 5+: transaction rows (col 0=date, col 1=bill#, col 2=buyer code (empty), col 3=buyer name, col 9=weight, col 12=amount)
        for (let i = 4; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(c => c === null || c === undefined)) continue;

          if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue;
          if (fixThaiText(String(r[12] || '')).includes('report09') || fixThaiText(String(r[0] || '')).match(/^หน้าที่/)) continue;

          // Product summary row
          if (r[0] && /^\d{4}$/.test(String(r[0]).trim()) && r[1] && typeof r[1] === 'string' && r[9] != null) {
            currentProductName = fixThaiText(String(r[1])).trim();
            continue;
          }

          // Transaction row: col 0=date, col 1=bill#, col 3=buyer name
          if (r[0] && r[1] && r[9] != null) {
            const dateStr = fixThaiText(String(r[0])).trim();
            const billNo = String(r[1]).trim();
            if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
              const buyerName = fixThaiText(String(r[4] ?? r[3] ?? '')).trim();

              if (!currentBill || currentBill.externalBillNumber !== billNo) {
                if (currentBill) bills.push(currentBill);
                currentBill = {
                  externalBillNumber: billNo,
                  buyer: buyerName,
                  buyerCode: String(r[3] ?? '').trim(),
                  date: dateStr,
                  licensePlate: '',
                  note: '',
                  items: [],
                  totalWeight: 0,
                  totalAmount: 0,
                  excelTotalAmount: 0,
                  amountDiff: 0,
                  isDuplicate: false,
                };
              }

              const productName = currentProductName || '(ไม่ระบุสินค้า)';
              const weight = parseFloat(String(r[9])) || 0;
              const pricePerKg = parseFloat(String(r[11])) || 0;
              const amount = parseFloat(String(r[12])) || 0;
              const matched = matchProduct(productName);

              currentBill.items.push({
                productName,
                productCode: String(r[0]).trim(),
                productId: matched?.id || null,
                weight,
                pricePerKg,
                amount,
                matched: !!matched,
              });
              currentBill.totalWeight += weight;
              currentBill.totalAmount += amount;
            }
          }
        }
      }
      if (currentBill) bills.push(currentBill);

      // Calculate amount diff and round
      for (const b of bills) {
        b.totalWeight = Math.round(b.totalWeight * 100) / 100;
        b.totalAmount = Math.round(b.totalAmount * 100) / 100;
        b.amountDiff = Math.round((b.totalAmount - b.excelTotalAmount) * 100) / 100;
      }

      setPlannedBills(bills);
      toast.success(`พาร์สไฟล์สำเร็จ (${detectedFormat}): ${bills.length} บิล, ${bills.reduce((s, b) => s + b.items.length, 0)} รายการ`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`พาร์สไฟล์ไม่สำเร็จ: ${message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Duplicate check
  const checkDuplicates = async () => {
    const billNumbers = plannedBills.map(b => b.externalBillNumber);
    if (billNumbers.length === 0) return;
    try {
      const token = getAuthToken();
      if (!token) return;
      const res = await fetch('/api/sell-bills?page=1&limit=100&includeCancelled=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        const existingNums = new Set(
          (data.bills || [])
            .map((b: any) => b.externalBillNumber)
            .filter((n: any) => n !== null && n !== undefined)
        );
        setPlannedBills(prev =>
          prev.map(b => ({
            ...b,
            isDuplicate: existingNums.has(b.externalBillNumber),
          }))
        );
      }
    } catch {
      // non-fatal
    }
  };

  const stats = useMemo(() => {
    const totalItems = plannedBills.reduce((s, b) => s + b.items.length, 0);
    const unmatchedItems = plannedBills.reduce((s, b) => s + b.items.filter(i => !i.matched).length, 0);
    const duplicates = plannedBills.filter(b => b.isDuplicate).length;
    const hasBlockers = unmatchedItems > 0 || duplicates > 0;
    return { totalItems, unmatchedItems, duplicates, hasBlockers };
  }, [plannedBills]);

  const unmatchedProducts = useMemo(() => {
    const set = new Map<string, number>();
    for (const b of plannedBills) {
      for (const it of b.items) {
        if (!it.matched) set.set(it.productName, (set.get(it.productName) || 0) + 1);
      }
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count }));
  }, [plannedBills]);

  const canImport = plannedBills.length > 0 && !stats.hasBlockers && !importing;

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    try {
      const billsToImport = plannedBills.filter(b => !b.isDuplicate);
      const importData = billsToImport.map(b => ({
        externalBillNumber: b.externalBillNumber,
        date: parseThaiDate(b.date),
        buyer: b.buyer,
        note: `ผู้ซื้อ: ${b.buyer}${b.licensePlate ? ` | ทะเบียน: ${b.licensePlate}` : ''}${b.note ? ` | ${b.note}` : ''} | นำเข้าจาก: ${fileName}`,
        items: b.items.filter(i => i.matched).map(i => ({
          productId: i.productId!,
          productName: i.productName,
          weight: i.weight,
          pricePerKg: i.pricePerKg,
          totalAmount: i.amount,
        })) as SellCartItem[],
      }));
      onImport(importData as any);
      setOpen(false);
      setPlannedBills([]);
      setFileName('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`นำเข้าไม่สำเร็จ: ${message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setPlannedBills([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const duplicateChecked = useRef(false);
  useEffect(() => {
    if (plannedBills.length > 0 && !duplicateChecked.current) {
      duplicateChecked.current = true;
      checkDuplicates();
    }
    if (plannedBills.length === 0) duplicateChecked.current = false;
  }, [plannedBills]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800"
      >
        <FileSpreadsheet className="h-4 w-4 mr-1" />
        นำเข้าแบบละเอียด (แยกบิล)
      </Button>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            นำเข้า Excel ขาย แบบละเอียด แยกบิลตามเลขบิล
          </DialogTitle>
          <DialogDescription>
            เลือกไฟล์ Excel รายละเอียดการขาย — ระบบจะแยกบิลตามเลขบิลอัตโนมัติ (รองรับ report09 และ report10)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {plannedBills.length === 0 ? (
            <div className="space-y-3">
              <Label htmlFor="detailed-sell-excel-file">เลือกไฟล์ Excel (.xls/.xlsx)</Label>
              <Input
                id="detailed-sell-excel-file"
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileSelect}
                disabled={loading}
              />
              {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังพาร์สไฟล์...
                </div>
              )}
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                <p className="font-medium mb-1">รูปแบบไฟล์ที่รองรับ:</p>
                <p>• report09: เรียงตามชนิดสินค้า (per-product)</p>
                <p>• report10: เรียงตามผู้ซื้อ (per-buyer) — รองรับทะเบียนรถและหมายเหตุ</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-2 rounded-lg bg-gray-50 border text-center">
                  <p className="text-xs text-gray-500">บิลทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{plannedBills.length}</p>
                </div>
                <div className="p-2 rounded-lg bg-gray-50 border text-center">
                  <p className="text-xs text-gray-500">รายการทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{stats.totalItems}</p>
                </div>
                <div className={`p-2 rounded-lg border text-center ${stats.unmatchedItems > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                  <p className="text-xs text-gray-500">ไม่ตรงสินค้า</p>
                  <p className={`text-lg font-bold ${stats.unmatchedItems > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.unmatchedItems}</p>
                </div>
                <div className={`p-2 rounded-lg border text-center ${stats.duplicates > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                  <p className="text-xs text-gray-500">ซ้ำ</p>
                  <p className={`text-lg font-bold ${stats.duplicates > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.duplicates}</p>
                </div>
              </div>

              {unmatchedProducts.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    สินค้าที่ไม่ตรง — ไม่สามารถนำเข้าได้
                  </div>
                  <div className="space-y-1">
                    {unmatchedProducts.map(p => (
                      <div key={p.name} className="text-xs text-red-600">
                        • {p.name} ({p.count} รายการ)
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.duplicates > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    พบ {stats.duplicates} บิลที่เลขบิลซ้ำกับที่มีอยู่ — จะข้ามบิลซ้ำ
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {plannedBills.map((bill, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${bill.isDuplicate ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900">{bill.externalBillNumber}</span>
                        {bill.isDuplicate && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px]">ซ้ำ</Badge>
                        )}
                        {bill.items.every(i => i.matched) && !bill.isDuplicate && (
                          <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px]">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />พร้อม
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">{bill.date}</span>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">ผู้ซื้อ: {bill.buyer}{bill.licensePlate ? ` | ทะเบียน: ${bill.licensePlate}` : ''}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <span className="text-gray-500">รายการ: <span className="font-medium text-gray-900">{bill.items.length}</span></span>
                      <span className="text-gray-500">น้ำหนัก: <span className="font-medium text-gray-900">{formatWeight(bill.totalWeight)} กก.</span></span>
                      <span className="text-gray-500">ยอด: <span className="font-medium text-gray-900">{formatBaht(bill.totalAmount)} บาท</span></span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {bill.items.map((item, iIdx) => (
                        <div key={iIdx} className="flex justify-between text-[11px]">
                          <span className={item.matched ? 'text-gray-600' : 'text-red-500'}>
                            {!item.matched && '⚠ '}{item.productName}
                          </span>
                          <span className="text-gray-500">
                            {formatWeight(item.weight)} กก. @ {formatBaht(item.pricePerKg)} = {formatBaht(item.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">ยกเลิก</Button>
          </DialogClose>
          {plannedBills.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={!canImport}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {importing ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังนำเข้า...</>
              ) : (
                <>นำเข้า {plannedBills.filter(b => !b.isDuplicate).length} บิล</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
