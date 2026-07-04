# Weight Formula Tracking — Migration Proposal

> วันที่: 27/06/2569
> สถานะ: **รอ Owner อนุมัติ** — ห้าม run migration จนกว่าจะได้รับอนุมัติ

---

## สรุปการเปลี่ยนแปลง

เพิ่ม field `weightExpression` (nullable String) ในทุกตารางที่เก็บน้ำหนัก:
- `BuyBillItem.weightExpression`
- `SellBillItem.weightExpression`
- `SortingBillItem.weightExpression`
- `SortingBill.sourceWeightExpression`
- `SortingBill.weighedTotalExpression`

---

## 1. Database Changes (Prisma Schema)

ไฟล์: `prisma/schema.prisma` — **แก้ไขแล้ว**

```prisma
model BuyBillItem {
  // ... existing fields ...
  weight           Float
  weightExpression String? // สูตรที่ผู้ใช้พิมพ์ เช่น "860-3" (null = กรอกตัวเลขตรงๆ)
  // ... rest ...
}

model SellBillItem {
  // ... existing fields ...
  weight           Float
  weightExpression String?  // สูตรที่ผู้ใช้พิมพ์
  // ... rest ...
}

model SortingBill {
  // ... existing fields ...
  sourceWeight           Float
  sourceWeightExpression String?           // สูตรน้ำหนักต้นทาง เช่น "68.4-0.2"
  // ...
  weighedTotal           Float             @default(0)
  weighedTotalExpression String?           // สูตรน้ำหนักชั่งรวม
  // ... rest ...
}

model SortingBillItem {
  // ... existing fields ...
  weight           Float
  weightExpression String?      // สูตรน้ำหนักที่คัดแยกได้ เช่น "22-0.2"
  // ... rest ...
}
```

### Migration Command (ห้ามรันจนกว่าจะอนุมัติ)
```bash
bun run db:push
# หรือ
npx prisma migrate dev --name add_weight_expression
```

### Migration Nature
- **เพิ่ม column ใหม่** ทั้งหมด 5 คอลัมน์ ที่เป็น nullable String
- **ไม่กระทบข้อมูลเดิม** — ทุกรายการที่มีอยู่จะมีค่า `null` (treated as plain number)
- **Backward compatible** — code ทั้งหมดที่ใช้ `weight` ยังทำงานเหมือนเดิม

---

## 2. UI Changes

### หน้ารับซื้อ (buy-page.tsx)
- **Live preview**: ขณะพิมพ์ `860-3` แสดง `= 857.00 กก.` สีเขียวทันทีใต้ input
- **Enter ไม่เปลี่ยน input**: input ยังแสดง `860-3` (ไม่ replace เป็น 857)
- **Cart table**: แสดง `857.00 กก.` บรรทัดหลัก + `จาก 860-3` บรรทัดล่างสีเทา (เฉพาะกรณีเป็นจริง ๆ)
- **Toast confirmation**: เพิ่ม `(จาก 860-3)` ในข้อความ success

### หน้าขาย (sell-page.tsx)
- Live preview + formula display เหมือน buy-page

### หน้าคัดแยก (sort-page.tsx)
- Live preview สำหรับ **3 ช่อง**: source weight, weighed total, item weight
- Cart table แสดง formula ใต้น้ำหนักของแต่ละ item

### หน้าประวัติ (history-page.tsx)
- **ทุก bill type**: แสดง weight + formula (ถ้ามี) ในรายละเอียด bill
- Sorting bill header: แสดง source weight + formula ในบรรทัด "จาก: ..."
- Sorting bill expanded: แสดง weighedTotal + formula

---

## 3. API Changes

### `/api/buy-bills` POST
- รับ `items[].weightExpression?: string` (optional)
- เก็บใน `BuyBillItem.weightExpression`
- Audit log `details.itemFormulas[]` เก็บสูตรทั้งหมด

### `/api/sell-bills` POST
- รับ `items[].weightExpression?: string`
- เก็บใน `SellBillItem.weightExpression`
- Audit log `details.itemFormulas[]`

### `/api/sorting-bills` POST
- รับ `sourceWeightExpression?: string`
- รับ `weighedTotalExpression?: string`
- รับ `items[].weightExpression?: string`
- เก็บในฟิลด์ที่เกี่ยวข้องของ SortingBill และ SortingBillItem
- Audit log `details.sourceWeightExpression` + `details.itemFormulas[]`

### Server-side Validation
- ตรวจสอบว่า `weightExpression` (ถ้ามี) เป็นสูตรที่ถูกต้อง
- ถ้าส่งมาแต่ไม่ valid → ไม่ fail แต่เก็บเป็น null (safe fallback)
- ผู้ใช้กรอกตัวเลขตรง ๆ → `weightExpression = null` (ไม่เปลืองพื้นที่ DB)

---

## 4. AuditLog

AuditLog model **ไม่ต้องเพิ่ม field** — เก็บสูตรใน `details` (JSON string) ภายใต้ key `itemFormulas`:

```json
{
  "billNumber": "BUY-2569-00012",
  "totalAmount": 25710,
  "itemCount": 3,
  "itemFormulas": [
    {
      "productId": "prod_abc",
      "weightExpression": "860-3",
      "weight": 857
    },
    {
      "productId": "prod_xyz",
      "weightExpression": "(1000-10)/2",
      "weight": 495
    }
  ]
}
```

---

## 5. พร้อม Migration หรือไม่?

### ✅ พร้อม
- Prisma schema แก้ไขแล้ว
- ทุก API route รับ + เก็บ weightExpression แล้ว
- ทุก UI แสดง live preview + formula แล้ว
- ทุก history page แสดง formula แล้ว
- TypeScript types ครบถ้วน
- Lint ผ่าน (exit code 0)

### ⚠️ ข้อควรทราบ
- **ยังไม่ run migration** — schema ใน DB ยังไม่มี column ใหม่
- หากรัน dev server และ save bill ตอนนี้ → API จะ fail เพราะ Prisma ส่ง field ที่ DB ไม่มี
- **ต้อง run `bun run db:push` ก่อน** จึงจะใช้งานได้จริง

### 🚫 ข้อจำกัด (ตามคำสั่ง owner)
- ห้าม migration จนกว่า owner อนุมัติ
- ห้าม deploy โดยไม่ได้รับอนุญาต
- ห้าม seed/reset database

---

## 6. ขั้นต่อไป

1. **Owner อนุมัติ migration**
2. Run `bun run db:push` (เพิ่ม 5 column ใหม่ใน SQLite/Supabase)
3. ทดสอบ end-to-end:
   - กรอก `860-3` ใน buy page → บันทึก → ดูใน history → ต้องเห็น "857.00 กก." + "จาก 860-3"
4. ทดสอบ sell page, sort page เหมือนกัน
5. Commit + push (ถ้า owner อนุมัติ deploy)

---

## 7. ไฟล์ที่แก้ไขทั้งหมด

| ไฟล์ | การเปลี่ยนแปลง |
|------|---------------|
| `prisma/schema.prisma` | เพิ่ม 5 weightExpression fields |
| `src/lib/safe-math.ts` | เพิ่ม `formulaHint()` + `previewWeightValue()` helpers |
| `src/lib/types.ts` | เพิ่ม weightExpression ใน types ทั้งหมด |
| `src/app/api/buy-bills/route.ts` | รับ + เก็บ weightExpression + audit log |
| `src/app/api/sell-bills/route.ts` | รับ + เก็บ weightExpression + audit log |
| `src/app/api/sorting-bills/route.ts` | รับ + เก็บ 3 expressions + audit log |
| `src/components/buy-page.tsx` | Live preview + formula display |
| `src/components/sell-page.tsx` | Live preview + formula display |
| `src/components/sort-page.tsx` | Live preview + formula display (3 inputs) |
| `src/components/history-page.tsx` | แสดง formula ในทุก bill type |

**ไม่แก้ไข:**
- `bill-helpers.ts` (audit log ใช้ `details` string อยู่แล้ว)
- Excel import logic (ตามคำสั่ง owner ห้ามแก้ตอนนี้)
