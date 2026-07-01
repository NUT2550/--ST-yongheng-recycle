'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { fetchProducts, createStockTransfer } from '@/lib/api';
import {
  formatBaht,
  formatWeight,
  getCurrentDateForInput,
  calculateCartWeight,
} from '@/lib/helpers';
import { Product, TransferCartItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import { PackageOpen, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression, previewWeightValue, formulaHint } from '@/lib/safe-math';

export function TransferPage() {
  const {
    transferCartItems,
    transferSourceProductId,
    transferSourceWeight,
    transferWeighedTotal,
    setTransferSourceProduct,
    setTransferSourceWeight,
    setTransferWeighedTotal,
    addTransferCartItem,
    removeTransferCartItem,
    clearTransferCart,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [itemWeight, setItemWeight] = useState<string>('');
  const [sourceWeightInput, setSourceWeightInput] = useState<string>('');
  const [weighedTotalInput, setWeighedTotalInput] = useState<string>('');
  const [isWaste, setIsWaste] = useState(false);
  const [dateTime, setDateTime] = useState<string>(getCurrentDateForInput());
  const [note, setNote] = useState<string>('');

  // Fetch products on mount
  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetchProducts();
        const data = res as unknown as { products: Product[] };
        setProducts(data.products || (res as unknown as Product[]));
      } catch {
        toast.error('ไม่สามารถโหลดข้อมูลสินค้าได้');
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, []);

  // Group ALL products by category (no category restriction — all products allowed)
  const groupedProducts = useMemo(() => {
    const groups: Record<string, { category: Product['category']; products: Product[] }> = {};
    for (const product of products) {
      const catId = product.category.id;
      if (!groups[catId]) {
        groups[catId] = { category: product.category, products: [] };
      }
      groups[catId].products.push(product);
    }
    return Object.values(groups).sort(
      (a, b) => a.category.sortOrder - b.category.sortOrder
    );
  }, [products]);

  const groupedProductsForCombobox = useMemo((): ProductComboboxGroup[] => {
    return groupedProducts.map((group) => ({
      categoryId: group.category.id,
      categoryName: group.category.name,
      products: group.products,
    }));
  }, [groupedProducts]);

  // Source product details
  const sourceProduct = useMemo(
    () => products.find((p) => p.id === transferSourceProductId),
    [products, transferSourceProductId]
  );

  // Source available stock
  const sourceAvailableWeight = useMemo(
    () => sourceProduct?.stock?.totalWeight ?? 0,
    [sourceProduct]
  );
  const sourceCostPerKg = useMemo(
    () => sourceProduct?.stock?.avgCostPerKg ?? 0,
    [sourceProduct]
  );

  // Total output weight
  const totalOutputWeight = useMemo(
    () => calculateCartWeight(transferCartItems),
    [transferCartItems]
  );

  // Loss calculation
  const lossWeight = useMemo(
    () => Math.round((transferSourceWeight - totalOutputWeight) * 100) / 100,
    [transferSourceWeight, totalOutputWeight]
  );

  const lossCost = useMemo(
    () => Math.round(lossWeight * sourceCostPerKg * 100) / 100,
    [lossWeight, sourceCostPerKg]
  );

  // Add item to cart
  const handleAddItem = () => {
    if (!selectedProductId) {
      toast.error('กรุณาเลือกสินค้า output');
      return;
    }
    if (!transferSourceProductId) {
      toast.error('กรุณาเลือกสินค้าต้นทางก่อน');
      return;
    }
    if (selectedProductId === transferSourceProductId && !isWaste) {
      toast.error('สินค้า output ต้องไม่เหมือนสินค้าต้นทาง (เลือกเศษ ถ้าเป็นขยะ)');
      return;
    }
    const weightResult = parseWeightExpression(itemWeight);
    if (weightResult.error) {
      toast.error(`น้ำหนัก: ${weightResult.error}`);
      return;
    }
    const w = weightResult.value;
    if (!w || w <= 0) {
      toast.error('กรุณากรอกน้ำหนัก');
      return;
    }

    const selectedProd = products.find((p) => p.id === selectedProductId);
    const item: TransferCartItem = {
      productId: selectedProductId,
      productName: selectedProd?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      isWaste,
    };

    addTransferCartItem(item);
    setSelectedProductId('');
    setItemWeight('');
    setIsWaste(false);
    const formulaHintStr = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงรายการแล้ว${formulaHintStr}`);
  };

  // Submit bill
  const handleSubmit = async () => {
    if (!transferSourceProductId) {
      toast.error('กรุณาเลือกสินค้าต้นทาง');
      return;
    }
    if (transferCartItems.length === 0) {
      toast.error('กรุณาเพิ่มรายการ output');
      return;
    }
    if (transferSourceWeight <= 0) {
      toast.error('กรุณากรอกน้ำหนักต้นทาง');
      return;
    }
    // HARD RULE: output total must not exceed source
    if (totalOutputWeight > transferSourceWeight + 0.01) {
      toast.error(
        `น้ำหนัก output รวม (${formatWeight(totalOutputWeight)}) เกินน้ำหนักต้นทาง (${formatWeight(transferSourceWeight)})`
      );
      return;
    }
    // Source stock check
    if (sourceAvailableWeight > 0 && transferSourceWeight > sourceAvailableWeight) {
      toast.error(
        `สต็อกไม่เพียงพอ! มี ${formatWeight(sourceAvailableWeight)}, ต้องการ ${formatWeight(transferSourceWeight)}`
      );
      return;
    }

    setSubmitting(true);
    try {
      const sourceWeightResult = parseWeightExpression(sourceWeightInput);
      const sourceWeightExpression = sourceWeightResult.isFormula ? sourceWeightResult.expression : undefined;
      const weighedTotalResult = parseWeightExpression(weighedTotalInput);
      const weighedTotalExpression = weighedTotalResult.isFormula ? weighedTotalResult.expression : undefined;

      const result = await createStockTransfer({
        date: new Date(dateTime).toISOString(),
        sourceProductId: transferSourceProductId,
        sourceWeight: transferSourceWeight,
        sourceWeightExpression,
        weighedTotal: transferWeighedTotal,
        weighedTotalExpression,
        note: note || undefined,
        items: transferCartItems.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          isWaste: item.isWaste,
        })),
      });

      const billData = result as unknown as {
        bill?: { lossWeight: number; lossCost: number; sourceCostPerKg: number };
      };
      const bill = billData.bill ?? (result as unknown as { lossWeight: number; lossCost: number; sourceCostPerKg: number });

      clearTransferCart();
      setSourceWeightInput('');
      setWeighedTotalInput('');
      setDateTime(getCurrentDateForInput());
      setNote('');

      toast.success(
        `บันทึกใบย้ายสต็อกสำเร็จ! สูญเสีย ${formatWeight(bill?.lossWeight ?? lossWeight)} (${formatBaht(bill?.lossCost ?? lossCost)} บาท)`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`บันทึกไม่สำเร็จ: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
          <span className="ml-2 text-gray-500">กำลังโหลดข้อมูล...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">แกะของ / ย้ายสต็อก</h2>
          <p className="text-gray-500 mt-1">แกะสินค้าต้นทางออกเป็นสินค้าย่อย (ไม่มีโบนัสพนักงาน)</p>
        </div>
        {transferCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-cyan-100 text-cyan-700">
            <PackageOpen className="h-3.5 w-3.5 mr-1" />
            {transferCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Source Selection */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">สินค้าต้นทาง (ที่จะแกะ/ย้าย)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Source Product — ALL products */}
            <div className="space-y-2">
              <Label htmlFor="transfer-source">เลือกสินค้าต้นทาง</Label>
              <ProductCombobox
                groups={groupedProductsForCombobox}
                value={transferSourceProductId}
                onValueChange={setTransferSourceProduct}
                placeholder="เลือกสินค้าต้นทาง"
                searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                id="transfer-source"
                renderLabel={(product) => `${product.name} (สต็อก ${formatWeight(product.stock?.totalWeight ?? 0)})`}
                onSelect={() => document.getElementById('transfer-source-weight')?.focus()}
              />
              {sourceProduct && (
                <p className="text-xs text-gray-500">
                  สต็อก: {formatWeight(sourceAvailableWeight)} · ต้นทุนเฉลี่ย {formatBaht(sourceCostPerKg)}/กก.
                </p>
              )}
            </div>

            {/* Source Weight */}
            <div className="space-y-2">
              <Label htmlFor="transfer-source-weight">น้ำหนักต้นทาง (กก.)</Label>
              <Input
                id="transfer-source-weight"
                type="text"
                inputMode="decimal"
                placeholder="0.00 หรือ 100-0.5"
                value={sourceWeightInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setSourceWeightInput(v);
                  const result = parseWeightExpression(v);
                  setTransferSourceWeight(result.error ? 0 : result.value);
                }}
              />
              {sourceWeightInput && (
                <p className="text-xs text-gray-500">
                  {previewWeightValue(sourceWeightInput) ? `= ${previewWeightValue(sourceWeightInput)} กก.` : formulaHint(sourceWeightInput)}
                </p>
              )}
            </div>

            {/* Weighed total (optional cross-check) */}
            <div className="space-y-2">
              <Label htmlFor="transfer-weighed-total">น้ำหนักชั่งรวม (กก.) <span className="text-gray-400 font-normal">(ถ้ามี)</span></Label>
              <Input
                id="transfer-weighed-total"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={weighedTotalInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setWeighedTotalInput(v);
                  const result = parseWeightExpression(v);
                  setTransferWeighedTotal(result.error ? 0 : result.value);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Output Item */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">เพิ่มสินค้า output</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {/* Output product — ALL products */}
            <div className="space-y-2">
              <Label htmlFor="transfer-output">สินค้า output</Label>
              <ProductCombobox
                groups={groupedProductsForCombobox}
                value={selectedProductId}
                onValueChange={setSelectedProductId}
                placeholder="เลือกสินค้า"
                searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                id="transfer-output"
                renderLabel={(product) => product.name}
              />
            </div>

            {/* Weight */}
            <div className="space-y-2">
              <Label htmlFor="transfer-item-weight">น้ำหนัก (กก.)</Label>
              <Input
                id="transfer-item-weight"
                type="text"
                inputMode="decimal"
                placeholder="0.00 หรือ 20-0.1"
                value={itemWeight}
                onChange={(e) => setItemWeight(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
              />
              {itemWeight && (
                <p className="text-xs text-gray-500">
                  {previewWeightValue(itemWeight) ? `= ${previewWeightValue(itemWeight)} กก.` : formulaHint(itemWeight)}
                </p>
              )}
            </div>

            {/* Waste checkbox */}
            <div className="flex items-center space-x-2 pb-2">
              <Checkbox
                id="transfer-is-waste"
                checked={isWaste}
                onCheckedChange={(v) => setIsWaste(v === true)}
              />
              <Label htmlFor="transfer-is-waste" className="text-sm cursor-pointer">
                เศษ/ขยะ (ไม่สร้างสต็อก)
              </Label>
            </div>

            {/* Add button */}
            <Button onClick={handleAddItem} className="w-full">
              <Plus className="h-4 w-4 mr-1" />
              เพิ่ม
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cart + Summary */}
      {transferCartItems.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Items list */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">รายการ output</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clearTransferCart()}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  ล้างทั้งหมด
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {transferCartItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded-md bg-gray-50 border"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {item.productName}
                      </span>
                      {item.isWaste && (
                        <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0">
                          เศษ
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatWeight(item.weight)} กก.
                      {item.weightExpression && (
                        <span className="ml-1 text-gray-400">({formulaHint(item.weightExpression)})</span>
                      )}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTransferCartItem(index)}
                    className="text-red-600 hover:text-red-700 h-8 w-8 p-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Summary + Submit */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">สรุป</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนักต้นทาง</span>
                <span className="font-medium">{formatWeight(transferSourceWeight)} กก.</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนัก output รวม</span>
                <span className="font-medium">{formatWeight(totalOutputWeight)} กก.</span>
              </div>
              <Separator />
              {lossWeight > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="text-red-600">สูญเสีย</span>
                  <span className="font-medium text-red-600">
                    {formatWeight(lossWeight)} กก. ({formatBaht(lossCost)} บาท)
                  </span>
                </div>
              ) : lossWeight < 0 ? (
                <div className="flex justify-between text-sm p-2 rounded bg-red-50 border border-red-200">
                  <span className="text-red-700 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    output เกินต้นทาง!
                  </span>
                  <span className="font-bold text-red-700">
                    +{formatWeight(Math.abs(lossWeight))} กก.
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">สูญเสีย</span>
                  <span className="font-medium text-green-600">0.00 กก.</span>
                </div>
              )}
              {sourceCostPerKg > 0 && (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>ต้นทุนต้นทาง/กก.</span>
                  <span>{formatBaht(sourceCostPerKg)}</span>
                </div>
              )}

              {/* Note */}
              <div className="space-y-1">
                <Label htmlFor="transfer-note" className="text-xs">หมายเหตุ</Label>
                <Input
                  id="transfer-note"
                  placeholder="หมายเหตุ (ถ้ามี)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="text-sm"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting || lossWeight < 0 || transferSourceWeight <= 0}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><PackageOpen className="h-4 w-4 mr-1" /> บันทึกใบย้ายสต็อก</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-gray-400 text-sm">
            <PackageOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
            เลือกสินค้าต้นทางและเพิ่มรายการ output เพื่อเริ่ม
          </CardContent>
        </Card>
      )}
    </div>
  );
}
