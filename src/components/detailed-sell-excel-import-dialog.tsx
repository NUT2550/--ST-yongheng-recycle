'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Product, SellCartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { getAuthToken } from '@/lib/api';
import * as XLSX from 'xlsx';
import {
  normalizeBillNumber,
  categorizeBillsForPreview,
  countByCategory,
  shouldEnableApply,
  type ParsedBill,
  type ParsedBillItem,
  type ImportSummary,
  type PreviewCategory,
} from '@/lib/import-pipeline';

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
  isInFileDuplicate?: boolean;
}

interface DetailedSellExcelImportDialogProps {
  products: Product[];
  /** Legacy callback — kept for backward compat. Called with empty array after apply. */
  onImport?: (bills: Array<{
    externalBillNumber: string;
    date: string;
    buyer: string;
    note: string;
    items: SellCartItem[];
  }>) => void;
  /** ST-8: New callback — fired after /api/import/apply completes (success or partial). */
  onApplied?: (summary: ImportSummary) => void;
}

export function DetailedSellExcelImportDialog({ products, onImport, onApplied }: DetailedSellExcelImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedSellBill[]>([]);
  const [fileName, setFileName] = useState('');
  const [existingDuplicates, setExistingDuplicates] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      m.set(p.name.trim().normalize('NFC'), p);
    }
    return m;
  }, [products]);

  // ST-8: Stock map for FIFO pre-check (productId → available weight)
  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      m.set(p.id, p.stock?.totalWeight ?? 0);
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
    setApplyResult(null);
    setExistingDuplicates(new Set());
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

          // Bill header row: col 1 = date, col 2 = bill number, col 3 = license plate, col 4 = note
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

          // Item row: col 2 = product code, col 3 = product name, col 9 = weight, col 11 = price, col 12 = amount
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
        for (let i = 4; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(c => c === null || c === undefined)) continue;

          if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue;
          if (fixThaiText(String(r[12] || '')).includes('report09') || fixThaiText(String(r[0] || '')).match(/^หน้าที่/)) continue;

          if (r[0] && /^\d{4}$/.test(String(r[0]).trim()) && r[1] && typeof r[1] === 'string' && r[9] != null) {
            currentProductName = fixThaiText(String(r[1])).trim();
            continue;
          }

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

  // ST-8: Batch duplicate check via /api/import/check-duplicates
  const checkDuplicatesBatch = async () => {
    if (plannedBills.length === 0) return;
    try {
      const token = getAuthToken();
      if (!token) {
        toast.warning('ไม่สามารถตรวจบิลซ้ำได้ — กรุณา Login ใหม่');
        return;
      }
      const billNumbers = plannedBills.map(b => b.externalBillNumber);
      const res = await fetch('/api/import/check-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ billNumbers, type: 'sales' }),
      });
      if (res.status === 401) {
        toast.warning('เซสชันหมดอายุ — กรุณา Login ใหม่เพื่อตรวจบิลซ้ำ');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const existingSet = new Set<string>((data.existing || []) as string[]);
        setExistingDuplicates(existingSet);
        setPlannedBills(prev =>
          prev.map(b => ({
            ...b,
            isDuplicate: existingSet.has(normalizeBillNumber(b.externalBillNumber)),
          }))
        );
      }
    } catch {
      // non-fatal
    }
  };

  // ST-8: Compute bills with insufficient stock (sales-only).
  // Returns set of normalized bill numbers where any matched item's requested
  // weight exceeds available stock.
  const insufficientStockSet = useMemo(() => {
    const s = new Set<string>();
    for (const bill of plannedBills) {
      // Aggregate requested weight per product within this bill
      const perProduct = new Map<string, number>();
      let hasUnmatched = false;
      for (const item of bill.items) {
        if (!item.matched || !item.productId) {
          hasUnmatched = true;
          continue;
        }
        perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + item.weight);
      }
      // If any matched item has insufficient stock, flag the bill
      let insufficient = false;
      for (const [productId, requested] of perProduct) {
        const available = stockMap.get(productId) ?? 0;
        if (requested > available) {
          insufficient = true;
          break;
        }
      }
      if (insufficient && !hasUnmatched) {
        // Only flag as insufficient-stock if all items are matched
        // (otherwise it'll be classified as unmatched instead)
        const norm = normalizeBillNumber(bill.externalBillNumber);
        if (norm !== '') s.add(norm);
      }
    }
    return s;
  }, [plannedBills, stockMap]);

  // ST-8: Preview rows categorized for display
  const previewRows = useMemo(() => {
    const parsedBills: ParsedBill[] = plannedBills.map(b => ({
      externalBillNumber: b.externalBillNumber,
      date: parseThaiDate(b.date),
      note: b.note,
      items: b.items.map(it => ({
        productId: it.productId || '',
        productName: it.productName,
        productCode: it.productCode,
        weight: it.weight,
        pricePerKg: it.pricePerKg,
        totalAmount: it.amount,
        matched: it.matched,
      })),
    }));
    return categorizeBillsForPreview(parsedBills, existingDuplicates, insufficientStockSet);
  }, [plannedBills, existingDuplicates, insufficientStockSet]);

  const categoryCounts = useMemo(() => countByCategory(previewRows), [previewRows]);

  const canImport = shouldEnableApply(
    categoryCounts.ready,
    importing,
    loading
  );

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setApplyResult(null);
    try {
      const token = getAuthToken();
      if (!token) {
        toast.error('ไม่ได้เข้าสู่ระบบ — กรุณา Login ใหม่');
        setImporting(false);
        return;
      }

      const readyIndices = new Set(
        previewRows.filter(r => r.category === 'ready').map(r => r.index)
      );
      const billsToApply: ParsedBill[] = plannedBills
        .map((b, idx) => ({ b, idx }))
        .filter(({ idx }) => readyIndices.has(idx))
        .map(({ b }) => ({
          externalBillNumber: b.externalBillNumber,
          date: parseThaiDate(b.date),
          buyer: b.buyer,
          buyerCode: b.buyerCode,
          licensePlate: b.licensePlate,
          note: `ผู้ซื้อ: ${b.buyer}${b.licensePlate ? ` | ทะเบียน: ${b.licensePlate}` : ''}${b.note ? ` | ${b.note}` : ''} | นำเข้าจาก: ${fileName}`,
          items: b.items
            .filter(i => i.matched && i.productId)
            .map((i): ParsedBillItem => ({
              productId: i.productId!,
              productName: i.productName,
              productCode: i.productCode,
              weight: i.weight,
              pricePerKg: i.pricePerKg,
              totalAmount: i.amount,
              matched: true,
            })),
        }));

      if (billsToApply.length === 0) {
        toast.warning('ไม่มีบิลพร้อมนำเข้า');
        setImporting(false);
        return;
      }

      const res = await fetch('/api/import/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'sales', bills: billsToApply }),
      });

      if (res.status === 401) {
        toast.error('เซสชันหมดอายุ — กรุณา Login ใหม่');
        setImporting(false);
        return;
      }
      if (res.status === 403) {
        toast.error('ไม่มีสิทธิ์นำเข้าบิลขาย');
        setImporting(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`นำเข้าไม่สำเร็จ: ${data.error || res.statusText}`);
        setImporting(false);
        return;
      }

      const summary = (await res.json()) as ImportSummary;
      setApplyResult(summary);

      const parts: string[] = [`นำเข้าสำเร็จ ${summary.importedCount} บิล`];
      if (summary.duplicateExistingCount > 0) parts.push(`ข้ามซ้ำ ${summary.duplicateExistingCount}`);
      if (summary.duplicateInFileCount > 0) parts.push(`ซ้ำในไฟล์ ${summary.duplicateInFileCount}`);
      if (summary.insufficientStockCount > 0) parts.push(`สต็อกไม่พอ ${summary.insufficientStockCount}`);
      if (summary.failedCount > 0) parts.push(`ล้มเหลว ${summary.failedCount}`);
      if (summary.importedCount > 0) {
        toast.success(parts.join(' · '));
      } else {
        toast.warning(parts.join(' · '));
      }

      onImport?.([]);
      onApplied?.(summary);

      setTimeout(() => {
        checkDuplicatesBatch();
      }, 100);
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
      setApplyResult(null);
      setExistingDuplicates(new Set());
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const duplicateChecked = useRef(false);
  useEffect(() => {
    if (plannedBills.length > 0 && !duplicateChecked.current) {
      duplicateChecked.current = true;
      checkDuplicatesBatch();
    }
    if (plannedBills.length === 0) duplicateChecked.current = false;
  }, [plannedBills]);

  function getCategoryForBill(idx: number): PreviewCategory | null {
    const row = previewRows.find(r => r.index === idx);
    return row?.category ?? null;
  }

  const categoryBadge: Record<PreviewCategory, { label: string; className: string }> = {
    ready: { label: 'พร้อม', className: 'bg-green-100 text-green-700' },
    'duplicate-existing': { label: 'ซ้ำในระบบ', className: 'bg-amber-100 text-amber-700' },
    'duplicate-in-file': { label: 'ซ้ำในไฟล์', className: 'bg-orange-100 text-orange-700' },
    invalid: { label: 'ไม่ถูกต้อง', className: 'bg-red-100 text-red-700' },
    unmatched: { label: 'สินค้าไม่ตรง', className: 'bg-red-100 text-red-700' },
    'insufficient-stock': { label: 'สต็อกไม่พอ', className: 'bg-red-100 text-red-700' },
  };

  const duplicateBillNumbers = useMemo(() => {
    const list: Array<{ number: string; kind: 'existing' | 'in-file' }> = [];
    for (const row of previewRows) {
      if (row.category === 'duplicate-existing') {
        list.push({ number: row.externalBillNumber, kind: 'existing' });
      } else if (row.category === 'duplicate-in-file') {
        list.push({ number: row.externalBillNumber, kind: 'in-file' });
      }
    }
    return list;
  }, [previewRows]);

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
            เลือกไฟล์ Excel รายละเอียดการขาย — ระบบจะแยกบิลตามเลขบิลอัตโนมัติ — บิลซ้ำ/สต็อกไม่พอจะถูกข้าม (ไม่บล็อกการนำเข้า)
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
                <p className="mt-1 font-medium text-amber-700">ST-8: บิลซ้ำ/สต็อกไม่พอจะถูกข้าม ไม่บล็อกการนำเข้า</p>
              </div>
            </div>
          ) : (
            <>
              {/* ST-8: Summary stats — partial success categories (sales includes insufficient-stock) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
                <div className="p-2 rounded-lg bg-gray-50 border text-center">
                  <p className="text-xs text-gray-500">ทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{plannedBills.length}</p>
                </div>
                <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-center">
                  <p className="text-xs text-green-600">พร้อม</p>
                  <p className="text-lg font-bold text-green-700">{categoryCounts.ready}</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-center">
                  <p className="text-xs text-amber-600">ซ้ำในระบบ</p>
                  <p className="text-lg font-bold text-amber-700">{categoryCounts['duplicate-existing']}</p>
                </div>
                <div className="p-2 rounded-lg bg-orange-50 border border-orange-200 text-center">
                  <p className="text-xs text-orange-600">ซ้ำในไฟล์</p>
                  <p className="text-lg font-bold text-orange-700">{categoryCounts['duplicate-in-file']}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                  <p className="text-xs text-red-600">สต็อกไม่พอ</p>
                  <p className="text-lg font-bold text-red-700">{categoryCounts['insufficient-stock']}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                  <p className="text-xs text-red-600">สินค้าไม่ตรง</p>
                  <p className="text-lg font-bold text-red-700">{categoryCounts.unmatched}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                  <p className="text-xs text-red-600">ไม่ถูกต้อง</p>
                  <p className="text-lg font-bold text-red-700">{categoryCounts.invalid}</p>
                </div>
              </div>

              {/* ST-8: Apply result panel */}
              {applyResult && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="flex items-center gap-2 text-blue-700 font-medium text-sm mb-2">
                    <CheckCircle2 className="h-4 w-4" />
                    ผลการนำเข้า
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">นำเข้าสำเร็จ</p>
                      <p className="text-base font-bold text-green-700">{applyResult.importedCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ข้าม (ซ้ำในระบบ)</p>
                      <p className="text-base font-bold text-amber-700">{applyResult.duplicateExistingCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ข้าม (ซ้ำในไฟล์)</p>
                      <p className="text-base font-bold text-orange-700">{applyResult.duplicateInFileCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">สต็อกไม่พอ</p>
                      <p className="text-base font-bold text-red-700">{applyResult.insufficientStockCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ล้มเหลว</p>
                      <p className="text-base font-bold text-red-700">{applyResult.failedCount}</p>
                    </div>
                  </div>
                  {applyResult.failedBills.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      <p className="font-medium">บิลที่ล้มเหลว:</p>
                      <div className="max-h-24 overflow-y-auto mt-1 space-y-0.5">
                        {applyResult.failedBills.map((b, i) => (
                          <div key={i}>• {b.externalBillNumber}: {b.error || b.status}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ST-8: Duplicate bill numbers — visible list */}
              {duplicateBillNumbers.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-2 text-amber-700 font-medium text-sm mb-2">
                    <Copy className="h-4 w-4" />
                    เลขบิลซ้ำ ({duplicateBillNumbers.length}) — จะถูกข้าม
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {duplicateBillNumbers.map((d, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className={
                          d.kind === 'existing'
                            ? 'bg-amber-100 text-amber-700 text-[10px]'
                            : 'bg-orange-100 text-orange-700 text-[10px]'
                        }
                      >
                        {d.number}
                        {d.kind === 'existing' ? ' (ในระบบ)' : ' (ในไฟล์)'}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Insufficient stock warning */}
              {categoryCounts['insufficient-stock'] > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    บิลที่สต็อกไม่เพียงพอ — จะถูกข้าม
                  </div>
                  <div className="space-y-1">
                    {plannedBills.map((b, idx) => {
                      if (getCategoryForBill(idx) !== 'insufficient-stock') return null;
                      const issues: string[] = [];
                      const perProduct = new Map<string, { name: string; requested: number; available: number }>();
                      for (const item of b.items) {
                        if (!item.matched || !item.productId) continue;
                        const existing = perProduct.get(item.productId);
                        const available = stockMap.get(item.productId) ?? 0;
                        if (existing) {
                          existing.requested += item.weight;
                        } else {
                          perProduct.set(item.productId, {
                            name: item.productName,
                            requested: item.weight,
                            available,
                          });
                        }
                      }
                      for (const v of perProduct.values()) {
                        if (v.requested > v.available) {
                          issues.push(`${v.name}: ต้องการ ${formatWeight(v.requested)} กก. มี ${formatWeight(v.available)} กก.`);
                        }
                      }
                      return (
                        <div key={idx} className="text-xs text-red-600">
                          • {b.externalBillNumber}: {issues.join('; ')}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Unmatched products warning */}
              {categoryCounts.unmatched > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    สินค้าที่ไม่ตรง — บิลเหล่านี้จะถูกข้าม
                  </div>
                  <div className="space-y-1">
                    {Array.from(new Set(
                      plannedBills
                        .flatMap((b, idx) =>
                          getCategoryForBill(idx) === 'unmatched'
                            ? b.items.filter(i => !i.matched).map(i => i.productName)
                            : []
                        )
                    )).map(name => (
                      <div key={name} className="text-xs text-red-600">• {name}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Planned bills list */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {plannedBills.map((bill, idx) => {
                  const cat = getCategoryForBill(idx);
                  const isDup = cat === 'duplicate-existing' || cat === 'duplicate-in-file';
                  const isBlocked = cat === 'invalid' || cat === 'unmatched' || cat === 'insufficient-stock';
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${
                        isBlocked ? 'border-red-200 bg-red-50/30'
                        : isDup ? 'border-amber-200 bg-amber-50/30'
                        : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-900">{bill.externalBillNumber || '(ไม่มีเลขบิล)'}</span>
                          {cat && (
                            <Badge variant="secondary" className={`text-[10px] ${categoryBadge[cat].className}`}>
                              {categoryBadge[cat].label}
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
                  );
                })}
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
                <>นำเข้า {categoryCounts.ready} บิล</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
