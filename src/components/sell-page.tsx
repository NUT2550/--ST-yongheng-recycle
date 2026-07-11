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
import { DetailedSellExcelImportDialog } from '@/components/detailed-sell-excel-import-dialog';

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
        const prodData = prodRes as unknown as { products: Product[] };
        setProducts(prodData.products || (prodRes as unknown as Product[]));
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

  const groupedProductsForCombobox = useMemo((): ProductComboboxGroup[] => {
    return groupedProducts.map((group) => ({
      categoryId: group.category.id,
      categoryName: group.category.name,
      products: group.products,
    }));
  }, [groupedProducts]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId),
    [products, selectedProductId]
  );

  // Auto-calculate total for current item
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

  // Estimated source cost (from avgCostPerKg of each product in cart)
  const estimatedSourceCost = useMemo(
    () => sellCartItems.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      const costPerKg = product?.stock?.avgCostPerKg ?? 0;
      return sum + Math.round(item.weight * costPerKg * 100) / 100;
    }, 0),
    [sellCartItems, products]
  );
  const estimatedProfit = cartTotalAmount - estimatedSourceCost;

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

    const availableWeight = selectedProduct?.stock?.totalWeight ?? 0;
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">ขายสินค้า</h2>
          <p className="text-gray-500 mt-1 text-sm">บันทึกรายการขายเหล็กและโลหะ</p>
        </div>
        {sellCartItems.length > 0 && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700">
            <Coins className="h-3.5 w-3.5 mr-1" />
            {sellCartItems.length} รายการ
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
              <CardTitle className="text-base font-semibold">เพิ่มรายการขาย</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {/* Product Select */}
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="sell-product" className="text-xs">สินค้า</Label>
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
                <div className="space-y-1.5">
                  <Label htmlFor="sell-weight" className="text-xs">น้ำหนัก (กก.)</Label>
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
                        document.getElementById('sell-price')?.focus();
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
                  {selectedProduct && (
                    <p className="text-[11px] text-gray-500">
                      สต๊อก: {formatWeight(selectedProduct.stock?.totalWeight ?? 0)}
                    </p>
                  )}
                </div>

                {/* Price per kg */}
                <div className="space-y-1.5">
                  <Label htmlFor="sell-price" className="text-xs">ราคาขาย/กก.</Label>
                  <Input
                    id="sell-price"
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

              {/* ST-18: Detailed Excel Import (replaces old single-bill import) */}
              <div className="mt-3">
                <DetailedSellExcelImportDialog
                  products={availableProducts}
                  onImport={async (bills) => {
                    // ST-18: For each bill, add items to cart with stock validation
                    let totalAdded = 0;
                    let totalBlocked = 0;
                    for (const bill of bills) {
                      const runningWeight = new Map<string, number>();
                      for (const it of bill.items) {
                        const product = products.find((p) => p.id === it.productId);
                        const stockWeight = product?.stock?.totalWeight ?? 0;
                        const inCart = sellCartItems
                          .filter((c) => c.productId === it.productId)
                          .reduce((sum, c) => sum + c.weight, 0);
                        const running = runningWeight.get(it.productId) ?? 0;
                        const totalSoFar = inCart + running;
                        if (totalSoFar + it.weight > stockWeight) {
                          totalBlocked++;
                          toast.error(
                            `สต็อกไม่พอสำหรับ "${it.productName}" — มี ${formatWeight(stockWeight)}, ต้องการ ${formatWeight(it.weight)} — ข้ามรายการ`
                          );
                          continue;
                        }
                        addSellCartItem({
                          productId: it.productId,
                          productName: it.productName,
                          weight: it.weight,
                          weightExpression: undefined,
                          pricePerKg: it.pricePerKg,
                          totalAmount: it.totalAmount,
                          availableWeight: Math.max(0, stockWeight - totalSoFar - it.weight),
                        });
                        runningWeight.set(it.productId, running + it.weight);
                        totalAdded++;
                      }
                      // Set date from first bill
                      if (bill.date) {
                        setDateTime(new Date(bill.date).toISOString().slice(0, 16));
                      }
                    }
                    if (totalAdded > 0) {
                      toast.success(`เพิ่ม ${totalAdded} รายการจาก ${bills.length} บิลแล้ว${totalBlocked > 0 ? ` (ข้าม ${totalBlocked} รายการ — สต็อกไม่พอ)` : ''}`);
                    } else if (totalBlocked > 0) {
                      toast.error(`ไม่สามารถเพิ่มรายการได้ — สต็อกไม่พอทั้ง ${totalBlocked} รายการ`);
                    }
                  }}
                />
              </div>

              {/* Cart (compact) */}
              {sellCartItems.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">รายการในตะกร้า ({sellCartItems.length})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { clearSellCart(); toast.info('ล้างตะกร้าแล้ว'); }}
                      className="text-xs text-red-600 hover:text-red-700 h-6"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      ล้าง
                    </Button>
                  </div>
                  {sellCartItems.map((item, index) => {
                    const product = products.find((p) => p.id === item.productId);
                    const currentStock = product?.stock?.totalWeight ?? 0;
                    const isOverStock = item.weight > currentStock;
                    return (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 rounded-md bg-gray-50 border text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">
                              {item.productName}
                            </span>
                            {isOverStock && (
                              <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0">
                                สต๊อกไม่พอ!
                              </Badge>
                            )}
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
                          onClick={() => removeSellCartItem(index)}
                          className="text-red-600 hover:text-red-700 h-7 w-7 p-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
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
                <span className="font-medium">{sellCartItems.length} รายการ</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">น้ำหนักรวม</span>
                <span className="font-medium">{formatWeight(cartTotalWeight)} กก.</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ยอดขายรวม</span>
                <span className="font-bold text-amber-800">{formatBaht(cartTotalAmount)} บาท</span>
              </div>
              {estimatedSourceCost > 0 && (
                <>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>ต้นทุนต้นทาง (ประมาณ)</span>
                    <span>{formatBaht(estimatedSourceCost)} บาท</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className={estimatedProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                      กำไร/ขาดทุน (ประมาณ)
                    </span>
                    <span className={`font-medium ${estimatedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatBaht(estimatedProfit)} บาท
                    </span>
                  </div>
                </>
              )}

              <Separator />

              {/* Date + Customer + Credit + Note */}
              <div className="grid grid-cols-1 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="sell-datetime" className="text-xs">วันที่/เวลา</Label>
                  <Input
                    id="sell-datetime"
                    type="datetime-local"
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sell-customer" className="text-xs">ลูกค้า</Label>
                  <div className="flex gap-2">
                    <Select value={selectedCustomerId} onValueChange={(val) => {
                      setSelectedCustomerId(val === '__none__' ? '' : val);
                      if (val === '__none__') setIsCredit(false);
                    }}>
                      <SelectTrigger className="flex-1 h-8 text-sm" id="sell-customer">
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
                        <Button variant="outline" size="icon" className="shrink-0 h-8 w-8">
                          <UserPlus className="h-3.5 w-3.5" />
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
                              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> บันทึก...</>
                            ) : 'บันทึก'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sell-credit" className="text-xs">ประเภทการขาย</Label>
                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      id="sell-credit"
                      checked={isCredit}
                      onCheckedChange={setIsCredit}
                      disabled={!selectedCustomerId}
                    />
                    <span className="text-xs text-gray-600">
                      {!selectedCustomerId
                        ? 'เลือกลูกค้าก่อนจึงจะขายเชื่อได้'
                        : isCredit ? 'ขายเชื่อ' : 'ขายสด'}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sell-note" className="text-xs">หมายเหตุ</Label>
                  <Input
                    id="sell-note"
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
                disabled={submitting || sellCartItems.length === 0}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><Coins className="h-4 w-4 mr-1" /> บันทึกใบขาย</>
                )}
              </Button>
              {sellCartItems.length === 0 && (
                <p className="text-[11px] text-amber-600 text-center">เพิ่มรายการก่อนบันทึก</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Empty state */}
      {sellCartItems.length === 0 && !selectedProductId && (
        <Card>
          <CardContent className="p-8 text-center text-gray-400 text-sm">
            <Coins className="h-10 w-10 mx-auto mb-2 opacity-40" />
            เลือกสินค้าและเพิ่มรายการขายเพื่อเริ่ม
          </CardContent>
        </Card>
      )}
    </div>
  );
}
