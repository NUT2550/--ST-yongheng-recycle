# Business Rules — ยงเฮง มหาชัย รีไซเคิล

> กฎธุรกิจที่ระบบต้องปฏิบัติตาม — สำคัญมาก ห้ามละเว้น
> วันที่: 27/06/2569

---

## 1. Bill Number Format

> ⚠️ **Status**: กฎนี้ถูกออกแบบไว้ใน Task ก่อนหน้า แต่ `billNumber` field หายไปจาก codebase ปัจจุบัน — ต้อง recreate ก่อนใช้งาน

รูปแบบ: `{TYPE}-{BUDDHIST_YEAR}-{SEQUENCE_5_DIGITS}`

| ตัวอย่าง | ความหมาย |
|---------|---------|
| `BUY-2569-00001` | ใบรับซื้อ ลำดับที่ 1 ของปี 2569 |
| `SELL-2569-00012` | ใบขาย ลำดับที่ 12 ของปี 2569 |
| `SORT-2569-00003` | ใบคัดแยก ลำดับที่ 3 ของปี 2569 |

### กฎ
- ปีใช้ **พุทธศักราช** (ค.ศ. + 543)
- Sequence นับใหม่ทุกปี (รีเซ็ตเมื่อขึ้นปีใหม่)
- Sequence มี 5 หลัก (zero-padded)
- นับจากจำนวน bill ทั้งหมดในปีนั้น + 1
- ต้อง unique (schema constraint `@unique`)

---

## 2. Bill Cancel Behavior

> ⚠️ **Status**: Cancel feature หายไปจาก codebase ปัจจุบัน — ต้อง recreate

### BuyBill Cancel
- ใช้ `DELETE /api/buy-bills/{id}` + body `{"reason": "..."}`
- Soft delete: ตั้ง `isCancelled = true`, `cancelledAt`, `cancelledBy`, `cancelReason`
- **Stock restore**:
  - ตรวจ StockLot ที่ `source = "BUY"` AND `sourceId = bill.id`
  - คำนวณ `consumedWeight = totalOriginal - totalRemaining`
  - ถ้า consumed > 0 → throw error "ไม่สามารถ cancel ได้ เพราะ stock ถูกใช้ไปแล้ว"
  - ถ้า consumed = 0 → ลบ StockLot ทั้งหมดที่ sourceId = bill.id
- **AuditLog**: เขียน entry `action="CANCEL"` `entityType="BUY_BILL"` พร้อม `restoredWeight`

### SellBill Cancel
- ใช้ `DELETE /api/sell-bills/{id}` + body `{"reason": "..."}`
- Soft delete
- **Stock restore**:
  - For each SellBillItem: create new StockLot
    - `productId = item.productId`
    - `remainingWeight = item.weight`
    - `costPerKg = item.costPerKg` (ใช้ costPerKg เดิมที่คำนวณด้วย FIFO)
    - `source = "SELL_CANCEL"`
    - `sourceId = bill.id`
- **CreditEntry**: ถ้า isCredit → ลบ CreditEntry ที่ referenceId = bill.id (หรือ mark isSettled)
- **AuditLog**: CANCEL entry + `restoredWeight`

### SortingBill Cancel
- ใช้ `DELETE /api/sorting-bills/{id}` + body `{"reason": "..."}`
- Soft delete
- **Source stock restore**:
  - Create new StockLot:
    - `productId = bill.sourceProductId`
    - `remainingWeight = bill.sourceWeight`
    - `costPerKg = sourceCostPerKg` (จาก SortingBillItem แรกที่ไม่ใช่ waste)
    - `source = "SORT_CANCEL"`
    - `sourceId = bill.id`
- **Output stock — LEFT UNTOUCHED BY DESIGN** 🚨
  - ไม่ restore สต็อก output เพราะอาจถูกขายต่อไปแล้ว (downstream sales)
  - ห้ามลบ StockLot ที่ source = "SORTING" และ sourceId = bill.id โดยอัตโนมัติ
  - ถ้า owner ต้องการลบ manual → ใช้ SQL Editor เท่านั้น
- **SortingBonus**: ลบ SortingBonus ที่ sortingBillId = bill.id
- **AuditLog**: CANCEL entry + `restoredSourceWeight`

---

## 3. Product Category Rules (Cross-Category Prohibition)

> ⚠️ **Status**: กฎนี้ใช้สำหรับ product alias mapping (feature ที่หายไปจาก codebase) — ต้อง recreate ก่อนใช้งาน

### หลักการ
**คนละหมวดวัสดุ = คนละสินค้า ห้าม auto-match ข้ามหมวด**

### หมวดวัสดุทั้งหมด (7 หมวด)
1. เหล็ก (STEEL)
2. ทองแดง (METAL)
3. ทองเหลือง (METAL)
4. แสตนเลส (METAL)
5. อลูมีเนียม (METAL)
6. ตะกั่ว (METAL)
7. อื่นๆ (METAL)

### กฎเฉพาะ (จาก owner)

#### Rule 1: กระป๋องเหล็ก vs อลูมิเนียมกระป๋อง
- **"กระป๋อง, ปี๊บ"** = กระป๋องเหล็ก / ปี๊บเหล็ก → หมวด **เหล็ก**
- **"อลูมิเนียมกระป๋อง"** = สินค้าอลูมิเนียม → หมวด **อลูมิเนียม**
- 🚫 ห้าม map สองตัวนี้เข้าด้วยกัน

#### Rule 2: อลูมิเนียมหล่อ vs เหล็กหล่อ
- **"อลูมิเนียมหล่อ"** = ร้านเรียก "เนียมแข็ง" → หมวด **อลูมิเนียม**
- **"เหล็กหล่อ 40/80"** → หมวด **เหล็ก**
- 🚫 ห้าม map "อลูมิเนียมหล่อ" ไป "เหล็กหล่อ"

#### Rule 3: สายไฟทองแดง vs สายไฟอลูมิเนียม
- **"สายไฟไม่ปอก"** = สายไฟทองแดงที่ยังไม่ปอก → หมวด **ทองแดง**
- **"สายไฟอลูมิเนียมไม่ปอก"** = สายไฟอลูมิเนียม → หมวด **อลูมิเนียม**
- 🚫 ห้าม map สองตัวนี้เข้าด้วยกัน (ราคาต่างกันมาก)

#### Rule 4: แผงวงจร
- **"แผงวงจร/พวงแผงวงจร"** = PCB → หมวด **อิเล็กทรอนิกส์** (ไม่มีในระบบ 7 หมวดปัจจุบัน — ต้องสร้างใหม่)
- 🚫 ห้าม map ไป "อลูมีเนียมสายไฟ" หรือสินค้าอื่นที่ไม่เกี่ยวข้อง

### กฎทั่วไป
- ถ้าคนละหมวดวัสดุ → ถือว่าเป็นคนละสินค้า
- ห้าม auto-match ข้ามหมวดวัสดุ
- ห้ามใช้ fuzzy match ข้ามหมวด
- ถ้าไม่แน่ใจ → status = NEED_REVIEW
- ห้ามสร้าง alias ที่อาจทำให้ stock ผิดหมวด

---

## 4. Weight Formula Rules

> ⚠️ **Status**: parser มีอยู่ใน `src/lib/safe-math.ts` แต่ DB field `weightExpression` หายไป — ต้อง migrate + recreate code

### สูตรที่รองรับ
- `+ - * / ( )` และตัวเลขทศนิยม
- ตัวอย่าง: `860-3` → 857, `100+20-5` → 115, `(1000-10)/2` → 495, `1000-15-2` → 983

### การเก็บข้อมูล
- **เก็บทั้งคู่**: `weight` (Float) + `weightExpression` (String, nullable)
- `weight` = ผลลัพธ์ที่คำนวณได้ (ใช้สำหรับ stock และการเงิน)
- `weightExpression` = สูตรที่ผู้ใช้พิมพ์ (เก็บไว้แสดงใน history/audit)
- ถ้าผู้ใช้กรอก plain number `857` → `weightExpression = null`
- ถ้าผู้ใช้กรอก formula `860-3` → `weightExpression = "860-3"`, `weight = 857`

### การแสดงผล
- **Live preview**: ขณะพิมพ์ `860-3` → แสดง `= 857 กก.` สีเขียวใต้ input
- **Input**: ยังแสดง `860-3` (ห้ามเปลี่ยนเป็น 857 หลัง Enter)
- **Cart table**: แสดง `857 กก.` บน + `จาก 860-3` สีเทาเล็กๆ ล่าง
- **History**: แสดง formula ในรายละเอียด bill ทุกประเภท
- **AuditLog**: เก็บใน `details.itemFormulas[]`

### การ reject
- `860-` → error "สูตรไม่สมบูรณ์"
- `abc` → error "อักขระไม่ถูกต้อง"
- `10/0` → error "หารด้วยศูนย์ไม่ได้"
- ห้ามใช้ `eval()` หรือ `new Function()` — ใช้ recursive descent parser เท่านั้น

---

## 5. Stock FIFO Rules

### FIFO = First In First Out
- เมื่อ sell หรือ sort → ตัด stock จาก lot เก่าก่อน (orderBy `dateAdded ASC`)
- แต่ละ lot มี `costPerKg` ของตัวเอง
- `costPerKg` ของ SellBillItem = weighted average ของ lots ที่ถูกตัด

### ตัวอย่าง
```
Lots สำหรับ Product A:
  Lot 1: 100 กก. @ 5 บาท (dateAdded: 2026-01-01)
  Lot 2: 200 กก. @ 7 บาท (dateAdded: 2026-01-15)

Sell 150 กก.:
  - ตัด 100 กก. จาก Lot 1 (5 บาท) = 500 บาท
  - ตัด 50 กก. จาก Lot 2 (7 บาท) = 350 บาท
  - totalCost = 850 บาท
  - costPerKg = 850/150 = 5.67 บาท
  - Lot 1: remainingWeight = 0 (หมด)
  - Lot 2: remainingWeight = 150 กก.
```

---

## 6. Credit (ค้างชำระ) Rules

### ประเภท
- `RECEIVABLE` = ค้างรับ (ลูกค้าค้างจ่ายเรา) — เกิดจาก SellBill isCredit
- `PAYABLE` = ค้างจ่าย (เราค้างจ่ายผู้ขาย) — เกิดจาก BuyBill isCredit

### กฎ
- สร้าง CreditEntry อัตโนมัติเมื่อ bill isCredit = true
- `amount` = bill.totalAmount
- `paidAmount` เริ่มที่ 0
- เพิ่มได้ผ่าน `/api/credit/{id}/pay`
- `isSettled = true` เมื่อ `paidAmount >= amount`
- ลบ CreditEntry เมื่อ cancel bill (ถ้ามี feature cancel)

---

## 7. Bonus Rules

### Sorting Bonus
- คำนวณจาก: `(sortedPricePerKg - sourcePricePerKg) × weight × 10%`
- เฉพาะ non-waste items
- ถ้า `grossProfit < 0` (ขาดทุน) → bonus = 0 (ไม่ติดลบ)
- ปันส่วนรายเดือน: ตาม `Employee.hireDate` (monthsWorked / 12)

### Employee
- ลบ employee ไม่ได้ (มี FK ไป SortingBonus)
- ใช้ `isActive = false` เพื่อ deactivate

---

## 8. User Permission Rules

### Roles
| Role | สิทธิ์ |
|------|-------|
| `admin` | ทุกอย่าง — รวมถึง user management |
| `staff` | สร้าง/ดู bills, ดู stock, ดู history — ห้ามจัดการผู้ใช้ |

### User state
- `isActive = true` → login ได้
- `isActive = false` → login ไม่ได้ (แม้รู้รหัสผ่าน)
- ห้าม hard delete user — ใช้ deactivate เท่านั้น

---

## 9. ข้อห้ามทั่วไป

- 🚫 ห้ามกรอกน้ำหนักติดลบ
- 🚫 ห้ามกรอกราคาติดลบ
- 🚫 ห้ามขายเกิน stock คงเหลือ
- 🚫 ห้ามคัดแยกเกิน source stock
- 🚫 ห้ามลบ bill โดยตรงใน DB (ใช้ cancel)
- 🚫 ห้ามแก้ stock โดยตรงใน DB (ใช้ bill/cancel)
- 🚫 ห้าม hard delete สินค้าที่มี transaction (จะ break FK)
