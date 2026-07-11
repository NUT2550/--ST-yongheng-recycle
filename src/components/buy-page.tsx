'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { fetchProducts, createBuyBill } from '@/lib/api';
import {
  formatBaht,
  formatWeight,
  getCurrentDateForInput,
  calculateCartTotal,
  calculateCartWeight,
} from '@/lib/helpers';
import { Product, BuyCartItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import { ShoppingCart, Plus, Trash2, Loader2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression, previewWeightValue, formulaHint } from '@/lib/safe-math';
import { DetailedExcelImportDialog } from '@/components/detailed-excel-import-dialog';

export function BuyPage() {
  const {
    buyCartItems,
    addBuyCartItem,
    removeBuyCartItem,
    clearBuyCart,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [pricePerKg, setPricePerKg] = useState<string>('');
  const [dateTime, setDateTime] = useState<string>(getCurrentDateForInput());
  const [isCredit, setIsCredit] = useState(false);
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

  // Group products by category
  const groupedProducts = useMemo((): ProductComboboxGroup[] => {
    const groups: Record<string, { categoryId: string; categoryName: string; products: Product[]; sortOrder: number }> = {};
    for (const product of products) {
      const catId = product.category.id;
      if (!groups[catId]) {
        groups[catId] = { categoryId: catId, categoryName: product.category.name, products: [], sortOrder: product.category.sortOrder };
      }
      groups[catId].products.push(product);
    }
    return Object.values(groups)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ categoryId, categoryName, products: prods }) => ({ categoryId, categoryName, products: prods }));
  }, [products]);

  // Selected product details
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [products, selectedProductId]
  );

  // Auto-fill price when product changes
  useEffect(() => {
    if (selectedProduct) {
      setPricePerKg(String(selectedProduct.defaultBuyPrice));
    }
  }, [selectedProduct]);

  // Auto-calculate total for current item
  const totalAmount = useMemo(() => {
    const result = parseWeightExpression(weight);
    const w = result.error ? 0 : result.value;
    const p = parseFloat(pricePerKg) || 0;
    return w * p;
  }, [weight, pricePerKg]);

  // Cart totals
  const cartTotalWeight = useMemo(
    () => calculateCartWeight(buyCartItems),
    [buyCartItems]
  );
  const cartTotalAmount = useMemo(
    () => calculateCartTotal(buyCartItems),
    [buyCartItems]
  );

  // Add item to cart
  const handleAddItem = () => {
    if (!selectedProductId) {
      toast.error('กรุณาเลือกสินค้า');
      return;
    }
    const weightResult = parseWeightExpression(weight);
    if (weightResult.error) {
      toast.error(`น้ำหนัก: ${weightResult.error}`);
      return;
    }
    const w = weightResult.value;
    if (!w || w <= 0) {
      toast.error('กรุณากรอกน้ำหนัก');
      return;
    }
    const p = parseFloat(pricePerKg);
    if (!p || p <= 0) {
      toast.error('กรุณากรอกราคาต่อกก.');
      return;
    }

    const item: BuyCartItem = {
      productId: selectedProductId,
      productName: selectedProduct?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      pricePerKg: p,
      totalAmount: w * p,
    };

    addBuyCartItem(item);
    setSelectedProductId('');
    setWeight('');
    setPricePerKg('');
    const formulaHintStr = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงตะกร้าแล้ว — ${w} กก.${formulaHintStr}`);
  };

  // Submit bill
  const handleSubmit = async () => {
    if (buyCartItems.length === 0) {
      toast.error('ตะกร้าว่าง กรุณาเพิ่มรายการก่อน');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createBuyBill({
        date: new Date(dateTime).toISOString(),
        isCredit,
        note: note || undefined,
        items: buyCartItems.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          pricePerKg: item.pricePerKg,
        })),
      });

      const billData = result as unknown as { bill: { totalAmount: number } };
      const total = billData.bill?.totalAmount ?? cartTotalAmount;

      clearBuyCart();
      setDateTime(getCurrentDateForInput());
      setIsCredit(false);
      setNote('');
      toast.success(`บันทึกใบรับซื้อสำเร็จ! ยอดรวม ${formatBaht(total)} บาท`);
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">รับซื้อสินค้า</h2>
          <p className="text-gray-500 mt-1 text-sm">บันทึกรายการรับซื้อเหล็กและโลหะ</p>
        </div>
        {buyCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-green-100 text-green-700">
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            {buyCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Main grid: left form + right sticky summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Input form + cart (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Add Item Form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">เพิ่มรายการรับซื้อ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {/* Product Select */}
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="buy-product" className="text-xs">สินค้า</Label>
                  <ProductCombobox
                    groups={groupedProducts}
                    value={selectedProductId}
                    onValueChange={setSelectedProductId}
                    placeholder="เลือกสินค้า"
                    searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                    id="buy-product"
                    renderLabel={(product) => `${product.name} - ${formatBaht(product.defaultBuyPrice)}/กก.`}
                    onSelect={() => document.getElementById('buy-weight')?.focus()}
                  />
                </div>

                {/* Weight */}
                <div className="space-y-1.5">
                  <Label htmlFor="buy-weight" className="text-xs">น้ำหนัก (กก.)</Label>
                  <Input
                    id="buy-weight"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00 หรือ 860-3"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('buy-price')?.focus();
                      }
                    }}
                  />
                  {weight.trim() && (() => {
                    const preview = previewWeightValue(weight);
                    if (preview === null) return null;
                    return (
                      <p className="text-[11px] text-emerald-700 font-medium">
                        = {preview.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} กก.
                      </p>
                    );
                  })()}
                </div>

                {/* Price per kg */}
                <div className="space-y-1.5">
                  <Label htmlFor="buy-price" className="text-xs">ราคา/กก.</Label>
                  <Input
                    id="buy-price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={pricePerKg}
                    onChange={(e) => setPricePerKg(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddItem();
                      }
                    }}
                  />
                </div>

                {/* Total + Add button */}
                <div className="space-y-1.5">
                  <Label className="text-xs">จำนวนเงิน</Label>
                  <div className="flex gap-2">
                    <div className="flex h-9 flex-1 items-center rounded-md border bg-gray-50 px-3 text-xs font-semibold text-amber-800">
                      {formatBaht(totalAmount)}
                    </div>
                    <Button
                      onClick={handleAddItem}
                      className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      เพิ่ม
                    </Button>
                  </div>
                </div>
              </div>

              {/* ST-18: Single detailed Excel import button (replaces old single-bill import) */}
              <div className="mt-3 flex flex-wrap gap-2">
                <DetailedExcelImportDialog
                  products={products}
                  onImport={async (bills) => {
                    setSubmitting(true);
                    let success = 0;
                    let failed = 0;
                    for (const bill of bills) {
                      try {
                        await createBuyBill({
                          date: bill.date,
                          isCredit: false,
                          note: bill.note,
                          externalBillNumber: bill.externalBillNumber,
                          items: bill.items.map((item) => ({
                            productId: item.productId,
                            weight: item.weight,
                            weightExpression: item.weightExpression,
                            pricePerKg: item.pricePerKg,
                          })),
                        });
                        success++;
                      } catch (err) {
                        failed++;
                        const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
                        toast.error(`นำเข้าบิล ${bill.externalBillNumber} ไม่สำเร็จ: ${message}`);
                      }
                    }
                    setSubmitting(false);
                    if (success > 0) {
                      toast.success(`นำเข้าสำเร็จ ${success} บิล${failed > 0 ? ` (ล้มเหลว ${failed} บิล)` : ''}`);
                    }
                  }}
                />
              </div>

              {/* Cart (compact) */}
              {buyCartItems.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">รายการในตะกร้า ({buyCartItems.length})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { clearBuyCart(); toast.info('ล้างตะกร้าแล้ว'); }}
                      className="text-xs text-red-600 hover:text-red-700 h-6"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      ล้าง
                    </Button>
                  </div>
                  {buyCartItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 rounded-md bg-gray-50 border text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">
                            {item.productName}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-500">
                          {formatWeight(item.weight)} กก. · {formatBaht(item.pricePerKg)}/กก.
                          {item.weightExpression && (
                            <span className="ml-1 text-gray-400">({formulaHint(item.weightExpression)})</span>
                          )}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-amber-800 mr-2 shrink-0">
                        {formatBaht(item.totalAmount)} บาท
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBuyCartItem(index)}
                        className="text-red-600 hover:text-red-700 h-7 w-7 p-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
              {/* Totals */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">จำนวนรายการ</span>
                <span className="font-medium">{buyCartItems.length} รายการ</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนักรวม</span>
                <span className="font-medium">{formatWeight(cartTotalWeight)} กก.</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ยอดรวม</span>
                <span className="font-bold text-amber-800">{formatBaht(cartTotalAmount)} บาท</span>
              </div>

              <Separator />

              {/* Date + Credit */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="buy-datetime" className="text-xs">วันที่/เวลา</Label>
                  <Input
                    id="buy-datetime"
                    type="datetime-local"
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="buy-credit" className="text-xs">ประเภทการซื้อ</Label>
                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="buy-credit"
                      checked={isCredit}
                      onCheckedChange={setIsCredit}
                    />
                    <span className="text-xs text-gray-600">
                      {isCredit ? 'ซื้อเชื่อ' : 'ซื้อสด'}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="buy-note" className="text-xs">หมายเหตุ</Label>
                  <Input
                    id="buy-note"
                    type="text"
                    placeholder="ถ้ามี"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting || buyCartItems.length === 0}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><ShoppingCart className="h-4 w-4 mr-1" /> บันทึกใบรับซื้อ</>
                )}
              </Button>
              {buyCartItems.length === 0 && (
                <p className="text-[11px] text-amber-600 text-center">เพิ่มรายการก่อนบันทึก</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Empty state */}
      {buyCartItems.length === 0 && !selectedProductId && (
        <Card>
          <CardContent className="p-8 text-center text-gray-400 text-sm">
            <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-40" />
            เลือกสินค้าและเพิ่มรายการรับซื้อเพื่อเริ่ม
          </CardContent>
        </Card>
      )}
    </div>
  );
}
