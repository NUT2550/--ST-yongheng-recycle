'use client';

import { useState, useRef, useMemo } from 'react';
import { Product, BuyCartItem } from '@/lib/types';
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
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { getAuthToken } from '@/lib/api';
import * as XLSX from 'xlsx';

export interface PlannedBill {
  externalBillNumber: string;
  seller: string;
  date: string; // raw date string from Excel e.g. "1/7/2569"
  note: string;
  items: Array<{
    productName: string;
    productCode: string;
    productId: string | null; // null = unmatched
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

interface DetailedExcelImportDialogProps {
  products: Product[];
  onImport: (bills: Array<{
    externalBillNumber: string;
    date: string;
    note: string;
    items: BuyCartItem[];
  }>) => void;
}

export function DetailedExcelImportDialog({ products, onImport }: DetailedExcelImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedBill[]>([]);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build product lookup map: exact name → product
  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      m.set(p.name.trim(), p);
    }
    return m;
  }, [products]);

  // Safe aliases: map common Excel name variants to canonical product names
  // Only within the same material category — no cross-category guessing.
  const safeAliases: Record<string, string> = {
    'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมีเนียมแข็ง',
    'อลูมิเนียมฝาแกะ': 'ฝาอลูมีเนียมเนียม',
    'ถัง 15ถึง200 ลิตร': 'เหล็กคละ',
  };

  function matchProduct(excelName: string): Product | null {
    const trimmed = excelName.trim();
    // 1. Exact match
    if (productMap.has(trimmed)) return productMap.get(trimmed)!;
    // 2. Safe alias
    const alias = safeAliases[trimmed];
    if (alias && productMap.has(alias)) return productMap.get(alias)!;
    // 3. Try contains match (single result only — no ambiguity)
    const contains = products.filter(p => p.name.includes(trimmed) || trimmed.includes(p.name));
    if (contains.length === 1) return contains[0];
    return null;
  }

  function parseThaiDate(dateStr: string): string {
    // Parse "1/7/2569" (Thai Buddhist year) → ISO date
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

    setLoading(true);
    setPlannedBills([]);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', codepage: 874 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];

      // Parse the detailed format:
      // Row 3: headers
      // Row 4+: seller summary | bill header | item rows | empty separators
      const bills: PlannedBill[] = [];
      let currentBill: PlannedBill | null = null;
      let currentSeller = '';

      for (let i = 4; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(c => c === null || c === undefined)) continue; // empty row

        // Seller summary row: col 0 has code, col 1 has name
        if (r[0] && r[1] && !r[2] && r[9] == null) {
          currentSeller = String(r[1]);
          continue;
        }

        // Bill header row: col 1 has date, col 2 has bill number, col 12 has total
        if (r[1] && r[2] && String(r[2]).trim().match(/^A\d+/i) && r[12] != null) {
          if (currentBill) bills.push(currentBill);
          currentBill = {
            externalBillNumber: String(r[2]).trim(),
            seller: currentSeller,
            date: String(r[1]).trim(),
            note: r[4] ? String(r[4]).trim() : '',
            items: [],
            totalWeight: 0,
            totalAmount: 0,
            excelTotalAmount: parseFloat(String(r[12])) || 0,
            amountDiff: 0,
            isDuplicate: false,
          };
          continue;
        }

        // Item row: col 2 has product code, col 3 has product name, col 9 has weight
        if (r[2] && r[3] && r[9] != null && currentBill) {
          const productName = String(r[3]).trim();
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
      if (currentBill) bills.push(currentBill);

      // Calculate amount diff and round
      for (const b of bills) {
        b.totalWeight = Math.round(b.totalWeight * 100) / 100;
        b.totalAmount = Math.round(b.totalAmount * 100) / 100;
        b.amountDiff = Math.round((b.totalAmount - b.excelTotalAmount) * 100) / 100;
      }

      setPlannedBills(bills);
      toast.success(`พาร์สไฟล์สำเร็จ: ${bills.length} บิล, ${bills.reduce((s, b) => s + b.items.length, 0)} รายการ`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`พาร์สไฟล์ไม่สำเร็จ: ${message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Check for duplicates by querying existing externalBillNumbers
  const checkDuplicates = async () => {
    const billNumbers = plannedBills.map(b => b.externalBillNumber);
    if (billNumbers.length === 0) return;

    try {
      const token = getAuthToken();
      // Query existing buy bills to check for duplicate externalBillNumbers
      const res = await fetch('/api/buy-bills?page=1&limit=100&includeCancelled=true', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
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

  // Summary stats
  const stats = useMemo(() => {
    const totalItems = plannedBills.reduce((s, b) => s + b.items.length, 0);
    const unmatchedItems = plannedBills.reduce(
      (s, b) => s + b.items.filter(i => !i.matched).length, 0
    );
    const duplicates = plannedBills.filter(b => b.isDuplicate).length;
    const amountMismatches = plannedBills.filter(b => Math.abs(b.amountDiff) > 1).length;
    const hasBlockers = unmatchedItems > 0 || duplicates > 0;
    return { totalItems, unmatchedItems, duplicates, amountMismatches, hasBlockers };
  }, [plannedBills]);

  // Collect all unmatched product names
  const unmatchedProducts = useMemo(() => {
    const set = new Map<string, number>();
    for (const b of plannedBills) {
      for (const it of b.items) {
        if (!it.matched) {
          set.set(it.productName, (set.get(it.productName) || 0) + 1);
        }
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
        note: `ผู้ขาย: ${b.seller}${b.note ? ` | ${b.note}` : ''} | นำเข้าจาก: ${fileName}`,
        items: b.items.filter(i => i.matched).map(i => ({
          productId: i.productId!,
          productName: i.productName,
          weight: i.weight,
          pricePerKg: i.pricePerKg,
          totalAmount: i.amount,
        })) as BuyCartItem[],
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
    }
  };

  // Auto-check duplicates when planned bills change
  const duplicateChecked = useRef(false);
  if (plannedBills.length > 0 && !duplicateChecked.current) {
    duplicateChecked.current = true;
    checkDuplicates();
  }
  if (plannedBills.length === 0) duplicateChecked.current = false;

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
            นำเข้า Excel แบบละเอียด แยกบิลตามเลขบิล
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* File upload */}
          {plannedBills.length === 0 ? (
            <div className="space-y-3">
              <Label htmlFor="detailed-excel-file">เลือกไฟล์ Excel (.xls/.xlsx)</Label>
              <Input
                id="detailed-excel-file"
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
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
                <p>ไฟล์ Excel ที่มีคอลัมน์: ผู้ขาย, เลขบิล, รายการสินค้า, จำนวน, ราคา@, รวมเงิน</p>
                <p>ระบบจะแยกบิลตามเลขบิลอัตโนมัติ — แต่ละเลขบิล = 1 ใบรับซื้อ</p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary stats */}
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

              {/* Unmatched products warning */}
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

              {/* Duplicate warning */}
              {stats.duplicates > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    พบ {stats.duplicates} บิลที่เลขบิลซ้ำกับที่มีอยู่ — จะข้ามบิลซ้ำ
                  </div>
                </div>
              )}

              {/* Planned bills list */}
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
                    <div className="text-xs text-gray-500 mb-1">ผู้ขาย: {bill.seller}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <span className="text-gray-500">รายการ: <span className="font-medium text-gray-900">{bill.items.length}</span></span>
                      <span className="text-gray-500">น้ำหนัก: <span className="font-medium text-gray-900">{formatWeight(bill.totalWeight)} กก.</span></span>
                      <span className="text-gray-500">ยอด: <span className="font-medium text-gray-900">{formatBaht(bill.totalAmount)} บาท</span></span>
                    </div>
                    {Math.abs(bill.amountDiff) > 1 && (
                      <p className="text-[11px] text-amber-600">
                        ⚠ ยอดต่างจาก Excel {bill.excelTotalAmount > 0 ? `(${formatBaht(bill.excelTotalAmount)})` : ''} ไป {formatBaht(Math.abs(bill.amountDiff))} บาท
                      </p>
                    )}
                    {/* Items list */}
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
