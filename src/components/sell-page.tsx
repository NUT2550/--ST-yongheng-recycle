'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { fetchProducts, fetchCustomers, createSellBill, createCustomer } from '@/lib/api';
import {
  formatBaht,
  formatWeight,
  getCurrentDateForInput,
  calculateCartTotal,
  calculateCartWeight,
} from '@/lib/helpers';
import { Product, Customer, SellCartItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Coins, Plus, Trash2, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { parseWeightExpression, previewWeightValue, formulaHint } from '@/lib/safe-math';

export function SellPage() {
  const {
    sellCartItems,
    addSellCartItem,
    removeSellCartItem,
    clearSellCart,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [pricePerKg, setPricePerKg] = useState<string>('');
  const [dateTime, setDateTime] = useState<string>(getCurrentDateForInput());
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [isCredit, setIsCredit] = useState(false);
  const [note, setNote] = useState<string>('');

  // Customer dialog state
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState<string>('');
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Fetch products and customers on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [prodRes, custRes] = await Promise.all([
          fetchProducts(),
          fetchCustomers(),
        ]);
        // Products API returns { products: Product[] }
        const prodData = prodRes as unknown as { products: Product[] };
        setProducts(prodData.products || (prodRes as unknown as Product[]));
        // Customers API returns { customers: Customer[] }
        const custData = custRes as unknown as { customers: Customer[] };
        setCustomers(custData.customers || (custRes as unknown as Customer[]));
      } catch {
        toast.error('ไม่สามารถโหลดข้อมูลได้');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Filter products with stock > 0
  const availableProducts = useMemo(
    () => products.filter((p) => (p.stock?.totalWeight ?? 0) > 0),
    [products]
  );

  // Group available products by category
  const groupedProducts = useMemo(() => {
    const groups: Record<string, { category: Product['category']; products: Product[] }> = {};
    for (const product of availableProducts) {
      const catId = product.category.id;
      if (!groups[catId]) {
        groups[catId] = { category: product.category, products: [] };
      }
      groups[catId].products.push(product);
    }
    return Object.values(groups).sort(
      (a, b) => a.category.sortOrder - b.category.sortOrder
    );
  }, [availableProducts]);

  // Grouped products for combobox
  const groupedProductsForCombobox = useMemo((): ProductComboboxGroup[] => {
    return groupedProducts.map((group) => ({
      categoryId: group.category.id,
      categoryName: group.category.name,
      products: group.products,
    }));
  }, [groupedProducts]);

  // Selected product details
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [products, selectedProductId]
  );

  // Auto-calculate total
  const totalAmount = useMemo(() => {
    const result = parseWeightExpression(weight);
    const w = result.error ? 0 : result.value;
    const p = parseFloat(pricePerKg) || 0;
    return w * p;
  }, [weight, pricePerKg]);

  // Cart totals
  const cartTotalWeight = useMemo(
    () => calculateCartWeight(sellCartItems),
    [sellCartItems]
  );
  const cartTotalAmount = useMemo(
    () => calculateCartTotal(sellCartItems),
    [sellCartItems]
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

    // Validate stock
    const availableWeight = selectedProduct?.stock?.totalWeight ?? 0;
    // Check total weight in cart for this product + new weight
    const currentCartWeight = sellCartItems
      .filter((item) => item.productId === selectedProductId)
      .reduce((sum, item) => sum + item.weight, 0);

    if (currentCartWeight + w > availableWeight) {
      toast.error(
        `สต๊อกไม่เพียงพอ! มี ${formatWeight(availableWeight)}, ในตะกร้า ${formatWeight(currentCartWeight)}, ต้องการเพิ่ม ${formatWeight(w)}`
      );
      return;
    }

    const item: SellCartItem = {
      productId: selectedProductId,
      productName: selectedProduct?.name || '',
      weight: w,
      weightExpression: weightResult.isFormula ? weightResult.expression : undefined,
      pricePerKg: p,
      totalAmount: w * p,
      availableWeight: availableWeight - currentCartWeight - w,
    };

    addSellCartItem(item);
    setSelectedProductId('');
    setWeight('');
    setPricePerKg('');
    const formulaHintStr = weightResult.isFormula ? ` (จาก ${weightResult.expression})` : '';
    toast.success(`เพิ่ม "${item.productName}" ลงตะกร้าแล้ว${formulaHintStr}`);
  };

  // Create customer
  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim()) {
      toast.error('กรุณากรอกชื่อลูกค้า');
      return;
    }
    setCreatingCustomer(true);
    try {
      const result = await createCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
      });
      const custData = result as unknown as { customer: Customer };
      const newCust = custData.customer || (result as unknown as Customer);
      setCustomers((prev) => [...prev, newCust]);
      setSelectedCustomerId(newCust.id);
      setCustomerDialogOpen(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      toast.success(`เพิ่มลูกค้า "${newCust.name}" สำเร็จ`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`เพิ่มลูกค้าไม่สำเร็จ: ${message}`);
    } finally {
      setCreatingCustomer(false);
    }
  };

  // Submit bill
  const handleSubmit = async () => {
    if (sellCartItems.length === 0) {
      toast.error('ตะกร้าว่าง กรุณาเพิ่มรายการก่อน');
      return;
    }

    if (isCredit && !selectedCustomerId) {
      toast.error('กรุณาเลือกลูกค้าเพื่อขายเชื่อ');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSellBill({
        date: new Date(dateTime).toISOString(),
        customerId: selectedCustomerId || undefined,
        isCredit,
        note: note || undefined,
        items: sellCartItems.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          pricePerKg: item.pricePerKg,
        })),
      });

      const billData = result as unknown as {
        bill: { totalAmount: number; totalCost: number };
      };
      const bill = billData.bill;
      const totalAmt = bill?.totalAmount ?? cartTotalAmount;
      const totalCost = bill?.totalCost ?? 0;

      clearSellCart();
      setDateTime(getCurrentDateForInput());
      setSelectedCustomerId('');
      setIsCredit(false);
      setNote('');

      toast.success(
        `บันทึกใบขายสำเร็จ! ยอดขาย ${formatBaht(totalAmt)} บาท | ต้นทุน FIFO ${formatBaht(totalCost)} บาท`
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
          <h2 className="text-2xl font-bold text-gray-900">ขายสินค้า</h2>
          <p className="text-gray-500 mt-1">บันทึกรายการขายเหล็กและโลหะ</p>
        </div>
        {sellCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700">
            <Coins className="h-3.5 w-3.5 mr-1" />
            {sellCartItems.length} รายการ
          </Badge>
        )}
      </div>

      {/* Add Item Form */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">เพิ่มรายการขาย</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Product Select */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="sell-product">สินค้า</Label>
              <ProductCombobox
                groups={groupedProductsForCombobox}
                value={selectedProductId}
                onValueChange={setSelectedProductId}
                placeholder="เลือกสินค้า"
                searchPlaceholder="พิมพ์ค้นหาสินค้า..."
                id="sell-product"
                renderLabel={(product) => `${product.name} (${formatWeight(product.stock?.totalWeight ?? 0)}) - ${formatBaht(product.defaultBuyPrice)}/กก.`}
                onSelect={() => document.getElementById('sell-weight')?.focus()}
              />
            </div>

            {/* Weight */}
            <div className="space-y-2">
              <Label htmlFor="sell-weight">น้ำหนัก (กก.)</Label>
              <Input
                id="sell-weight"
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
                    document.getElementById('sell-price')?.focus();
                  }
                }}
              />
              {/* Live preview: แสดงผลลัพธ์ทันทีขณะพิมพ์ */}
              {weight.trim() && (() => {
                const preview = previewWeightValue(weight);
                if (preview === null) return null;
                return (
                  <p className="text-xs text-emerald-700 font-medium">
                    = {preview.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} กก.
                  </p>
                );
              })()}
              {selectedProduct && weight.trim() && (
                <p className="text-xs text-gray-500">
                  มีสต๊อก: {formatWeight(selectedProduct.stock?.totalWeight ?? 0)}
                </p>
              )}
            </div>

            {/* Price per kg */}
            <div className="space-y-2">
              <Label htmlFor="sell-price">ราคาขาย/กก.</Label>
              <Input
                id="sell-price"
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
          {sellCartItems.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Coins className="h-12 w-12 mx-auto mb-2 opacity-30" />
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
                    <TableHead className="text-right">สต๊อกคงเหลือ</TableHead>
                    <TableHead className="w-12 text-center">ลบ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sellCartItems.map((item, index) => {
                    const product = products.find((p) => p.id === item.productId);
                    const currentStock = product?.stock?.totalWeight ?? 0;
                    const isOverStock = item.weight > currentStock;
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
                        <TableCell className="text-right">
                          {formatBaht(item.pricePerKg)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-amber-800">
                          {formatBaht(item.totalAmount)}
                        </TableCell>
                        <TableCell className={`text-right ${isOverStock ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          {formatWeight(currentStock)}
                          {isOverStock && (
                            <span className="ml-1 text-xs">(ไม่พอ!)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => removeSellCartItem(index)}
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
                      {formatWeight(cartTotalWeight)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-amber-900">
                      {formatBaht(cartTotalAmount)} บาท
                    </TableCell>
                    <TableCell />
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
          <CardTitle className="text-base font-semibold">ตั้งค่าใบขาย</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Date/Time */}
            <div className="space-y-2">
              <Label htmlFor="sell-datetime">วันที่/เวลา</Label>
              <Input
                id="sell-datetime"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
              />
            </div>

            {/* Customer Selection */}
            <div className="space-y-2">
              <Label htmlFor="sell-customer">ลูกค้า</Label>
              <div className="flex gap-2">
                <Select value={selectedCustomerId} onValueChange={(val) => {
                  setSelectedCustomerId(val === '__none__' ? '' : val);
                  if (val === '__none__') {
                    setIsCredit(false);
                  }
                }}>
                  <SelectTrigger className="flex-1" id="sell-customer">
                    <SelectValue placeholder="— ไม่ระบุ —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                        {customer.phone ? ` (${customer.phone})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0">
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>เพิ่มลูกค้าใหม่</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="new-customer-name">ชื่อลูกค้า *</Label>
                        <Input
                          id="new-customer-name"
                          type="text"
                          placeholder="ชื่อ-นามสกุล"
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-customer-phone">เบอร์โทร (ไม่จำเป็น)</Label>
                        <Input
                          id="new-customer-phone"
                          type="text"
                          placeholder="0XX-XXX-XXXX"
                          value={newCustomerPhone}
                          onChange={(e) => setNewCustomerPhone(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">ยกเลิก</Button>
                      </DialogClose>
                      <Button
                        onClick={handleCreateCustomer}
                        disabled={creatingCustomer}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        {creatingCustomer ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            บันทึก...
                          </>
                        ) : (
                          'บันทึก'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>

          {/* Credit Toggle */}
          <div className="space-y-2">
            <Label htmlFor="sell-credit">ขายเชื่อ</Label>
            <div className="flex items-center gap-3 h-9">
              <Switch
                id="sell-credit"
                checked={isCredit}
                onCheckedChange={setIsCredit}
                disabled={!selectedCustomerId}
              />
              <span className="text-sm text-gray-600">
                {!selectedCustomerId
                  ? 'เลือกลูกค้าก่อนจึงจะขายเชื่อได้'
                  : isCredit
                    ? 'ขายเชื่อ'
                    : 'ขายสด'}
              </span>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="sell-note">หมายเหตุ (ไม่จำเป็น)</Label>
            <Input
              id="sell-note"
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
              disabled={sellCartItems.length === 0 || submitting}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white h-12 text-base font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                'บันทึกใบขาย'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                clearSellCart();
                toast.info('ล้างตะกร้าแล้ว');
              }}
              disabled={sellCartItems.length === 0}
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
