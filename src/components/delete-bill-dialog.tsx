'use client';

import * as React from 'react';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getAuthToken } from '@/lib/api';
import { toast } from 'sonner';

type BillType = 'buy' | 'sell' | 'sort';

interface DeleteBillDialogProps {
  billId: string;
  billType: BillType;
  billLabel: string; // e.g. "20/06/2569 10:00 · 1,500 บาท"
  onDeleted: () => void;
}

export function DeleteBillDialog({
  billId,
  billType,
  billLabel,
  onDeleted,
}: DeleteBillDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const token = getAuthToken();
      const endpoint =
        billType === 'buy' ? `/api/buy-bills/${billId}` :
        billType === 'sell' ? `/api/sell-bills/${billId}` :
        `/api/sorting-bills/${billId}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ลบไม่สำเร็จ');
        return;
      }
      toast.success('ลบบิลแล้ว');
      setOpen(false);
      onDeleted();
    } catch {
      toast.error('เกิดข้อผิดพลาดในการลบ');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          ลบ
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-5 w-5" />
            ยืนยันการลบบิล
          </DialogTitle>
          <DialogDescription className="pt-2">
            คุณกำลังจะลบบิล{billType === 'buy' ? 'รับซื้อ' : billType === 'sell' ? 'ขาย' : 'คัดแยก'}:
            <br />
            <strong className="text-gray-900">{billLabel}</strong>
            <br /><br />
            การกระทำนี้จะลบบิลนี้พร้อมทุกรายการสินค้า สต๊อกที่เกี่ยวข้อง และรายการเครดิต
            <strong className="block mt-2 text-red-700">ไม่สามารถยกเลิกได้!</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setOpen(false)}
            disabled={deleting}
          >
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                กำลังลบ...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-1" />
                ลบบิล
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
