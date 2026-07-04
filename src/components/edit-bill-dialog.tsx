'use client';

import * as React from 'react';
import { Pencil, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProductCombobox, ProductComboboxGroup } from '@/components/ui/product-combobox';
import { Product, BuyBill, SellBill, SortingBill } from '@/lib/types';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { updateBuyBill, updateSellBill, updateSortingBill } from '@/lib/api';
import { toast } from 'sonner';

type BillType = 'buy' | 'sell' | 'sort';

interface EditBillDialogProps {
  bill: BuyBill | SellBill | SortingBill;
  billType: BillType;
  products: Product[];
  groupedProducts: ProductComboboxGroup[];
  onSaved: () => void;
}

export function EditBillDialog({
  bill,
  billType,
  products,
  groupedProducts,
  onSaved,
}: EditBillDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Common bill-level fields
  const initialDate = (() => {
    const d = new Date(bill.date);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  })();
  const [date, setDate] = React.useState(initialDate);
  const [note, setNote] = React.useState(bill.note || '');
  const [isCredit, setIsCredit] = React.useState(
    'isCredit' in bill ? bill.isCredit : false
  );

  // Buy bill items — fully editable (weight, price, product, add, remove)
  const [buyItems, setBuyItems] = React.useState<
    Array<{
      id?: string;
      productId: string;
      weight: number;
      pricePerKg: number;
    }>
  >(
    billType === 'buy'
      ? (bill as BuyBill).items.map((i) => ({
          id: i.id,
          productId: i.productId,
          weight: i.weight,
          pricePerKg: i.pricePerKg,
        }))
      : []
  );

  // Sell bill items — only price editable
  const [sellItemPrices, setSellItemPrices] = React.useState<
    Record<string, string>
  >(
    billType === 'sell'
      ? Object.fromEntries(
          (bill as SellBill).items.map((i) => [i.id, String(i.pricePerKg)])
        )
      : {}
  );

  // Sorting bill items — only sortedPrice editable
  const [sortItemPrices, setSortItemPrices] = React.useState<
    Record<string, string>
  >(
    billType === 'sort'
      ? Object.fromEntries(
          (bill as SortingBill).items.map((i) => [i.id, String(i.sortedPricePerKg)])
        )
      : {}
  );

  const reset = () => {
    setDate(initialDate);
    setNote(bill.note || '');
    setIsCredit('isCredit' in bill ? bill.isCredit : false);
    if (billType === 'buy') {
      setBuyItems(
        (bill as BuyBill).items.map((i) => ({
          id: i.id,
          productId: i.productId,
          weight: i.weight,
          pricePerKg: i.pricePerKg,
        }))
      );
    } else if (billType === 'sell') {
      setSellItemPrices(
        Object.fromEntries(
          (bill as SellBill).items.map((i) => [i.id, String(i.pricePerKg)])
        )
      );
    } else {
      setSortItemPrices(
        Object.fromEntries(
          (bill as SortingBill).items.map((i) => [i.id, String(i.sortedPricePerKg)])
        )
      );
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (billType === 'buy') {
        // Validate
        for (const item of buyItems) {
          if (!item.productId) {
            toast.error('กรุณาเลือกสินค้าให้ครบ');
            setSaving(false);
            return;
          }
          if (item.weight <= 0) {
            toast.error('น้ำหนักต้องมากกว่า 0');
            setSaving(false);
            return;
          }
        }
        await updateBuyBill(bill.id, {
          date: new Date(date).toISOString(),
          isCredit,
          note: note.trim() || null,
          items: buyItems.map((i) => ({
            id: i.id,
            productId: i.productId,
            weight: i.weight,
            pricePerKg: i.pricePerKg,
          })),
        });
      } else if (billType === 'sell') {
        const items = (bill as SellBill).items.map((i) => ({
          id: i.id,
          pricePerKg: parseFloat(sellItemPrices[i.id] || '0'),
        }));
        for (const item of items) {
          if (!item.pricePerKg || item.pricePerKg <= 0) {
            toast.error('ราคาขายต้องมากกว่า 0');
            setSaving(false);
            return;
          }
        }
        await updateSellBill(bill.id, {
          date: new Date(date).toISOString(),
          isCredit,
          note: note.trim() || null,
          items,
        });
      } else {
        // sort
        const items = (bill as SortingBill).items
          .filter((i) => !i.isWaste)
          .map((i) => ({
            id: i.id,
            sortedPricePerKg: parseFloat(sortItemPrices[i.id] || '0'),
          }));
        await updateSortingBill(bill.id, {
          date: new Date(date).toISOString(),
          note: note.trim() || null,
          items,
        });
      }
      toast.success('บันทึกการแก้ไขสำเร็จ');
      setOpen(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`แก้ไขไม่สำเร็จ: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          แก้ไข
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>
            แก้ไข{billType === 'buy' ? 'ใบรับซื้อ' : billType === 'sell' ? 'ใบขาย' : 'ใบคัดแยก'}
          </DialogTitle>
          <DialogDescription>
            บิล #{bill.id.slice(-8)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Common: Date + Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-date">วันที่/เวลา</Label>
              <Input
                id="edit-date"
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-note">หมายเหตุ</Label>
              <Input
                id="edit-note"
                type="text"
                placeholder="หมายเหตุ (ไม่จำเป็น)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* Buy/Sell: Credit toggle */}
          {(billType === 'buy' || billType === 'sell') && (
            <div className="flex items-center gap-3">
              <Switch
                checked={isCredit}
                onCheckedChange={setIsCredit}
                id="edit-credit"
              />
              <Label htmlFor="edit-credit" className="cursor-pointer">
                {isCredit ? 'เครดิต' : 'สด'}
              </Label>
            </div>
          )}

          {/* Items editor — different per bill type */}
          {billType === 'buy' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>รายการสินค้า</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBuyItems((prev) => [
                      ...prev,
                      { productId: '', weight: 0, pricePerKg: 0 },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  เพิ่มรายการ
                </Button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto border rounded-md p-2">
                {buyItems.map((item, idx) => {
                  const product = products.find((p) => p.id === item.productId);
                  const itemTotal = item.weight * item.pricePerKg;
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-end p-2 rounded border bg-gray-50"
                    >
                      <div className="col-span-12 sm:col-span-5 space-y-1">
                        <Label className="text-xs text-gray-500">สินค้า</Label>
                        <ProductCombobox
                          groups={groupedProducts}
                          value={item.productId}
                          onValueChange={(v) =>
                            setBuyItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, productId: v } : it
                              )
                            )
                          }
                          placeholder="เลือกสินค้า"
                          searchPlaceholder="ค้นหา..."
                          renderLabel={(p) => `${p.name}`}
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2 space-y-1">
                        <Label className="text-xs text-gray-500">น้ำหนัก</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.weight || ''}
                          onChange={(e) =>
                            setBuyItems((prev) =>
                              prev.map((it, i) =>
                                i === idx
                                  ? { ...it, weight: parseFloat(e.target.value) || 0 }
                                  : it
                              )
                            )
                          }
                          className="h-8"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2 space-y-1">
                        <Label className="text-xs text-gray-500">ราคา/กก.</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.pricePerKg || ''}
                          onChange={(e) =>
                            setBuyItems((prev) =>
                              prev.map((it, i) =>
                                i === idx
                                  ? { ...it, pricePerKg: parseFloat(e.target.value) || 0 }
                                  : it
                              )
                            )
                          }
                          className="h-8"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-2 space-y-1">
                        <Label className="text-xs text-gray-500">รวม</Label>
                        <div className="text-sm font-semibold h-8 flex items-center">
                          {formatBaht(itemTotal)}
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-red-50"
                          onClick={() =>
                            setBuyItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {product && item.weight > 0 && (
                        <div className="col-span-12 text-xs text-gray-500">
                          สต๊อกปัจจุบัน: {formatWeight(product.stock?.totalWeight ?? 0)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {buyItems.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-4">
                    ยังไม่มีรายการ
                  </p>
                )}
              </div>
            </div>
          )}

          {billType === 'sell' && (
            <div className="space-y-2">
              <Label>รายการขาย (แก้ไขได้เฉพาะราคา)</Label>
              <div className="space-y-2 max-h-80 overflow-y-auto border rounded-md p-2">
                {(bill as SellBill).items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 gap-2 items-center p-2 rounded border bg-gray-50"
                  >
                    <div className="col-span-5">
                      <p className="font-medium text-sm">{item.product.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatWeight(item.weight)} · ต้นทุน {formatBaht(item.costPerKg)}/กก.
                      </p>
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <Label className="text-xs text-gray-500">ราคาขาย/กก.</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={sellItemPrices[item.id] || ''}
                        onChange={(e) =>
                          setSellItemPrices((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-4 text-right">
                      <p className="text-xs text-gray-500">รวม</p>
                      <p className="font-semibold text-sm">
                        {formatBaht(
                          item.weight * parseFloat(sellItemPrices[item.id] || '0')
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                ⚠️ ถ้าต้องการเปลี่ยนน้ำหนักหรือสินค้า ให้ลบบิลนี้แล้วสร้างใหม่
              </p>
            </div>
          )}

          {billType === 'sort' && (
            <div className="space-y-2">
              <Label>รายการคัดแยก (แก้ไขได้เฉพาะราคารับซื้อ)</Label>
              <div className="space-y-2 max-h-80 overflow-y-auto border rounded-md p-2">
                {(bill as SortingBill).items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 gap-2 items-center p-2 rounded border bg-gray-50"
                  >
                    <div className="col-span-5">
                      <p className="font-medium text-sm">
                        {item.product.name}
                        {item.isWaste && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">ขยะ</Badge>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatWeight(item.weight)}
                      </p>
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <Label className="text-xs text-gray-500">ราคารับซื้อ/กก.</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={sortItemPrices[item.id] || ''}
                        onChange={(e) =>
                          setSortItemPrices((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        disabled={item.isWaste}
                        className="h-8"
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-4 text-right">
                      <p className="text-xs text-gray-500">โบนัส</p>
                      <p className="font-semibold text-sm text-pink-700">
                        {formatBaht(item.bonusAmount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                ⚠️ ถ้าต้องการเปลี่ยนน้ำหนักหรือสินค้า ให้ลบบิลนี้แล้วสร้างใหม่
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
