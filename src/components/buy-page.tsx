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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ShoppingCart, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression } from '@/lib/safe-math';

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
        // API returns { products: Product[] } but fetchJSON type may not match
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

  // Auto-calculate total
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
      pricePerKg: p,
      totalAmount: w * p,
    };

    addBuyCartItem(item);
    setSelectedProductId('');
    setWeight('');
    setPricePerKg('');
    const formulaHint = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงตะกร้าแล้ว — ${w} กก.${formulaHint}`);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">รับซื้อสินค้า</h2>
          <p className="text-gray-500 mt-1">บันทึกรายการรับซื้อเหล็กและโลหะ</p>
        </div>
        {buyCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-green-100 text-green-700">
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            {buyCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Add Item Form */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">เพิ่มรายการรับซื้อ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Product Select */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="buy-product">สินค้า</Label>
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
            <div className="space-y-2">
              <Label htmlFor="buy-weight">น้ำหนัก (กก.)</Label>
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
                    const result = parseWeightExpression(weight);
                    if (result.error) {
                      toast.error(`น้ำหนัก: ${result.error}`);
                      return;
                    }
                    if (result.isFormula && !result.error) {
                      toast.info(`น้ำหนัก: ${result.expression} = ${result.value}`);
                    }
                    document.getElementById('buy-price')?.focus();
                  }
                }}
              />
            </div>

            {/* Price per kg */}
            <div className="space-y-2">
              <Label htmlFor="buy-price">ราคา/กก.</Label>
              <Input
                id="buy-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={pricePerKg}
                onChange={(e) => setPricePerKg(e.target.value)}
              />
            </div>

            {/* Total (read-only) */}
            <div className="space-y-2">
              <Label>จำนวนเงิน</Label>
              <div className="flex h-9 items-center rounded-md border bg-gray-50 px-3 text-sm font-semibold text-amber-800">
                {formatBaht(totalAmount)} บาท
              </div>
            </div>
          </div>

          <Button
            onClick={handleAddItem}
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            เพิ่มรายการ
          </Button>
        </CardContent>
      </Card>

      {/* Cart Items Table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">รายการในตะกร้า</CardTitle>
        </CardHeader>
        <CardContent>
          {buyCartItems.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>ยังไม่มีรายการในตะกร้า</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>ชื่อสินค้า</TableHead>
                    <TableHead className="text-right">น้ำหนัก (กก.)</TableHead>
                    <TableHead className="text-right">ราคา/กก.</TableHead>
                    <TableHead className="text-right">จำนวนเงิน</TableHead>
                    <TableHead className="w-12 text-center">ลบ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyCartItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="text-center text-gray-500">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right">
                        {formatWeight(item.weight)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatBaht(item.pricePerKg)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-amber-800">
                        {formatBaht(item.totalAmount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => removeBuyCartItem(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-amber-50">
                    <TableCell colSpan={2} className="font-semibold text-amber-900">
                      รวมทั้งหมด
                    </TableCell>
                    <TableCell className="text-right font-semibold text-amber-900">
                      {formatWeight(cartTotalWeight)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-amber-900">
                      {formatBaht(cartTotalAmount)} บาท
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bill Options */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">ตั้งค่าใบรับซื้อ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Date/Time */}
            <div className="space-y-2">
              <Label htmlFor="buy-datetime">วันที่/เวลา</Label>
              <Input
                id="buy-datetime"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
              />
            </div>

            {/* Credit Toggle */}
            <div className="space-y-2">
              <Label htmlFor="buy-credit">ซื้อเชื่อ</Label>
              <div className="flex items-center gap-3 h-9">
                <Switch
                  id="buy-credit"
                  checked={isCredit}
                  onCheckedChange={setIsCredit}
                />
                <span className="text-sm text-gray-600">
                  {isCredit ? 'ซื้อเชื่อ' : 'ซื้อสด'}
                </span>
              </div>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="buy-note">หมายเหตุ (ไม่จำเป็น)</Label>
            <Input
              id="buy-note"
              type="text"
              placeholder="หมายเหตุเพิ่มเติม..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Separator />

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleSubmit}
              disabled={buyCartItems.length === 0 || submitting}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white h-12 text-base font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึกใบรับซื้อ'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                clearBuyCart();
                toast.info('ล้างตะกร้าแล้ว');
              }}
              disabled={buyCartItems.length === 0}
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              ล้างตะกร้า
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
