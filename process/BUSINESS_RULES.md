# Business Rules — ยงเฮง มหาชัย รีไซเคิล

> กฎธุรกิจที่ระบบต้องปฏิบัติตาม — สำคัญมาก ห้ามละเว้น
> วันที่เริ่มต้น: 27/06/2569
> อัปเดตล่าสุด: 2026-07-28 (ST-70 — SortingBill cancellation correctness)

> **หมายเหตุ ST-70 (2026-07-28)**: Section 1 (billNumber) และ Section 2 (Bill Cancel) ถูก implement แล้วใน codebase ปัจจุบัน (branch `st-70-sorting-cancellation-history`) กฎเดิมที่บอกว่า "หายไปจาก codebase" ถูก supersede ด้วย current truth ด้านล่าง ดูรายละเอียดเพิ่มเติมที่ `process/FEATURE_INVENTORY.md` และ PR #49

---

## 1. Bill Number Format

> ✅ **Status (verified 2026-07-28)**: `billNumber` field มีใน schema.prisma สำหรับ BuyBill, SellBill, SortingBill (เป็น `String? @unique`) และถูก generate โดย `src/lib/bill-helpers.ts` `generateBillNumber()`

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

> ✅ **Status (verified 2026-07-28)**: Cancel feature มีใน codebase ปัจจุบัน
> - Routes: `DELETE /api/buy-bills/{id}`, `DELETE /api/sell-bills/{id}`, `DELETE /api/sorting-bills/{id}`
> - Schema fields: `isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason` บน BuyBill/SellBill/SortingBill
> - AuditLog model มีใน schema.prisma
> - ทุก cancel ทำงานใน Prisma transaction เดียว (atomic)

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

### SortingBill Cancel (ST-70 — Owner-approved safe rule, 2026-07-28)
- ใช้ `DELETE /api/sorting-bills/{id}` + body `{"reason": "..."}`
- Soft cancellation สำหรับ bill แต่ stock effects เป็น transactional (atomic)
- ทั้งหมดทำงานใน **one Prisma transaction** (`src/lib/sorting-cancellation-service.ts` `cancelSortingBill`):

  1. **Read bill + items** — 404 `SORTING_BILL_NOT_FOUND` ถ้าไม่พบ, 409 `SORTING_BILL_ALREADY_CANCELLED` ถ้าถูก cancel แล้ว
  2. **Validate output lots** — `assertIntact` ตรวจว่า output StockLots (`source='SORTING'`, `sourceId=bill.id`) ตรง product + lot count + six-decimal weight กับ original non-waste items ทุกประการ
  3. **Derive authoritative cost evidence** — `deriveSourceCostEvidence`:
     - ถ้า `sourceWeight <= 0`: cost = 0 (no evidence required)
     - Original non-reversal `SORTING_SOURCE_OUT` StockMovement metadata `sourceCostPerKg` (authoritative)
     - หรือ non-waste `SortingBillItem.costPerKg`
     - ทั้งสอง source มี + ขัดแย้งกัน → 409 `SORTING_CANCEL_COST_EVIDENCE_CONFLICTING`
     - มี source เดียว + เป็น 0 → 409 `SORTING_CANCEL_COST_EVIDENCE_ZERO`
     - ไม่มี source ไหน + `sourceWeight > 0` → 409 `SORTING_CANCEL_COST_EVIDENCE_MISSING`
     - **ห้ามใช้** current StockLot cost (อาจ drift หลัง sort-time)
     - **ห้าม guess** จาก user-entered analysis price
  4. **Conditional active-bill claim** — `updateMany({ id, isCancelled: false })`; `claim.count !== 1` → 409 `SORTING_CANCEL_CONFLICT` (concurrent cancellation detected)
  5. **Atomic compare-and-delete of intact output lots** — แต่ละ lot ถูกลบด้วย `deleteMany({ id, productId, remainingWeight })` ที่ใช้ค่าจาก read ใน transaction เดียวกันเป็น CAS guard
     - ถ้า lot ถูก consume บางส่วน/เปลี่ยน ระหว่าง read กับ delete → `count=0` → 409 `SORTING_BILL_HAS_DOWNSTREAM_USAGE` → rollback ทุก mutation
  6. **Source StockLot restoration** — create `StockLot { source='SORT_CANCEL', sourceId=bill.id, remainingWeight=bill.sourceWeight, costPerKg=derived }` (เฉพาะ `sourceWeight > 0`)
  7. **SortingBonus removal** — `deleteMany({ sortingBillId: bill.id })`
  8. **StockMovement reversals** — `reverseSourceMovements` สร้าง fresh `CANCELLATION_REVERSAL` rows ที่ reference original movements (`reversalOfId = original.id`) ด้วย `idempotencyKey` ใหม่
  9. **One CANCEL AuditLog** — `action='CANCEL'`, `entityType='SORTING_BILL'`, `details` มี `restoredSourceWeight`, `restoredSourceCostPerKg`, `restoredSourceCostEvidence`, `removedOutputLotCount`

- **Output StockLots ต้องไม่เหลือ active หลัง successful cancellation** ✅
- ถ้า output StockLot ขาด, ถูก consume บางส่วน, เปลี่ยน, ซ้ำ, คลุมเครือ หรือถูกแก้ concurrent:
  - **fail closed** → structured HTTP 409
  - **rollback ทุก mutation** (claim, delete, restore, bonus delete, reversal, audit)
- ไม่มี manual SQL สำหรับ normal SortingBill cancellation (ใช้ DELETE route เท่านั้น)

> 📜 **Historical note (superseded 2026-07-28)**: กฎเดิมระบุว่า "Output stock LEFT UNTOUCHED BY DESIGN" และแนะนำให้ใช้ manual SQL Editor สำหรับลบ output StockLot กฎนี้ถูก supersede โดย ST-70 Owner decision (PR #49 comment #9, 2026-07-25) ที่อนุมัติ atomic compare-and-delete + fail-closed semantics

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

## 8.5. Stable Error Codes (ST-70, verified 2026-07-28)

> ✅ Codes เหล่านี้ถูก return จาก API และควรถูกใช้โดย client เพื่อ branching/UX

### SortingBill Cancellation (`DELETE /api/sorting-bills/{id}`)

| HTTP | Code | Meaning |
|------|------|---------|
| 404 | `SORTING_BILL_NOT_FOUND` | ไม่พบใบคัดแยก |
| 409 | `SORTING_BILL_ALREADY_CANCELLED` | ใบคัดแยกถูกยกเลิกไปแล้ว |
| 409 | `SORTING_BILL_HAS_DOWNSTREAM_USAGE` | output StockLots ขาด/consume บางส่วน/เปลี่ยน/CAS fail → rollback ทุก mutation |
| 409 | `SORTING_CANCEL_CONFLICT` | conditional claim fail (concurrent cancellation หรือ state เปลี่ยน) |
| 409 | `SORTING_CANCEL_COST_EVIDENCE_MISSING` | ไม่มี authoritative cost evidence ใน transaction (sourceWeight > 0 แต่ไม่มี StockMovement metadata หรือ SortingBillItem.costPerKg) |
| 409 | `SORTING_CANCEL_COST_EVIDENCE_CONFLICTING` | StockMovement metadata กับ SortingBillItem.costPerKg ขัดแย้งกัน (หรือหลาย StockMovement rows มี cost ต่างกัน) |
| 409 | `SORTING_CANCEL_COST_EVIDENCE_ZERO` | evidence มีอยู่แต่ costPerKg = 0 |
| 500 | `SORTING_CANCEL_FAILED` | unexpected error (ไม่ expose Prisma/PostgreSQL details) |

### Auth (all protected routes)

| HTTP | Code | Meaning |
|------|------|---------|
| 401 | `AUTH_REQUIRED` | missing/invalid/expired token |
| 403 | `PERMISSION_DENIED` | valid token แต่ไม่มี permission ที่จำเป็น |

### Combined History Pagination (`GET /api/sorting-bills?includeTransfers=true`)

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `INVALID_PAGINATION` | page/limit ไม่ใช่ positive integer หรือ limit > 100 |
| 400 | `PAGINATION_WINDOW_EXCEEDED` | page × limit > 1,000 (combined leading window cap) |

---

## 9. ข้อห้ามทั่วไป

- 🚫 ห้ามกรอกน้ำหนักติดลบ
- 🚫 ห้ามกรอกราคาติดลบ
- 🚫 ห้ามขายเกิน stock คงเหลือ
- 🚫 ห้ามคัดแยกเกิน source stock
- 🚫 ห้ามลบ bill โดยตรงใน DB (ใช้ cancel)
- 🚫 ห้ามแก้ stock โดยตรงใน DB (ใช้ bill/cancel)
- 🚫 ห้าม hard delete สินค้าที่มี transaction (จะ break FK)
