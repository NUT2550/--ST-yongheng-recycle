'use client';

import * as React from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle, X, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import { Product, BuyCartItem } from '@/lib/types';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { toast } from 'sonner';

interface ParsedRow {
  rowIndex: number;
  code: string;
  name: string;
  weight: number;
  totalAmount: number;
  avgPricePerKg: number;
  matchedProductId: string;
  matched: boolean;
}

interface ExcelImportDialogProps {
  products: Product[];
  groupedProducts: ProductComboboxGroup[];
  onImport: (items: BuyCartItem[], billDate?: string | null) => void;
  buttonText?: string;
  dialogTitle?: string;
  billType?: 'buy' | 'sell';
}

function matchProduct(parsedName: string, products: Product[]): string | null {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[(),()[\]]/g, '').toLowerCase().trim();
  const target = norm(parsedName);
  if (!target) return null;
  for (const p of products) { if (norm(p.name) === target) return p.id; }
  for (const p of products) { if (norm(p.name).includes(target)) return p.id; }
  for (const p of products) { if (target.includes(norm(p.name))) return p.id; }
  return null;
}

const PreviewRow = React.memo(function PreviewRow({
  row,
  groupedProducts,
  onProductChange,
}: {
  row: ParsedRow;
  groupedProducts: ProductComboboxGroup[];
  onProductChange: (rowIndex: number, productId: string) => void;
}) {
  return (
    <TableRow key={row.rowIndex} className={row.matched ? '' : 'bg-amber-50'}>
      <TableCell className="font-mono text-xs whitespace-nowrap">{row.code}</TableCell>
      <TableCell className="font-medium whitespace-nowrap">{row.name}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{formatWeight(row.weight)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{formatBaht(row.totalAmount)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{row.avgPricePerKg.toFixed(2)}</TableCell>
      <TableCell className="min-w-[200px]">
        <ProductCombobox
          groups={groupedProducts}
          value={row.matchedProductId}
          onValueChange={(v) => onProductChange(row.rowIndex, v)}
          placeholder="เลือกสินค้า..."
          searchPlaceholder="ค้นหาสินค้า..."
        />
      </TableCell>
      <TableCell className="text-center">
        {row.matched ? (
          <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-500 mx-auto" aria-label="ยังไม่ได้เลือกสินค้า" />
        )}
      </TableCell>
    </TableRow>
  );
});

export function ExcelImportDialog({
  products,
  groupedProducts,
  onImport,
  buttonText = 'นำเข้าจาก Excel',
  dialogTitle = 'นำเข้ารายการรับซื้อจาก Excel',
  billType = 'buy',
}: ExcelImportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  const [rows, setRows] = React.useState<ParsedRow[]>([]);
  const [billDate, setBillDate] = React.useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) { setRows([]); setParsing(false); setBillDate(null); }
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('billType', billType);
      const res = await fetch('/api/excel/parse', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'ไม่สามารถอ่านไฟล์ได้'); setParsing(false); return; }
      setBillDate(data.billDate || null);
      const parsed: ParsedRow[] = (data.rows || []).map((r: Omit<ParsedRow, 'matchedProductId' | 'matched'>) => ({
        ...r, matchedProductId: '', matched: false,
      }));
      if (parsed.length === 0) { toast.error('ไม่พบรายการสินค้าในไฟล์'); setParsing(false); return; }
      for (const r of parsed) {
        const matchedId = matchProduct(r.name, products);
        r.matchedProductId = matchedId || '';
        r.matched = !!matchedId;
      }
      setRows(parsed);
      const matchedCount = parsed.filter((r) => r.matched).length;
      toast.success(`อ่านไฟล์สำเร็จ: ${parsed.length} รายการ (แม่นตรง ${matchedCount})`);
    } catch (e) {
      toast.error('ไม่สามารถอ่านไฟล์ได้: ' + (e instanceof Error ? e.message : 'unknown'));
    } finally { setParsing(false); }
  };

  const handleProductChange = React.useCallback((rowIndex: number, productId: string) => {
    setRows((prev) => prev.map((r) => r.rowIndex === rowIndex ? { ...r, matchedProductId: productId, matched: !!productId } : r));
  }, []);

  const matchedCount = rows.filter((r) => r.matched).length;
  const totalWeight = rows.filter((r) => r.matched).reduce((sum, r) => sum + r.weight, 0);
  const totalAmount = rows.filter((r) => r.matched).reduce((sum, r) => sum + r.totalAmount, 0);

  const handleImport = () => {
    const matched = rows.filter((r) => r.matched && r.matchedProductId);
    if (matched.length === 0) { toast.error('ไม่มีรายการที่แม่นตรง'); return; }
    const items: BuyCartItem[] = matched.map((r) => {
      const product = products.find((p) => p.id === r.matchedProductId)!;
      const pricePerKg = r.avgPricePerKg > 0 ? r.avgPricePerKg : 0;
      return {
        productId: product.id, productName: product.name,
        weight: r.weight, pricePerKg,
        totalAmount: r.totalAmount > 0 ? r.totalAmount : Math.round(r.weight * pricePerKg * 100) / 100,
      };
    });
    onImport(items, billDate);
    toast.success(`เพิ่ม ${items.length} รายการในตะกร้าแล้ว`);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          {buttonText}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] lg:max-w-[96vw] xl:max-w-[96vw] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden p-4 sm:p-6"
        aria-describedby="excel-import-desc"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription id="excel-import-desc">
            อัปโหลดไฟล์ .xls หรือ .xlsx ที่มีรหัสสินค้า 4 หลัก ชื่อสินค้า จำนวน และรวมเงิน
            ระบบจะแม่นตรงสินค้าในระบบให้อัตโนมัติ — คุณสามารถแก้ไขการแมพได้ก่อนเพิ่มในตะกร้า
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 min-h-0">
            <div className="text-center space-y-4 max-w-md">
              <div className="mx-auto p-4 rounded-full bg-green-50 w-fit">
                <FileSpreadsheet className="h-10 w-10 text-green-600" />
              </div>
              <div>
                <p className="font-medium">เลือกไฟล์ Excel</p>
                <p className="text-sm text-muted-foreground mt-1">
                  รองรับ .xls (Thai/TIS-620) และ .xlsx — ระบบจะอ่าน sheet แรก
                </p>
              </div>
              <div className="relative">
                <Input
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  className="cursor-pointer"
                  disabled={parsing}
                />
              </div>
              {parsing && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังอ่านไฟล์...
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-3 px-1 py-2 border-b">
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                แม่นตรง {matchedCount}/{rows.length}
              </Badge>
              <Badge variant="outline">น้ำหนักรวม: {formatWeight(totalWeight)}</Badge>
              <Badge variant="outline">ยอดรวม: {formatBaht(totalAmount)}</Badge>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRows([])}>
                <X className="h-4 w-4 mr-1" />
                เลือกไฟล์ใหม่
              </Button>
            </div>

            <div className="flex-1 min-h-0 border rounded-md overflow-auto">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow>
                    <TableHead className="w-16 whitespace-nowrap">รหัส</TableHead>
                    <TableHead className="w-[200px] whitespace-nowrap">ชื่อใน Excel</TableHead>
                    <TableHead className="w-24 text-right whitespace-nowrap">น้ำหนัก</TableHead>
                    <TableHead className="w-28 text-right whitespace-nowrap">รวมเงิน</TableHead>
                    <TableHead className="w-24 text-right whitespace-nowrap">ราคา/กก.</TableHead>
                    <TableHead className="w-[280px] whitespace-nowrap">เลือกสินค้าในระบบ</TableHead>
                    <TableHead className="w-12 text-center whitespace-nowrap">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <PreviewRow key={r.rowIndex} row={r} groupedProducts={groupedProducts} onProductChange={handleProductChange} />
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="shrink-0 border-t pt-4 bg-white">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>ยกเลิก</Button>
              <Button onClick={handleImport} disabled={matchedCount === 0}>
                <Upload className="h-4 w-4 mr-2" />
                เพิ่ม {matchedCount} รายการในตะกร้า
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
