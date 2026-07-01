'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { fetchProducts, createSortingBill } from '@/lib/api';
import {
  formatBaht,
  formatWeight,
  getCurrentDateForInput,
  calculateCartWeight,
} from '@/lib/helpers';
import { Product, SortCartItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Plus, Trash2, Loader2, AlertTriangle, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression, previewWeightValue, formulaHint } from '@/lib/safe-math';

export function SortPage() {
  const {
    sortCartItems,
    sortSourceProductId,
    sortSourceWeight,
    sortSourcePricePerKg,
    sortWeighedTotal,
    sortRoomNumber,
    setSortSourceProduct,
    setSortSourceWeight,
    setSortSourcePricePerKg,
    setSortWeighedTotal,
    setSortRoomNumber,
    addSortCartItem,
    removeSortCartItem,
    updateSortCartItem,
    clearSortCart,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [itemWeight, setItemWeight] = useState<string>('');
  const [sourceWeightInput, setSourceWeightInput] = useState<string>('');
  const [weighedTotalInput, setWeighedTotalInput] = useState<string>('');
  const [itemSortedPrice, setItemSortedPrice] = useState<string>('');
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

  // When product selected, auto-fill sorted price with defaultBuyPrice
  useEffect(() => {
    if (selectedProductId) {
      const prod = products.find((p) => p.id === selectedProductId);
      if (prod && prod.defaultBuyPrice > 0) {
        setItemSortedPrice(String(prod.defaultBuyPrice));
      } else {
        setItemSortedPrice('');
      }
    }
  }, [selectedProductId, products]);

  // Group all products by category for sorted items dropdown + source dropdown
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
    () => products.find((p) => p.id === sortSourceProductId),
    [products, sortSourceProductId]
  );

  // Source product cost per kg (avg from stock)
  const sourceCostPerKg = useMemo(
    () => sourceProduct?.stock?.avgCostPerKg ?? 0,
    [sourceProduct]
  );

  // Source available stock
  const sourceAvailableWeight = useMemo(
    () => sourceProduct?.stock?.totalWeight ?? 0,
    [sourceProduct]
  );

  // When source product changes, auto-fill sourcePricePerKg with defaultBuyPrice
  useEffect(() => {
    if (sortSourceProductId && sourceProduct) {
      if (sourceProduct.defaultBuyPrice > 0) {
        setSortSourcePricePerKg(sourceProduct.defaultBuyPrice);
      }
    }
  }, [sortSourceProductId, sourceProduct, setSortSourcePricePerKg]);

  // Total sorted weight
  const totalSortedWeight = useMemo(
    () => calculateCartWeight(sortCartItems),
    [sortCartItems]
  );

  // Loss calculation
  const lossWeight = useMemo(
    () => Math.round((sortSourceWeight - totalSortedWeight) * 100) / 100,
    [sortSourceWeight, totalSortedWeight]
  );

  const lossCost = useMemo(
    () => Math.round(lossWeight * sourceCostPerKg * 100) / 100,
    [lossWeight, sourceCostPerKg]
  );

  // Total sorted cost (non-waste items) - FIFO cost
  const totalSortedCost = useMemo(
    () =>
      sortCartItems.reduce((sum, item) => {
        if (item.isWaste) return sum;
        return sum + Math.round(item.weight * sourceCostPerKg * 100) / 100;
      }, 0),
    [sortCartItems, sourceCostPerKg]
  );

  // Total bonus amount (legacy per-item sum = grossProfit * 10%, no loss deduction)
  const totalBonusAmount = useMemo(
    () =>
      sortCartItems.reduce((sum, item) => sum + item.bonusAmount, 0),
    [sortCartItems]
  );

  // Total gross profit from outputs (before loss deduction)
  const totalGrossProfit = useMemo(
    () =>
      sortCartItems.reduce((sum, item) => {
        if (item.isWaste) return sum;
        return sum + Math.round((item.sortedPricePerKg - sortSourcePricePerKg) * item.weight * 100) / 100;
      }, 0),
    [sortCartItems, sortSourcePricePerKg]
  );

  // Net profit after loss deduction, and final bonus with loss deduction
  const netProfitForBonus = Math.max(totalGrossProfit - lossCost, 0);
  const totalBonusWithLossDeduction = Math.round(netProfitForBonus * 0.1 * 100) / 100;

  // Preview bonus for current item being added
  const previewBonus = useMemo(() => {
    if (isWaste || !itemWeight || !itemSortedPrice || !sortSourcePricePerKg) return 0;
    const weightResult = parseWeightExpression(itemWeight);
    const w = weightResult.error ? 0 : weightResult.value;
    const sp = parseFloat(itemSortedPrice) || 0;
    const grossProfit = (sp - sortSourcePricePerKg) * w;
    return Math.round(grossProfit * 0.1 * 100) / 100;
  }, [isWaste, itemWeight, itemSortedPrice, sortSourcePricePerKg]);

  // Add item to cart
  const handleAddItem = () => {
    if (!selectedProductId) {
      toast.error('กรุณาเลือกสินค้า');
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

    if (!sortSourceProductId) {
      toast.error('กรุณาเลือกสินค้าต้นทางก่อน');
      return;
    }

    if (!sortSourcePricePerKg || sortSourcePricePerKg <= 0) {
      toast.error('กรุณากรอกราคาต้นทาง/กก. ก่อน');
      return;
    }

    const selectedProd = products.find((p) => p.id === selectedProductId);
    const sortedPrice = isWaste ? 0 : (parseFloat(itemSortedPrice) || 0);

    // Calculate bonus for this item
    let bonusAmount = 0;
    if (!isWaste && sortedPrice > 0 && sortSourcePricePerKg > 0) {
      const grossProfit = (sortedPrice - sortSourcePricePerKg) * w;
      bonusAmount = Math.round(grossProfit * 0.1 * 100) / 100;
    }

    const item: SortCartItem = {
      productId: selectedProductId,
      productName: selectedProd?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      isWaste,
      sortedPricePerKg: sortedPrice,
      bonusAmount: Math.max(bonusAmount, 0),
    };

    addSortCartItem(item);
    setSelectedProductId('');
    setItemWeight('');
    setItemSortedPrice('');
    setIsWaste(false);
    const formulaHintStr = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงรายการแล้ว${!isWaste && bonusAmount > 0 ? ` (โบนัส ${formatBaht(bonusAmount)} บาท)` : ''}${formulaHintStr}`);
  };

  // Submit bill
  const handleSubmit = async () => {
    if (!sortSourceProductId) {
      toast.error('กรุณาเลือกสินค้าต้นทาง');
      return;
    }
    if (sortCartItems.length === 0) {
      toast.error('กรุณาเพิ่มรายการคัดแยก');
      return;
    }
    if (sortSourceWeight <= 0) {
      toast.error('กรุณากรอกน้ำหนักที่คัดมา');
      return;
    }
    if (!sortSourcePricePerKg || sortSourcePricePerKg <= 0) {
      toast.error('กรุณากรอกราคาต้นทาง/กก. — ถ้าไม่ทราบราคา ใส่ 0.01 ชั่วคราว');
      return;
    }

    // Validate source stock — skip check if source has no stock tracking
    // (some sources like ของแกะ might not have stock in the system)
    if (sourceAvailableWeight > 0 && sortSourceWeight > sourceAvailableWeight) {
      toast.error(
        `สต๊อกไม่เพียงพอ! มี ${formatWeight(sourceAvailableWeight)}, ต้องการ ${formatWeight(sortSourceWeight)}`
      );
      return;
    }

    setSubmitting(true);
    try {
      // คำนวณ expression ของ source weight และ weighedTotal (เก็บเฉพาะกรณีเป็นจริง)
      const sourceWeightResult = parseWeightExpression(sourceWeightInput);
      const sourceWeightExpression = sourceWeightResult.isFormula ? sourceWeightResult.expression : undefined;
      const weighedTotalResult = parseWeightExpression(weighedTotalInput);
      const weighedTotalExpression = weighedTotalResult.isFormula ? weighedTotalResult.expression : undefined;

      const result = await createSortingBill({
        date: new Date(dateTime).toISOString(),
        sourceProductId: sortSourceProductId,
        sourceWeight: sortSourceWeight,
        sourceWeightExpression,
        sourcePricePerKg: sortSourcePricePerKg,
        weighedTotal: sortWeighedTotal,
        weighedTotalExpression,
        roomNumber: sortRoomNumber || undefined,
        note: note || undefined,
        items: sortCartItems.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          isWaste: item.isWaste,
          sortedPricePerKg: item.sortedPricePerKg,
          bonusAmount: item.bonusAmount,
        })),
      });

      // API returns { bill: {...} } — extract it
      const billData = result as unknown as {
        bill?: { lossWeight: number; lossCost: number };
      };
      const bill = billData.bill ?? (result as unknown as { lossWeight: number; lossCost: number });

      clearSortCart();
      setDateTime(getCurrentDateForInput());
      setNote('');

      const bonusMsg = totalBonusWithLossDeduction > 0 ? ` | โบนัส ${formatBaht(totalBonusWithLossDeduction)} บาท` : '';
      toast.success(
        `บันทึกใบคัดแยกสำเร็จ! สูญเสีย ${formatWeight(bill?.lossWeight ?? lossWeight)} (${formatBaht(bill?.lossCost ?? lossCost)} บาท)${bonusMsg}`
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
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
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
          <h2 className="text-2xl font-bold text-gray-900">คัดแยกสินค้า</h2>
          <p className="text-gray-500 mt-1">บันทึกรายการคัดแยกเหล็กผสมเป็นประเภทย่อย</p>
        </div>
        {sortCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-purple-100 text-purple-700">
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {sortCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Source Selection */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">สินค้าต้นทาง (เหล็กผสม)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Source Product Select */}
            <div className="space-y-2">
              <Label htmlFor="sort-source">เลือกสินค้าต้นทาง</Label>
              <ProductCombobox
                groups={groupedProductsForCombobox}
                value={sortSourceProductId}
                onValueChange={setSortSourceProduct}
                placeholder="เลือกสินค้าต้นทาง"
                searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                id="sort-source"
                renderLabel={(product) => `${product.name} (${formatWeight(product.stock?.totalWeight ?? 0)})`}
                onSelect={() => document.getElementById('sort-source-weight')?.focus()}
              />
            </div>

            {/* Source Weight */}
            <div className="space-y-2">
              <Label htmlFor="sort-source-weight">น้ำหนักที่คัดมา (กก.)</Label>
              <Input
                id="sort-source-weight"
                type="text"
                inputMode="decimal"
                placeholder="0.00 หรือ 68.4-0.2"
                value={sourceWeightInput}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^[+\-*/().\d\s]*$/.test(v)) {
                    setSourceWeightInput(v);
                    // Parse and update store for real-time calculations
                    const result = parseWeightExpression(v);
                    if (!result.error) {
                      setSortSourceWeight(result.value);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const result = parseWeightExpression(sourceWeightInput);
                    if (result.error) {
                      toast.error(`น้ำหนัก: ${result.error}`);
                      return;
                    }
                    setSortSourceWeight(result.value);
                    if (result.isFormula) {
                      toast.info(`น้ำหนัก: ${result.expression} = ${result.value}`);
                    }
                    document.getElementById('sort-source-price')?.focus();
                  }
                }}
              />
              {/* Live preview */}
              {sourceWeightInput.trim() && (() => {
                const preview = previewWeightValue(sourceWeightInput);
                if (preview === null) return null;
                return (
                  <p className="text-xs text-emerald-700 font-medium">
                    = {preview.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} กก.
                  </p>
                );
              })()}
            </div>

            {/* Source Price Per Kg - พนักงานใส่เอง */}
            <div className="space-y-2">
              <Label htmlFor="sort-source-price">ราคาต้นทาง/กก. (บาท)</Label>
              <Input
                id="sort-source-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="ราคารับซื้อเหล็ก"
                value={sortSourcePricePerKg || ''}
                onChange={(e) => setSortSourcePricePerKg(parseFloat(e.target.value) || 0)}
              />
            </div>

            {/* Weighed Total */}
            <div className="space-y-2">
              <Label htmlFor="sort-weighed-total">น้ำหนักชั่งรวม (กก.)</Label>
              <Input
                id="sort-weighed-total"
                type="text"
                inputMode="decimal"
                placeholder="0.00 หรือ 68.4-0.2"
                value={weighedTotalInput}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^[+\-*/().\d\s]*$/.test(v)) {
                    setWeighedTotalInput(v);
                    const result = parseWeightExpression(v);
                    if (!result.error) {
                      setSortWeighedTotal(result.value);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const result = parseWeightExpression(weighedTotalInput);
                    if (result.error) {
                      toast.error(`น้ำหนักชั่งรวม: ${result.error}`);
                      return;
                    }
                    setSortWeighedTotal(result.value);
                    if (result.isFormula) {
                      toast.info(`น้ำหนักชั่งรวม: ${result.expression} = ${result.value}`);
                    }
                    document.getElementById('sort-source')?.focus();
                  }
                }}
              />
              {/* Live preview */}
              {weighedTotalInput.trim() && (() => {
                const preview = previewWeightValue(weighedTotalInput);
                if (preview === null) return null;
                return (
                  <p className="text-xs text-emerald-700 font-medium">
                    = {preview.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} กก.
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Source info display */}
          {sourceProduct && (
            <div className="flex flex-wrap gap-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-sm">
                <span className="text-gray-500">สินค้าต้นทาง:</span>{' '}
                <span className="font-semibold text-amber-900">{sourceProduct.name}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">สต๊อก:</span>{' '}
                <span className="font-semibold text-amber-900">{formatWeight(sourceAvailableWeight)}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">ต้นทุนเฉลี่ย (FIFO):</span>{' '}
                <span className="font-semibold text-amber-900">{formatBaht(sourceCostPerKg)} บาท/กก.</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">ราคารับซื้อประจำ:</span>{' '}
                <span className="font-semibold text-amber-900">{formatBaht(sourceProduct.defaultBuyPrice)} บาท/กก.</span>
              </div>
            </div>
          )}

          {/* Stock warning */}
          {sourceProduct && sortSourceWeight > sourceAvailableWeight && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                น้ำหนักที่คัดมา ({formatWeight(sortSourceWeight)}) เกินสต๊อกคงเหลือ ({formatWeight(sourceAvailableWeight)})
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Sorted Item Form */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">เพิ่มรายการคัดแยก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Product Select */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="sort-product">สินค้าที่คัดแยกได้</Label>
              <ProductCombobox
                groups={groupedProductsForCombobox}
                value={selectedProductId}
                onValueChange={setSelectedProductId}
                placeholder="เลือกสินค้า"
                searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                id="sort-product"
                renderLabel={(product) => product.name}
                onSelect={() => document.getElementById('sort-item-weight')?.focus()}
              />
            </div>

            {/* Weight */}
            <div className="space-y-2">
              <Label htmlFor="sort-item-weight">น้ำหนัก (กก.)</Label>
              <Input
                id="sort-item-weight"
                type="text"
                inputMode="decimal"
                placeholder="0.00 หรือ 22-0.2"
                value={itemWeight}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^[+\-*/().\d\s]*$/.test(v)) {
                    setItemWeight(v);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const result = parseWeightExpression(itemWeight);
                    if (result.error) {
                      toast.error(`น้ำหนัก: ${result.error}`);
                      return;
                    }
                    if (result.isFormula && !result.error) {
                      toast.info(`น้ำหนัก: ${result.expression} = ${result.value}`);
                    }
                    if (!isWaste) {
                      document.getElementById('sort-sorted-price')?.focus();
                    } else {
                      handleAddItem();
                    }
                  }
                }}
              />
              {/* Live preview */}
              {itemWeight.trim() && (() => {
                const preview = previewWeightValue(itemWeight);
                if (preview === null) return null;
                return (
                  <p className="text-xs text-emerald-700 font-medium">
                    = {preview.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} กก.
                  </p>
                );
              })()}
            </div>

            {/* Sorted Price - พนักงานใส่เอง */}
            <div className="space-y-2">
              <Label htmlFor="sort-sorted-price">ราคาซื้อ/กก. (บาท)</Label>
              <Input
                id="sort-sorted-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="ราคารับซื้อวันนี้"
                value={isWaste ? '' : itemSortedPrice}
                onChange={(e) => setItemSortedPrice(e.target.value)}
                disabled={isWaste}
              />
            </div>

            {/* Is Waste */}
            <div className="space-y-2">
              <Label>ประเภท</Label>
              <div className="flex items-center gap-3 h-9">
                <Checkbox
                  id="sort-waste"
                  checked={isWaste}
                  onCheckedChange={(checked) => {
                    setIsWaste(checked === true);
                    if (checked) {
                      setItemSortedPrice('');
                    }
                  }}
                />
                <label htmlFor="sort-waste" className="text-sm text-gray-600 cursor-pointer">
                  เป็นขยะ
                </label>
              </div>
            </div>

            {/* Bonus preview */}
            <div className="space-y-2">
              <Label>โบนัส 10%</Label>
              <div className="flex h-9 items-center rounded-md border bg-pink-50 border-pink-200 px-3 text-sm">
                {isWaste ? (
                  <span className="text-gray-400">ขยะ (ไม่มีโบนัส)</span>
                ) : previewBonus > 0 ? (
                  <span className="font-semibold text-pink-700">{formatBaht(previewBonus)} บาท</span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleAddItem}
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
            disabled={!sortSourceProductId || !sortSourcePricePerKg}
          >
            <Plus className="h-4 w-4 mr-1" />
            เพิ่มรายการ
          </Button>
          {!sortSourceProductId && (
            <p className="text-xs text-gray-400 mt-1">กรุณาเลือกสินค้าต้นทางก่อน</p>
          )}
          {sortSourceProductId && !sortSourcePricePerKg && (
            <p className="text-xs text-amber-500 mt-1">กรุณากรอกราคาต้นทาง/กก. ก่อน</p>
          )}
        </CardContent>
      </Card>

      {/* Sorted Items Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">รายการคัดแยก</CardTitle>
            {totalBonusAmount > 0 && (
              <Badge className="bg-pink-100 text-pink-800 hover:bg-pink-100">
                <Gift className="h-3.5 w-3.5 mr-1" />
                โบนัสรวม {formatBaht(totalBonusAmount)} บาท
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sortCartItems.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <RefreshCw className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>ยังไม่มีรายการคัดแยก</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>ชื่อสินค้า</TableHead>
                    <TableHead className="text-right">น้ำหนัก (กก.)</TableHead>
                    <TableHead className="text-center">ขยะ</TableHead>
                    <TableHead className="text-right">ต้นทุน/กก.</TableHead>
                    <TableHead className="text-right">ราคาซื้อ/กก.</TableHead>
                    <TableHead className="text-right">กำไรขั้นต้น</TableHead>
                    <TableHead className="text-right">โบนัส 10%</TableHead>
                    <TableHead className="w-12 text-center">ลบ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortCartItems.map((item, index) => {
                    const costPerKg = item.isWaste ? 0 : sourceCostPerKg;
                    const totalCost = Math.round(item.weight * costPerKg * 100) / 100;
                    const grossProfit = item.isWaste ? 0 : Math.round((item.sortedPricePerKg - sortSourcePricePerKg) * item.weight * 100) / 100;
                    return (
                      <TableRow key={index}>
                        <TableCell className="text-center text-gray-500">
                          {index + 1}
                        </TableCell>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">{formatWeight(item.weight)}</div>
                          {item.weightExpression && (
                            <div className="text-[11px] text-gray-400">
                              {formulaHint(item.weightExpression)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.isWaste ? (
                            <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                              ขยะ
                            </Badge>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.isWaste ? '-' : formatBaht(costPerKg)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.isWaste ? '-' : formatBaht(item.sortedPricePerKg)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.isWaste ? '-' : (
                            <span className={grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}>
                              {formatBaht(grossProfit)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.isWaste || item.bonusAmount <= 0 ? '-' : (
                            <span className="font-semibold text-pink-700">
                              {formatBaht(item.bonusAmount)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => removeSortCartItem(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-amber-50">
                    <TableCell colSpan={2} className="font-semibold text-amber-900">
                      รวมทั้งหมด
                    </TableCell>
                    <TableCell className="text-right font-semibold text-amber-900">
                      {formatWeight(totalSortedWeight)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-bold text-pink-700">
                      {formatBaht(totalBonusAmount)} บาท
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}

          {/* Loss display */}
          {sortSourceWeight > 0 && sortCartItems.length > 0 && lossWeight > 0 && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span className="text-sm font-semibold text-red-700">
                ศูนย์เสีย: {formatWeight(lossWeight)} ({formatBaht(lossCost)} บาท)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bill Options */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">ตั้งค่าใบคัดแยก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Date/Time */}
            <div className="space-y-2">
              <Label htmlFor="sort-datetime">วันที่/เวลา</Label>
              <Input
                id="sort-datetime"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
              />
            </div>

            {/* Room Number */}
            <div className="space-y-2">
              <Label htmlFor="sort-room">เลขห้อง</Label>
              <Input
                id="sort-room"
                type="text"
                placeholder="เช่น 22, 23"
                value={sortRoomNumber}
                onChange={(e) => setSortRoomNumber(e.target.value)}
              />
            </div>

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="sort-note">หมายเหตุ (ไม่จำเป็น)</Label>
              <Input
                id="sort-note"
                type="text"
                placeholder="หมายเหตุเพิ่มเติม..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* Summary */}
          {sortSourceProductId && sortSourceWeight > 0 && (
            <>
              <Separator />
              <div className="p-4 rounded-lg bg-gray-50 border space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">สรุปรายการ</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-gray-500">น้ำหนักที่คัดมา:</span>
                  <span className="font-medium text-right">{formatWeight(sortSourceWeight)}</span>

                  <span className="text-gray-500">น้ำหนักชั่งรวม:</span>
                  <span className="font-medium text-right">{formatWeight(sortWeighedTotal)}</span>

                  <span className="text-gray-500">น้ำหนักรวมที่ชั่งแยก:</span>
                  <span className="font-medium text-right">{formatWeight(totalSortedWeight)}</span>

                  {lossWeight > 0 && (
                    <>
                      <span className="text-red-600 font-medium">ศูนย์เสีย:</span>
                      <span className="font-semibold text-red-600 text-right">
                        {formatWeight(lossWeight)} ({formatBaht(lossCost)} บาท)
                      </span>
                    </>
                  )}

                  <span className="text-gray-500">ต้นทุนรวม (FIFO):</span>
                  <span className="font-medium text-right">{formatBaht(totalSortedCost)} บาท</span>
                </div>

                {totalBonusAmount > 0 && (
                  <div className="mt-2 pt-2 border-t border-pink-200">
                    <div className="p-3 rounded-lg bg-pink-50 border border-pink-200 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-pink-600 shrink-0" />
                        <span className="text-pink-700 font-medium text-sm">สรุปโบนัสพนักงาน</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-pink-600">กำไรขั้นต้น:</span>
                        <span className="font-medium text-pink-900">{formatBaht(totalGrossProfit)} บาท</span>
                      </div>
                      {lossCost > 0 ? (
                        <div className="flex justify-between text-sm">
                          <span className="text-red-600">หักสูญเสีย ({formatWeight(lossWeight)} กก. × {formatBaht(sortSourcePricePerKg)}):</span>
                          <span className="font-medium text-red-600">-{formatBaht(lossCost)} บาท</span>
                        </div>
                      ) : (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">ไม่มีสูญเสีย</span>
                          <span className="text-gray-400">-</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm pt-1 border-t border-pink-200">
                        <span className="text-pink-700 font-medium">ฐานคิดโบนัส:</span>
                        <span className="font-medium text-pink-900">{formatBaht(netProfitForBonus)} บาท</span>
                      </div>
                      <div className="flex justify-between text-sm pt-1 border-t border-pink-200">
                        <span className="text-pink-700 font-bold">โบนัส 10%:</span>
                        <span className="text-pink-900 font-bold">{formatBaht(totalBonusWithLossDeduction)} บาท</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleSubmit}
              disabled={sortCartItems.length === 0 || !sortSourceProductId || sortSourceWeight <= 0 || submitting}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white h-12 text-base font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึกใบคัดแยก'
              )}
            </Button>
            {sortCartItems.length === 0 && sortSourceProductId && (
              <p className="text-xs text-amber-600 text-center sm:text-right">
                เพิ่มรายการคัดแยกก่อนบันทึก
              </p>
            )}
            {!sortSourceProductId && (
              <p className="text-xs text-amber-600 text-center sm:text-right">
                เลือกสินค้าต้นทางก่อน
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                clearSortCart();
                setDateTime(getCurrentDateForInput());
                setNote('');
                toast.info('ล้างรายการแล้ว');
              }}
              disabled={sortCartItems.length === 0 && !sortSourceProductId}
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              ล้างรายการ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
