'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface ConfirmBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billType: 'buy' | 'sell' | 'sort';
  itemCount: number;
  totalWeight: number;
  totalAmount: number;
  onConfirm: () => void;
  submitting: boolean;
}

const billTypeLabel: Record<string, string> = {
  buy: 'รับซื้อ',
  sell: 'ขาย',
  sort: 'คัดแยก',
};

export function ConfirmBillDialog({
  open,
  onOpenChange,
  billType,
  itemCount,
  totalWeight,
  totalAmount,
  onConfirm,
  submitting,
}: ConfirmBillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[90vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            ยืนยันการสร้างบิล{billTypeLabel[billType]}
          </DialogTitle>
          <DialogDescription>
            กรุณาตรวจสอบข้อมูลก่อนยืนยัน — ไม่สามารถแก้ไขน้ำหนักได้หลังบันทึก
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">ประเภทบิล</span>
            <span className="font-semibold">{billTypeLabel[billType]}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">จำนวนรายการ</span>
            <span className="font-semibold">{itemCount} รายการ</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-600">น้ำหนักรวม</span>
            <span className="font-semibold">{totalWeight.toLocaleString('th-TH', { maximumFractionDigits: 2 })} กก.</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
            <span className="text-sm text-amber-800">ยอดรวม</span>
            <span className="font-bold text-amber-900 text-lg">
              {totalAmount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                ยืนยันสร้างบิล
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
