'use client';

import { useState, useEffect, useMemo, useCallback, useReducer } from 'react';
import { useAppStore } from '@/lib/store';
import { fetchProducts, createStockTransfer } from '@/lib/api';
import {
  formatBaht,
  formatWeight,
  calculateCartWeight,
} from '@/lib/helpers';
import {
  getThailandTodayDateString,
  isFutureThailandDate,
  formatThailandBuddhistDate,
} from '@/lib/thailand-date';
import {
  transferFormReducer,
  type TransferFormState,
} from '@/lib/transfer-form-controller';
import { Product, TransferCartItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import { PackageOpen, Plus, Trash2, Loader2, AlertTriangle, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression, previewWeightValue, formulaHint } from '@/lib/safe-math';

export function TransferPage() {
  const {
    transferCartItems,
    transferSourceProductId,
    transferSourceWeight,
    transferWeighedTotal,
    transferRoomNumber,
    transferSourcePricePerKg,
    transferLaborCost,
    setTransferSourceProduct,
    setTransferSourceWeight,
    setTransferWeighedTotal,
    setTransferRoomNumber,
    setTransferSourcePricePerKg,
    setTransferLaborCost,
    addTransferCartItem,
    removeTransferCartItem,
    updateTransferCartItem,
    clearTransferCart,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // ST-41: form state (businessDate + submitting) managed by the tested reducer.
  // Other state (cart, source product, etc.) stays as useState.
  const [formState, dispatch] = useReducer(transferFormReducer, {
    businessDate: '',
    submitting: false,
  } as TransferFormState);
  const { businessDate } = formState;

  // Form state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [itemWeight, setItemWeight] = useState<string>('');
  const [itemOutputPrice, setItemOutputPrice] = useState<string>('');
  const [sourceWeightInput, setSourceWeightInput] = useState<string>('');
  const [weighedTotalInput, setWeighedTotalInput] = useState<string>('');
  const [isWaste, setIsWaste] = useState(false);
  const [note, setNote] = useState<string>('');
  const [gainReason, setGainReason] = useState<string>(''); // ST-40: required when output > source

  // Edit state for output rows
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editProductId, setEditProductId] = useState<string>('');
  const [editWeight, setEditWeight] = useState<string>('');
  const [editOutputPrice, setEditOutputPrice] = useState<string>('');
  const [editIsWaste, setEditIsWaste] = useState(false);

  // ST-39: loadProducts is reusable so we can refresh source stock after a 409/500
  // (the backend may have deducted then compensated source lots, leaving the UI stale).
  // Wrapped in useCallback for hook stability (no re-creation on every render).
  const loadProducts = useCallback(async () => {
    try {
      const res = await fetchProducts();
      const data = res as unknown as { products: Product[] };
      setProducts(data.products || (res as unknown as Product[]));
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูลสินค้าได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // ST-41: initialize the form reducer to today's Thailand date on mount.
  useEffect(() => {
    dispatch({ type: 'INIT' });
  }, []);

  // Group ALL products by category
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

  const sourceProduct = useMemo(
    () => products.find((p) => p.id === transferSourceProductId),
    [products, transferSourceProductId]
  );

  const sourceAvailableWeight = useMemo(
    () => sourceProduct?.stock?.totalWeight ?? 0,
    [sourceProduct]
  );
  const sourceCostPerKg = useMemo(
    () => sourceProduct?.stock?.avgCostPerKg ?? 0,
    [sourceProduct]
  );

  const totalOutputWeight = useMemo(
    () => calculateCartWeight(transferCartItems),
    [transferCartItems]
  );

  // ST-40: positive yield — output may exceed source for แกะของ (dismantling)
  const lossWeight = useMemo(
    () => Math.round(Math.max(transferSourceWeight - totalOutputWeight, 0) * 100) / 100,
    [transferSourceWeight, totalOutputWeight]
  );
  const gainWeight = useMemo(
    () => Math.round(Math.max(totalOutputWeight - transferSourceWeight, 0) * 100) / 100,
    [transferSourceWeight, totalOutputWeight]
  );
  const weightVariance = useMemo(
    () => Math.round((totalOutputWeight - transferSourceWeight) * 100) / 100,
    [transferSourceWeight, totalOutputWeight]
  );
  const lossCost = useMemo(
    () => Math.round(lossWeight * sourceCostPerKg * 100) / 100,
    [lossWeight, sourceCostPerKg]
  );
  const hasGain = gainWeight > 0.01;

  // Profitability analysis
  const outputTotalValue = useMemo(
    () => Math.round(
      transferCartItems.reduce((s, i) => s + (i.isWaste ? 0 : i.weight * i.outputPricePerKg), 0) * 100
    ) / 100,
    [transferCartItems]
  );
  const sourceAnalysisCost = useMemo(
    () => Math.round(transferSourceWeight * transferSourcePricePerKg * 100) / 100,
    [transferSourceWeight, transferSourcePricePerKg]
  );
  const profitLoss = useMemo(
    () => Math.round((outputTotalValue - sourceAnalysisCost - transferLaborCost) * 100) / 100,
    [outputTotalValue, sourceAnalysisCost, transferLaborCost]
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
    const outPrice = isWaste ? 0 : (parseFloat(itemOutputPrice) || 0);
    const item: TransferCartItem = {
      productId: selectedProductId,
      productName: selectedProd?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      isWaste,
      outputPricePerKg: outPrice,
    };

    addTransferCartItem(item);
    setSelectedProductId('');
    setItemWeight('');
    setItemOutputPrice('');
    setIsWaste(false);
    const formulaHintStr = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงรายการแล้ว${formulaHintStr}`);
  };

  // Start editing an output row
  const startEdit = (index: number) => {
    const item = transferCartItems[index];
    if (!item) return;
    setEditingIndex(index);
    setEditProductId(item.productId);
    setEditWeight(item.weightExpression || String(item.weight));
    setEditOutputPrice(item.isWaste ? '' : String(item.outputPricePerKg));
    setEditIsWaste(item.isWaste);
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingIndex(null);
    setEditProductId('');
    setEditWeight('');
    setEditOutputPrice('');
    setEditIsWaste(false);
  };

  // Save edit
  const saveEdit = () => {
    if (editingIndex === null) return;
    if (!editProductId) {
      toast.error('กรุณาเลือกสินค้า');
      return;
    }
    const weightResult = parseWeightExpression(editWeight);
    if (weightResult.error) {
      toast.error(`น้ำหนัก: ${weightResult.error}`);
      return;
    }
    const w = weightResult.value;
    if (!w || w <= 0) {
      toast.error('น้ำหนักต้องมากกว่า 0');
      return;
    }
    if (editProductId === transferSourceProductId && !editIsWaste) {
      toast.error('สินค้า output ต้องไม่เหมือนสินค้าต้นทาง');
      return;
    }
    const editProd = products.find((p) => p.id === editProductId);
    const outPrice = editIsWaste ? 0 : (parseFloat(editOutputPrice) || 0);
    updateTransferCartItem(editingIndex, {
      productId: editProductId,
      productName: editProd?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      isWaste: editIsWaste,
      outputPricePerKg: outPrice,
    });
    cancelEdit();
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
    // Validate all cart items have a productId
    for (let i = 0; i < transferCartItems.length; i++) {
      if (!transferCartItems[i].productId) {
        toast.error(`รายการ output ลำดับที่ ${i + 1} ไม่มีสินค้า กรุณาเลือกสินค้าให้ครบก่อนบันทึก`);
        return;
      }
    }
    if (transferSourceWeight <= 0) {
      toast.error('กรุณากรอกน้ำหนักต้นทาง');
      return;
    }
    // ST-40: positive yield allowed for แกะของ — but require a reason
    if (hasGain && !gainReason.trim()) {
      toast.error(
        `น้ำหนัก output มากกว่าต้นทาง ${formatWeight(gainWeight)} กก. กรุณาระบุเหตุผล (เช่น หักน้ำหนักประเมินตอนซื้อ)`
      );
      return;
    }
    if (sourceAvailableWeight <= 0) {
      toast.error(
        `สินค้าต้นทางมีสต็อก 0 กก. กรุณาเพิ่มสต็อกก่อนบันทึกการย้าย`
      );
      return;
    }
    if (transferSourceWeight > sourceAvailableWeight) {
      toast.error(
        `สต็อกไม่เพียงพอ! มี ${formatWeight(sourceAvailableWeight)} กก., ต้องการ ${formatWeight(transferSourceWeight)} กก.`
      );
      return;
    }
    // ST-41: validate business date (not blank, not future)
    if (!businessDate || businessDate.trim() === '') {
      toast.error('กรุณาระบุวันที่แกะของ');
      return;
    }
    if (isFutureThailandDate(businessDate)) {
      toast.error('ไม่สามารถเลือกวันที่ในอนาคตได้');
      return;
    }

    dispatch({ type: 'SUBMIT_START' });
    try {
      const sourceWeightResult = parseWeightExpression(sourceWeightInput);
      const sourceWeightExpression = sourceWeightResult.isFormula ? sourceWeightResult.expression : undefined;
      const weighedTotalResult = parseWeightExpression(weighedTotalInput);
      const weighedTotalExpression = weighedTotalResult.isFormula ? weighedTotalResult.expression : undefined;

      const result = await createStockTransfer({
        date: businessDate, // ST-41: date-only YYYY-MM-DD (backend normalizes via parseThailandBusinessDate)
        sourceProductId: transferSourceProductId,
        sourceWeight: transferSourceWeight,
        sourceWeightExpression,
        roomNumber: transferRoomNumber || undefined,
        sourcePricePerKg: transferSourcePricePerKg || undefined,
        laborCost: transferLaborCost || undefined,
        weighedTotal: transferWeighedTotal,
        weighedTotalExpression,
        note: note || undefined,
        gainReason: hasGain ? gainReason.trim() : undefined,
        items: transferCartItems.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          isWaste: item.isWaste,
          outputPricePerKg: item.outputPricePerKg,
        })),
      });

      const billData = result as unknown as {
        bill?: { lossWeight: number; lossCost: number; profitLoss: number };
      };
      const bill = billData.bill ?? (result as unknown as { lossWeight: number; lossCost: number; profitLoss: number });

      clearTransferCart();
      setSourceWeightInput('');
      setWeighedTotalInput('');
      // ST-41: dispatch SUBMIT_SUCCESS — reducer resets date to today + submitting=false
      dispatch({ type: 'SUBMIT_SUCCESS' });
      setNote('');
      setGainReason('');

      const profitMsg = ` | กำไร/ขาดทุน ${formatBaht(bill?.profitLoss ?? profitLoss)} บาท`;
      toast.success(
        `บันทึกใบย้ายสต็อกสำเร็จ! สูญเสีย ${formatWeight(bill?.lossWeight ?? lossWeight)} (${formatBaht(bill?.lossCost ?? lossCost)} บาท)${profitMsg}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      // ST-41: dispatch SUBMIT_ERROR — reducer preserves the selected date + submitting=false
      dispatch({ type: 'SUBMIT_ERROR' });
      // ST-13: Show the ORIGINAL save error first (8s duration for complex messages
      // that include request ID + guidance). This must not be hidden by the refresh.
      toast.error(`บันทึกไม่สำเร็จ: ${message}`, { duration: 8000 });
      // ST-39: After a failed save, refresh source stock because the backend may have
      // deducted then compensated source lots (FIFO_MISMATCH 409, P2002 409, or any 500
      // after deduction). The displayed source weight / cost may be stale until refreshed.
      // Preserve the original error — only show a SEPARATE secondary warning if the
      // refresh itself fails, so the user knows the displayed stock may be unreliable.
      loadProducts().catch(() => {
        toast.warning('ไม่สามารถรีเฟรชสต็อกได้ — กรุณากด Refresh หน้าเว็บก่อนบันทึกซ้ำ', { duration: 8000 });
      });
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">แกะของ / ย้ายสต็อก</h2>
          <p className="text-gray-500 mt-1 text-sm">แกะสินค้าต้นทางออกเป็นสินค้าย่อย (ไม่มีโบนัสพนักงาน)</p>
        </div>
        {transferCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-cyan-100 text-cyan-700">
            <PackageOpen className="h-3.5 w-3.5 mr-1" />
            {transferCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Main grid: left form + right sticky summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Input form (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Source Selection + Room + Source Price */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">สินค้าต้นทาง</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-source" className="text-xs">เลือกสินค้าต้นทาง</Label>
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
                    <p className="text-[11px] text-gray-500">
                      สต็อก: {formatWeight(sourceAvailableWeight)} · ต้นทุน FIFO {formatBaht(sourceCostPerKg)}/กก.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-source-weight" className="text-xs">น้ำหนักต้นทาง (กก.)</Label>
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
                    <p className="text-[11px] text-gray-500">
                      {previewWeightValue(sourceWeightInput) ? `= ${previewWeightValue(sourceWeightInput)} กก.` : formulaHint(sourceWeightInput)}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-room" className="text-xs">เลขห้อง</Label>
                  <Input
                    id="transfer-room"
                    type="text"
                    placeholder="เช่น 22, 23"
                    value={transferRoomNumber}
                    onChange={(e) => setTransferRoomNumber(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-source-price" className="text-xs">ราคาต้นทาง/กก. (บาท)</Label>
                  <Input
                    id="transfer-source-price"
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={transferSourcePricePerKg || ''}
                    onChange={(e) => setTransferSourcePricePerKg(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-labor" className="text-xs">เวลา/ค่าแรง (บาท)</Label>
                  <Input
                    id="transfer-labor"
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={transferLaborCost || ''}
                    onChange={(e) => setTransferLaborCost(parseFloat(e.target.value) || 0)}
                  />
                </div>

                {/* ST-41: Business date */}
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-date" className="text-xs">วันที่แกะของ</Label>
                  <Input
                    id="transfer-date"
                    type="date"
                    value={businessDate}
                    max={getThailandTodayDateString()}
                    onChange={(e) => dispatch({ type: 'SET_DATE', date: e.target.value })}
                    className="text-sm"
                  />
                  {businessDate && businessDate < getThailandTodayDateString() && (
                    <p className="text-[11px] text-amber-600">กำลังบันทึกย้อนหลัง — {formatThailandBuddhistDate(businessDate)}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-weighed-total" className="text-xs">น้ำหนักชั่งรวม (กก.) <span className="text-gray-400">(ถ้ามี)</span></Label>
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">เพิ่มสินค้า output</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="transfer-output" className="text-xs">สินค้า output</Label>
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

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-item-weight" className="text-xs">น้ำหนัก (กก.)</Label>
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
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transfer-item-price" className="text-xs">ราคาปลายทาง/กก.</Label>
                  <Input
                    id="transfer-item-price"
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={itemOutputPrice}
                    onChange={(e) => setItemOutputPrice(e.target.value)}
                    disabled={isWaste}
                  />
                </div>

                <div className="flex items-center space-x-2 pb-2">
                  <Checkbox
                    id="transfer-is-waste"
                    checked={isWaste}
                    onCheckedChange={(v) => setIsWaste(v === true)}
                  />
                  <Label htmlFor="transfer-is-waste" className="text-xs cursor-pointer">
                    เศษ/ขยะ
                  </Label>
                </div>

                <Button onClick={handleAddItem} className="w-full">
                  <Plus className="h-4 w-4 mr-1" />
                  เพิ่ม
                </Button>
              </div>

              {/* Cart */}
              {transferCartItems.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">รายการ output ({transferCartItems.length})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearTransferCart()}
                      className="text-xs text-red-600 hover:text-red-700 h-6"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      ล้าง
                    </Button>
                  </div>
                  {transferCartItems.map((item, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded-md border text-sm ${editingIndex === index ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'}`}
                    >
                      {editingIndex === index ? (
                        /* Inline edit mode */
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <ProductCombobox
                              groups={groupedProductsForCombobox}
                              value={editProductId}
                              onValueChange={setEditProductId}
                              placeholder="เลือกสินค้า"
                              searchPlaceholder="ค้นหาสินค้า..."
                              renderLabel={(product) => `${product.name} (สต็อก ${formatWeight(product.stock?.totalWeight ?? 0)})`}
                            />
                            <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                              <Checkbox
                                checked={editIsWaste}
                                onCheckedChange={(v) => setEditIsWaste(v === true)}
                              />
                              เศษ
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-gray-500">น้ำหนัก (กก.)</Label>
                              <Input
                                value={editWeight}
                                onChange={(e) => setEditWeight(e.target.value)}
                                placeholder="น้ำหนัก"
                                className="text-xs h-8"
                              />
                              {editWeight && (
                                <p className="text-[10px] text-gray-400">
                                  {previewWeightValue(editWeight) ? `= ${previewWeightValue(editWeight)} กก.` : formulaHint(editWeight)}
                                </p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-gray-500">ราคา/กก.</Label>
                              <Input
                                type="number"
                                value={editOutputPrice}
                                onChange={(e) => setEditOutputPrice(e.target.value)}
                                placeholder="0"
                                disabled={editIsWaste}
                                className="text-xs h-8"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 text-xs">
                              <X className="h-3 w-3 mr-1" /> ยกเลิก
                            </Button>
                            <Button size="sm" onClick={saveEdit} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white">
                              <Check className="h-3 w-3 mr-1" /> บันทึกการแก้ไข
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* Display mode */
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startEdit(index)}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900 truncate">
                                {item.productName}
                              </span>
                              {item.isWaste && (
                                <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0">
                                  เศษ
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-500">
                              {formatWeight(item.weight)} กก.
                              {!item.isWaste && item.outputPricePerKg > 0 && ` · ${formatBaht(item.outputPricePerKg)}/กก.`}
                              {item.weightExpression && (
                                <span className="ml-1 text-gray-400">({formulaHint(item.weightExpression)})</span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!item.isWaste && item.outputPricePerKg > 0 && (
                              <span className="text-xs font-medium text-gray-700 mr-2">
                                {formatBaht(item.weight * item.outputPricePerKg)} บาท
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(index)}
                              className="text-blue-600 hover:text-blue-700 h-7 w-7 p-0"
                              title="แก้ไข"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTransferCartItem(index)}
                              className="text-red-600 hover:text-red-700 h-7 w-7 p-0"
                              title="ลบ"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Sticky Summary */}
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">สรุป</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {/* ST-41: Business date in summary */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">วันที่แกะของ</span>
                <span className="font-medium">{businessDate ? formatThailandBuddhistDate(businessDate) : '—'}</span>
              </div>

              {/* Weight summary */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนักต้นทาง</span>
                <span className="font-medium">{formatWeight(transferSourceWeight)} กก.</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนัก output รวม</span>
                <span className="font-medium">{formatWeight(totalOutputWeight)} กก.</span>
              </div>
              {lossWeight > 0 ? (
                <div className="flex justify-between text-sm">
                  <span className="text-red-600">สูญเสีย</span>
                  <span className="font-medium text-red-600">
                    {formatWeight(lossWeight)} กก. ({formatBaht(lossCost)} บาท)
                  </span>
                </div>
              ) : gainWeight > 0 ? (
                <div className="flex justify-between text-sm p-2 rounded bg-amber-50 border border-amber-300">
                  <span className="text-amber-700 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    เพิ่มจากการชั่งจริง
                  </span>
                  <span className="font-bold text-amber-700">
                    +{formatWeight(gainWeight)} กก.
                  </span>
                </div>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">สูญเสีย</span>
                  <span className="font-medium text-green-600">0.00 กก.</span>
                </div>
              )}
              {gainWeight > 0 && (
                <div className="text-[11px] text-amber-600 leading-tight">
                  สต็อกต้นทางจะถูกหักเฉพาะ {formatWeight(transferSourceWeight)} กก.
                  สต็อก output จะถูกเพิ่มตามน้ำหนักจริง {formatWeight(totalOutputWeight)} กก.
                </div>
              )}

              <Separator />

              {/* Profitability analysis */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-cyan-700">การวิเคราะห์กำไร/ขาดทุน</p>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ต้นทุนรวม (ต้นทาง)</span>
                  <span className="font-medium">{formatBaht(sourceAnalysisCost)} บาท</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">เวลา/ค่าแรง</span>
                  <span className="font-medium">{formatBaht(transferLaborCost)} บาท</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">มูลค่าปลายทางรวม</span>
                  <span className="font-medium text-green-700">{formatBaht(outputTotalValue)} บาท</span>
                </div>
              </div>
              <div className="flex justify-between text-sm pt-1.5 border-t">
                <span className={`font-bold ${profitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  กำไร/ขาดทุน
                </span>
                <span className={`font-bold ${profitLoss >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatBaht(profitLoss)} บาท
                </span>
              </div>

              {/* Note */}
              <div className="space-y-1 pt-1">
                <Label htmlFor="transfer-note" className="text-xs">หมายเหตุ</Label>
                <Input
                  id="transfer-note"
                  placeholder="หมายเหตุ (ถ้ามี)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="text-sm"
                />
              </div>

              {/* Stock warning */}
              {transferSourceProductId && sourceAvailableWeight <= 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  สินค้าต้นทางมีสต็อก 0 กก. — กรุณาเพิ่มสต็อกก่อนบันทึกการย้าย
                </div>
              )}
              {transferSourceProductId && sourceAvailableWeight > 0 && transferSourceWeight > sourceAvailableWeight && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  สต็อกไม่เพียงพอ! มี {formatWeight(sourceAvailableWeight)} กก., ต้องการ {formatWeight(transferSourceWeight)} กก.
                </div>
              )}

              {hasGain && (
                <div className="space-y-1">
                  <Label className="text-xs text-amber-700 font-medium">
                    เหตุผลที่ output มากกว่าต้นทาง <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    placeholder="เช่น หักน้ำหนักประเมินตอนซื้อ"
                    value={gainReason}
                    onChange={(e) => setGainReason(e.target.value)}
                    className="text-sm h-8 border-amber-300"
                  />
                  <p className="text-[10px] text-amber-600">
                    ต้องระบุเหตุผลเมื่อน้ำหนัก output มากกว่าต้นทาง
                  </p>
                </div>
              )}
              <Button
                onClick={handleSubmit}
                disabled={formState.submitting || !businessDate || transferSourceWeight <= 0 || transferCartItems.length === 0 || sourceAvailableWeight <= 0 || transferSourceWeight > sourceAvailableWeight || (hasGain && !gainReason.trim())}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
              >
                {formState.submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><PackageOpen className="h-4 w-4 mr-1" /> บันทึกใบย้ายสต็อก</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Empty state when no items */}
      {transferCartItems.length === 0 && !transferSourceProductId && (
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
