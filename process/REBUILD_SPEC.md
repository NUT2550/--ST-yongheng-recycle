# Rebuild Spec — ยงเฮง มหาชัย รีไซเคิล

> Specification สำหรับสร้างระบบใหม่ที่มีฟีเจอร์เทียบเท่าระบบปัจจุบัน
> วันที่: 27/06/2569
> Source of truth: codebase ปัจจุบัน + process/*.md (7 ไฟล์)

---

## 1. ระบบนี้คืออะไร

**ชื่อ**: ยงเฮง มหาชัย รีไซเคิล (Yongheng Mahachai Recycle)

**ประเภท**: ระบบบันทึกสต็อกสำหรับร้านรับซื้อเหล็กและโลหะ (scrap metal recycling yard)

**จุดประสงค์**: บันทึกการรับซื้อ/ขาย/คัดแยกสินค้า พร้อม FIFO stock tracking และการเงิน (credit, bonus)

**ผู้ใช้งาน**: เจ้าของร้าน (admin) + พนักงาน (staff)

---

## 2. Tech Stack (บังคับ)

| ชั้น | เทคโนโลยี | เหตุผล |
|------|-----------|-------|
| Framework | Next.js 16 (App Router) | deploy ง่ายบน Vercel |
| Language | TypeScript 5 (strict) | type safety |
| Runtime | Bun (dev) / Node.js (production) | เร็ว |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) | มี component พร้อม |
| Database | Supabase Postgres | free tier พอ + dashboard ครบ |
| ORM | Prisma 6 | type-safe query |
| Auth | JWT (jose) + bcryptjs | ไม่ต้องใช้ session cookie |
| State | Zustand (client) | ง่าย + เร็ว |
| Icons | lucide-react | ครบ |
| Hosting | Vercel + Supabase | free tier พอ |

---

## 3. หน้าจอทั้งหมดที่ต้องมี

| หน้า | Path | ผู้ใช้ | ฟังก์ชัน |
|------|------|-------|---------|
| Login | `/` (auto-redirect) | ทุกคน | login ด้วย username/password |
| Dashboard | `/` (หลัง login) | ทุกคน | สรุปยอดวันนี้ + สต็อก + recent bills |
| รับซื้อ (Buy) | tab "รับซื้อ" | ทุกคน | สร้าง BuyBill + cart |
| ขาย (Sell) | tab "ขาย" | ทุกคน | สร้าง SellBill + cart + customer |
| คัดแยก (Sort) | tab "คัดแยก" | ทุกคน | สร้าง SortingBill + bonus calc |
| สต็อก | tab "สต็อก" | ทุกคน | ดูสต็อกแยกหมวด + lots |
| ประวัติ | tab "ประวัติ" | ทุกคน | list bills 3 ประเภท + expand |
| เครดิต | tab "เครดิต" | ทุกคน | ค้างรับ/ค้างจ่าย + ชำระ |
| โบนัส | tab "โบนัส" | admin | คำนวณ + จ่ายโบนัสพนักงาน |
| สินค้า | tab "สินค้า" | admin | CRUD product + category |
| ผู้ใช้งาน | tab "ผู้ใช้งาน" | admin | CRUD user + role + isActive |

---

## 4. API Routes ทั้งหมดที่ต้องมี

### Auth
| Method | Path | Function |
|--------|------|----------|
| POST | `/api/auth/login` | ตรวจ username/password → return JWT token |
| GET | `/api/auth/me` | ตรวจ token ปัจจุบัน → return user info |
| POST | `/api/auth/logout` | (client-side ล้าง token — server no-op หรือ log) |

### Bills
| Method | Path | Function | ต้องมี? |
|--------|------|----------|---------|
| POST | `/api/buy-bills` | สร้าง BuyBill + เพิ่ม StockLot | ✅ บังคับ |
| GET | `/api/buy-bills` | List BuyBills (paginated) | ✅ บังคับ |
| GET | `/api/buy-bills/{id}` | ดูรายละเอียด bill | ✅ บังคับ |
| PATCH | `/api/buy-bills/{id}` | แก้ bill (ถ้ายังไม่ cancel) | optional |
| DELETE | `/api/buy-bills/{id}` | Cancel bill + restore stock | ✅ บังคับ |
| POST | `/api/sell-bills` | สร้าง SellBill + FIFO deduction | ✅ บังคับ |
| GET | `/api/sell-bills` | List SellBills | ✅ บังคับ |
| DELETE | `/api/sell-bills/{id}` | Cancel + restore stock | ✅ บังคับ |
| POST | `/api/sorting-bills` | สร้าง SortingBill + FIFO source + add output | ✅ บังคับ |
| GET | `/api/sorting-bills` | List SortingBills | ✅ บังคับ |
| DELETE | `/api/sorting-bills/{id}` | Cancel + restore source stock only | ✅ บังคับ |

### Master Data
| Method | Path | Function |
|--------|------|----------|
| GET/POST | `/api/products` | List/Create product |
| GET/PATCH/DELETE | `/api/products/{id}` | Read/Update/Delete product |
| GET/POST | `/api/customers` | List/Create customer |
| GET/PATCH/DELETE | `/api/customers/{id}` | Read/Update/Delete |
| GET/POST | `/api/employees` | List/Create employee |
| GET/PATCH/DELETE | `/api/employees/{id}` | Read/Update/Delete |
| GET/POST | `/api/users` | List/Create user (admin only) |
| GET/PATCH/DELETE | `/api/users/{id}` | Read/Update/Delete (admin only) |

### Operations
| Method | Path | Function |
|--------|------|----------|
| GET | `/api/stock` | ดูสต็อกทั้งหมด group by category |
| GET | `/api/dashboard` | สรุปยอด + recent bills |
| GET | `/api/credit` | List CreditEntry (filter by type/isSettled/customerId) |
| POST | `/api/credit/{id}/pay` | ชำระเครดิต |
| GET | `/api/bonuses` | List SortingBonus |
| POST | `/api/bonuses` | Create SortingBonus |
| GET/PATCH/DELETE | `/api/bonuses/{id}` | Read/Update/Delete bonus |
| GET | `/api/bonus-calculation` | คำนวณโบนัสรายปี |

### Optional (Feature ขั้นสูง)
| Method | Path | Function | ต้องมี? |
|--------|------|----------|---------|
| POST | `/api/excel/parse` | Parse Excel file → return rows | ✅ บังคับ (ถ้ามี Excel import) |

---

## 5. Database Schema ที่ต้องมี

### Master Data
```prisma
model ProductCategory {
  id        String    @id @default(cuid())
  name      String    @unique  // เหล็ก, ทองแดง, ทองเหลือง, แสตนเลส, อลูมีเนียม, ตะกั่ว, อื่นๆ
  type      String    // STEEL, METAL
  sortOrder Int       @default(0)
  products  Product[]
}

model Product {
  id              String          @id @default(cuid())
  name            String          @unique
  categoryId      String
  category        ProductCategory @relation(fields: [categoryId], references: [id])
  defaultBuyPrice Float           @default(0)
  sortOrder       Int             @default(0)
  stockLots       StockLot[]
  buyItems        BuyBillItem[]
  sellItems       SellBillItem[]
  sortingSource   SortingBill[]   @relation("SortingSource")
  sortingItems    SortingBillItem[]
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

model Customer {
  id          String        @id @default(cuid())
  name        String
  phone       String?
  sellBills   SellBill[]
  creditEntry CreditEntry[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model Employee {
  id        String          @id @default(cuid())
  name      String
  phone     String?
  hireDate  DateTime?       // ใช้คำนวณสัดส่วนโบนัส
  isActive  Boolean         @default(true)
  bonuses   SortingBonus[]
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
}

model User {
  id        String   @id @default(cuid())
  username  String   @unique
  password  String   // bcrypt hash
  name      String
  role      String   @default("staff") // admin, staff
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Stock
```prisma
model StockLot {
  id              String   @id @default(cuid())
  productId       String
  product         Product  @relation(fields: [productId], references: [id])
  remainingWeight Float
  costPerKg       Float
  dateAdded       DateTime @default(now())
  source          String   // BUY, SORTING, BUY_CANCEL, SORT_CANCEL, SELL_CANCEL
  sourceId        String?  // FK ไปยัง bill ที่สร้าง lot นี้
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Bills (พร้อม features ที่ต้อง rebuild)
```prisma
model BuyBill {
  id            String        @id @default(cuid())
  billNumber    String?       @unique  // BUY-2569-XXXXX (ต้อง rebuild)
  date          DateTime      @default(now())
  isCredit      Boolean       @default(false)
  note          String?
  items         BuyBillItem[]
  totalAmount   Float         @default(0)
  isCancelled   Boolean       @default(false)  // soft delete (ต้อง rebuild)
  cancelledAt   DateTime?
  cancelledBy   String?
  cancelReason  String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

model BuyBillItem {
  id               String  @id @default(cuid())
  buyBillId        String
  buyBill          BuyBill @relation(fields: [buyBillId], references: [id], onDelete: Cascade)
  productId        String
  product          Product @relation(fields: [productId], references: [id])
  weight           Float
  weightExpression String?  // สูตรที่ผู้ใช้พิมพ์ (ต้อง rebuild)
  pricePerKg       Float
  totalAmount      Float
}

// SellBill, SellBillItem, SortingBill, SortingBillItem มีโครงสร้างคล้ายกัน
// ดูรายละเอียดทั้งหมดได้ใน process/DATABASE_CONTEXT.md
```

### Credit
```prisma
model CreditEntry {
  id            String          @id @default(cuid())
  type          String  // RECEIVABLE, PAYABLE
  amount        Float
  paidAmount    Float           @default(0)
  customerId    String?
  customer      Customer?       @relation(fields: [customerId], references: [id])
  referenceType String  // BUY_BILL, SELL_BILL
  referenceId   String?
  description   String?
  date          DateTime        @default(now())
  isSettled     Boolean         @default(false)
  payments      CreditPayment[]
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

model CreditPayment {
  id            String      @id @default(cuid())
  creditEntryId String
  creditEntry   CreditEntry @relation(fields: [creditEntryId], references: [id], onDelete: Cascade)
  amount        Float
  date          DateTime    @default(now())
  note          String?
  createdAt     DateTime    @default(now())
}
```

### Bonus
```prisma
model SortingBonus {
  id            String       @id @default(cuid())
  date          DateTime     @default(now())
  employeeId    String
  employee      Employee     @relation(fields: [employeeId], references: [id])
  sortingBillId String?
  sortingBill   SortingBill? @relation(fields: [sortingBillId], references: [id])
  totalWeight   Float        @default(0)
  ratePerKg     Float        @default(0)
  totalAmount   Float        @default(0)
  note          String?
  isPaid        Boolean      @default(false)
  paidDate      DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}
```

### AuditLog (ต้อง rebuild)
```prisma
model AuditLog {
  id         String   @id @default(cuid())
  action     String   // CREATE, UPDATE, DELETE, CANCEL
  entityType String   // BUY_BILL, SELL_BILL, SORTING_BILL
  entityId   String
  userId     String?
  userName   String?
  details    String?  // JSON string of changes/summary (รวม itemFormulas[])
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([createdAt])
}
```

---

## 6. Stock Flow (บังคับ)

### Buy — เพิ่ม stock
```
1. รับ { date, isCredit, note, items[] } จาก client
2. Validate: weight > 0, pricePerKg >= 0
3. For each item:
   - totalAmount = weight × pricePerKg
4. Create BuyBill + BuyBillItem[] ใน transaction
5. For each item: Create StockLot
   - productId = item.productId
   - remainingWeight = item.weight
   - costPerKg = item.pricePerKg
   - source = "BUY"
   - sourceId = bill.id
   - dateAdded = bill.date
6. If isCredit: create CreditEntry (PAYABLE, amount = totalAmount)
7. (Rebuild) Generate billNumber BUY-{BUDDHIST_YEAR}-{SEQ_5_DIGIT}
8. (Rebuild) Write AuditLog CREATE with itemFormulas[]
```

### Sell — ตัด stock FIFO
```
1. รับ { date, customerId, isCredit, note, items[] }
2. Validate: weight > 0, pricePerKg > 0
3. Pre-validate stock พอทุก item:
   - SUM(remainingWeight WHERE productId = item.productId AND > 0) >= item.weight
4. ใน transaction:
   For each item:
     a. Call deductStockFIFO(productId, weight, tx):
        - Find lots WHERE productId AND remainingWeight > 0 ORDER BY dateAdded ASC
        - Deduct จาก lot เก่าสุดก่อน → ลด remainingWeight
        - Track totalCost = sum(deducted × lot.costPerKg)
        - Return { costPerKg: totalCost/weight, totalCost }
     b. Create SellBillItem พร้อม costPerKg + totalCost
5. If isCredit: create CreditEntry (RECEIVABLE, customerId)
6. (Rebuild) Generate billNumber + AuditLog
```

### Sorting — ตัด source + add output
```
1. รับ { date, sourceProductId, sourceWeight, sourcePricePerKg, weighedTotal, note, items[] }
2. Validate: sourceWeight > 0
3. Pre-validate source stock พอ
4. ใน transaction:
   a. deductStockFIFO(sourceProductId, sourceWeight, tx) → sourceCostPerKg
   b. lossWeight = sourceWeight - SUM(item.weight)
   c. lossCost = lossWeight × sourceCostPerKg
   d. For each item (not waste):
      - Create SortingBillItem (costPerKg = sourceCostPerKg)
      - Create StockLot (productId = item.productId, costPerKg = sourceCostPerKg, source = "SORTING")
   e. Create SortingBill
   f. (Rebuild) Generate billNumber + AuditLog
```

### Cancel — restore stock (ต้อง rebuild)
```
BuyBill Cancel (DELETE /api/buy-bills/{id}):
1. ตรวจ bill ไม่ cancelled แล้ว
2. ตรวจ StockLot ที่ source = "BUY" AND sourceId = bill.id:
   - consumed = totalOriginal - totalRemaining
   - ถ้า consumed > 0 → throw "ไม่สามารถ cancel ได้ เพราะ stock ถูกใช้ไปแล้ว"
3. ลบ StockLot ที่ sourceId = bill.id (ที่ remainingWeight > 0)
4. Update bill: isCancelled = true, cancelledAt, cancelledBy, cancelReason
5. If isCredit: ลบ/ตั้ง isSettled CreditEntry ที่ referenceId = bill.id
6. Write AuditLog CANCEL with restoredWeight

SellBill Cancel (DELETE /api/sell-bills/{id}):
1. ตรวจ bill ไม่ cancelled แล้ว
2. For each SellBillItem:
   - Create new StockLot:
     - productId = item.productId
     - remainingWeight = item.weight
     - costPerKg = item.costPerKg (ใช้ FIFO costPerKg เดิม)
     - source = "SELL_CANCEL"
     - sourceId = bill.id
3. Update bill: isCancelled = true
4. If isCredit: ลบ CreditEntry ที่ referenceId = bill.id
5. Write AuditLog CANCEL with restoredWeight

SortingBill Cancel (DELETE /api/sorting-bills/{id}):
1. ตรวจ bill ไม่ cancelled แล้ว
2. Restore SOURCE stock only:
   - Create StockLot:
     - productId = bill.sourceProductId
     - remainingWeight = bill.sourceWeight
     - costPerKg = sourceCostPerKg (จาก SortingBillItem แรกที่ไม่ใช่ waste)
     - source = "SORT_CANCEL"
     - sourceId = bill.id
3. 🚨 OUTPUT stock LEFT UNTOUCHED BY DESIGN
   - ห้ามลบ StockLot ที่ source = "SORTING" AND sourceId = bill.id
   - เหตุผล: output อาจถูกขายต่อไปแล้ว (downstream sales)
4. Delete SortingBonus ที่ sortingBillId = bill.id
5. Update bill: isCancelled = true
6. Write AuditLog CANCEL with restoredSourceWeight
```

---

## 7. User Roles

| Role | สิทธิ์ |
|------|-------|
| `admin` | ทุกอย่าง — รวมถึง user management, product CRUD, employee CRUD |
| `staff` | สร้าง/ดู bills, ดู stock, ดู history, ดู credit, ดู bonus — ห้ามจัดการผู้ใช้/สินค้า/พนักงาน |

### Default Users (ต้องมี)
| Username | Role | Name | สถานะ |
|----------|------|------|-------|
| `01` | admin | นัท ผู้จัดการ | active (เจ้าของร้าน) |
| `04` | staff | พนักงาน ยงเฮง | active |
| `admin` | admin | ผู้ดูแลระบบ | ❌ deactivated (default account — ห้ามใช้) |

---

## 8. Business Rules

### Bill Number Format
```
{TYPE}-{BUDDHIST_YEAR}-{SEQ_5_DIGIT}
```
- TYPE: `BUY`, `SELL`, `SORT`
- BUDDHIST_YEAR: ค.ศ. + 543
- SEQ_5_DIGIT: นับจากจำนวน bill ทั้งหมดในปีนั้น + 1, zero-padded 5 หลัก
- ตัวอย่าง: `BUY-2569-00001`, `SELL-2569-00012`, `SORT-2569-00003`
- ต้อง unique (`@unique` constraint)
- Sequence รีเซ็ตทุกปี

### Cancel Behavior
- ใช้ soft delete (`isCancelled = true`)
- บันทึก `cancelledAt`, `cancelledBy`, `cancelReason`
- Restore stock ตามประเภท bill (ดู section 6)
- เขียน AuditLog `CANCEL` entry

### SortingBill Cancel Special Rule
- Restore **เฉพาะ source stock**
- Output stock **left untouched by design** (อาจถูกขายต่อไปแล้ว)

### Credit
- `RECEIVABLE` = ค้างรับ (ลูกค้าค้างจ่ายเรา) — เกิดจาก SellBill isCredit
- `PAYABLE` = ค้างจ่าย (เราค้างจ่ายผู้ขาย) — เกิดจาก BuyBill isCredit
- สร้างอัตโนมัติเมื่อ bill isCredit = true
- ลบเมื่อ cancel bill

### Bonus
- `bonusAmount = (sortedPricePerKg - sourcePricePerKg) × weight × 10%`
- เฉพาะ non-waste items
- ถ้า grossProfit < 0 → bonus = 0 (ไม่ติดลบ)

---

## 9. Product Category Rules (Cross-Category Prohibition)

### หลักการ
**คนละหมวดวัสดุ = คนละสินค้า ห้าม auto-match ข้ามหมวด**

### หมวดวัสดุทั้งหมด (7 หมวด)
1. เหล็ก (STEEL) — หนาพิเศษ, หนาสั้น, หนายาว, เหล็กคละ, เหล็กบาง, เหล็กหล่อ 40, เหล็กหล่อ 80, กระป๋องปี๊บ, สังกะสี, ถัง, แม่พิมพ์, สลิง
2. ทองแดง (METAL) — ปอก, ช๊อต, ใหญ่, เล็ก, พิเศษ, หม้อน้ำ/แดง, ทองแดงชุบ
3. ทองเหลือง (METAL) — เนื้อแดง, เหลืองหนา, กลึงเหลือง, หม้อเหลือง
4. แสตนเลส (METAL) — 304, 304 ยาว, 202
5. อลูมีเนียม (METAL) — 25 สินค้า (เนียมสายไฟ, ฉาก, เนียมบาง, อัลลอย, ล้อแม็ก, เนียมแข็ง, ป๋องเนียม, ฯลฯ)
6. ตะกั่ว (METAL) — ตะกั่วแข็ง, ตะกั่วนิ่ม
7. อื่นๆ (METAL) — ของแกะ, มอเตอร์, คอมดำ

### กฎเฉพาะ (จาก owner)

#### Rule 1: กระป๋องเหล็ก vs อลูมิเนียมกระป๋อง
- "กระป๋อง, ปี๊บ" = กระป๋องเหล็ก → หมวด **เหล็ก**
- "อลูมิเนียมกระป๋อง" = อลูมิเนียม → หมวด **อลูมีเนียม**
- 🚫 ห้าม map สองตัวนี้เข้าด้วยกัน

#### Rule 2: อลูมิเนียมหล่อ vs เหล็กหล่อ
- "อลูมิเนียมหล่อ" = ร้านเรียก "เนียมแข็ง" → หมวด **อลูมีเนียม**
- "เหล็กหล่อ 40/80" → หมวด **เหล็ก**
- 🚫 ห้าม map "อลูมิเนียมหล่อ" ไป "เหล็กหล่อ"

#### Rule 3: สายไฟทองแดง vs สายไฟอลูมิเนียม
- "สายไฟไม่ปอก" = ทองแดง → หมวด **ทองแดง**
- "สายไฟอลูมิเนียมไม่ปอก" = อลูมิเนียม → หมวด **อลูมีเนียม**
- 🚫 ห้าม map สองตัวนี้เข้าด้วยกัน

#### Rule 4: แผงวงจร
- "แผงวงจร/พวงแผงวงจร" = PCB → หมวด **อิเล็กทรอนิกส์** (ต้องสร้างใหม่)
- 🚫 ห้าม map ไป "อลูมีเนียมสายไฟ" หรือสินค้าอื่น

### กฎทั่วไป
- ถ้าคนละหมวด → คนละสินค้า
- ห้าม auto-match ข้ามหมวด
- ห้าม fuzzy match ข้ามหมวด
- ถ้าไม่แน่ใจ → status = NEED_REVIEW
- ห้ามสร้าง alias ที่อาจทำให้ stock ผิดหมวด

---

## 10. Excel Import Rules

### Feature ต้องมี
- ปุ่ม "Import จาก Excel" ในหน้า Buy (อาจมีใน Sell ด้วย)
- รองรับไฟล์ `.xls` และ `.xlsx`
- รองรับ TIS-620 encoding (ไฟล์เก่าจากระบบเดิม)
- Preview dialog ก่อน import
- Auto-match สินค้าจากชื่อใน Excel → สินค้าในระบบใหม่
- แสดงสถานะ match:
  - `EXACT` (100%)
  - `CONTAINS` (85%)
  - `PREFIX_MATCH` (70-75%)
  - `KEYWORD` (65%)
  - `NO_MATCH` (0%)
- ห้าม auto-match ข้ามหมวดวัสดุ (Section 9)
- ผู้ใช้แก้ mapping ได้ก่อน import

### Excel Format (เดิม)
- Column: `code`, `name`, `weight`, `pricePerKg`, `totalAmount`
- แถวแรก = header (skip)
- Data เริ่มแถวที่ 2

---

## 11. Weight Formula Rules

### Feature ต้องมี
- ช่องกรอกน้ำหนักเป็น `type="text"` (ไม่ใช่ number) — รองรับสูตร
- รองรับ operators: `+ - * / ( )` และทศนิยม
- ตัวอย่าง: `860-3` → 857, `100+20-5` → 115, `(1000-10)/2` → 495

### Live Preview
- ขณะพิมพ์ `860-3` → แสดง `= 857 กก.` สีเขียวทันทีใต้ input
- ใช้ `previewWeightValue()` helper

### Behavior หลัง Enter
- Input **ยังแสดง expression** `860-3` (ห้ามเปลี่ยนเป็น 857)
- Toast แสดง `น้ำหนัก: 860-3 = 857`
- Focus ย้ายไปช่องถัดไป

### Data Storage
- `weight` (Float) = ผลลัพธ์ที่คำนวณได้
- `weightExpression` (String, nullable) = สูตรที่ผู้ใช้พิมพ์
- ถ้าผู้ใช้กรอก plain number `857` → `weightExpression = null`
- ถ้าผู้ใช้กรอก formula `860-3` → `weightExpression = "860-3"`, `weight = 857`

### Display
- Cart table: `857 กก.` บน + `จาก 860-3` สีเทาเล็กล่าง
- History: แสดง formula ในรายละเอียด bill
- AuditLog: เก็บใน `details.itemFormulas[]`

### Error Handling
- `860-` → "สูตรไม่สมบูรณ์"
- `abc` → "อักขระไม่ถูกต้อง"
- `10/0` → "หารด้วยศูนย์ไม่ได้"
- 🚫 ห้ามใช้ `eval()` หรือ `new Function()`
- ต้องใช้ recursive descent parser (ดู `src/lib/safe-math.ts`)

---

## 12. Audit/History/Dashboard Requirements

### AuditLog
- เขียน entry ทุก action: CREATE, UPDATE, DELETE, CANCEL
- `entityType`: BUY_BILL, SELL_BILL, SORTING_BILL
- `details`: JSON string มี:
  - billNumber, totalAmount, itemCount, isCredit
  - `itemFormulas[]` (ถ้ามี weightExpression)
  - `sourceWeightExpression` (สำหรับ SortingBill)
  - `restoredWeight` (สำหรับ CANCEL)
- ห้ามแก้ไข/ลบ AuditLog entry

### History Page
- 3 tabs: รับซื้อ / ขาย / คัดแยก
- Pagination (10 bills/page)
- Collapsible bill cards
- แสดง: date, items count, totalAmount, customer (ถ้ามี), profit (Sell)
- Expand: รายการ items พร้อม weight + formula + price + amount
- แสดง formula ในรูปแบบ `857 กก.` บน + `จาก 860-3` สีเทาล่าง
- ปุ่ม "ยกเลิก" สำหรับ bill ที่ยังไม่ cancel (ต้องมีสิทธิ์ history.edit)

### Dashboard
- สรุปยอดวันนี้: buy amount, sell amount, buy weight, sell weight
- สต็อกทั้งหมด: total weight, total cost
- Recent bills (5 ล่าสุดแต่ละประเภท)
- Category summary: weight + cost แยกหมวด
- Product details: weight + cost แยกสินค้า

---

## 13. Deployment Requirements

### Environment
- Branch: `main` (deploy อัตโนมัติจาก push)
- Hosting: Vercel + Supabase
- Required env vars:
  - `DATABASE_URL` (Supabase Postgres connection string)
  - `JWT_SECRET` (random string อย่างน้อย 32 chars)

### Build
- Build command: `next build` (จาก package.json `build` script)
- Output mode: `standalone` (จาก next.config.ts)
- ห้ามตั้ง `typescript.ignoreBuildErrors: true` (ต้องแก้ type errors จริง)

### Database Migration
- ใช้ Supabase SQL Editor สำหรับ production migration
- Additive only (ADD COLUMN, CREATE TABLE)
- ทุก column ใหม่ต้องเป็น nullable หรือมี default
- ห้าม `prisma migrate reset` บน production
- ห้าม `bun run prisma/seed.ts` บน production

### Pre-deploy Verification
- `bun run lint` exit 0
- `grep "provider" prisma/schema.prisma` = `postgresql`
- `git diff` ไม่มี `.env`, `db/custom.db`, secret

---

## 14. Acceptance Criteria สำหรับระบบที่สร้างใหม่

### บังคับผ่านทั้งหมดก่อนใช้งานจริง

#### A. Login & Auth
- [ ] Login ด้วย username + password ได้
- [ ] ถ้า password ผิด → error message
- [ ] ถ้า user isActive=false → login ไม่ได้
- [ ] Token เก็บใน localStorage
- [ ] ทุก API request แนบ `Authorization: Bearer <token>`
- [ ] Logout ล้าง token

#### B. Buy Bill
- [ ] เลือกสินค้าจาก combobox ได้
- [ ] ใส่น้ำหนัก + ราคา → คำนวณ total อัตโนมัติ
- [ ] เพิ่มหลายรายการใน cart
- [ ] บันทึก bill → สร้าง StockLot
- [ ] ตรวจ stock เพิ่มถูกต้อง
- [ ] ซื้อเชื่อ → สร้าง CreditEntry (PAYABLE)

#### C. Sell Bill
- [ ] เลือกสินค้าที่มี stock
- [ ] ตรวจ stock พอก่อนขาย
- [ ] FIFO deduction ถูกต้อง (lot เก่าก่อน)
- [ ] costPerKg = weighted average ของ lots ที่ตัด
- [ ] ขายเชื่อ → สร้าง CreditEntry (RECEIVABLE)

#### D. Sorting Bill
- [ ] เลือกสินค้าต้นทาง (steel category)
- [ ] ใส่ source weight + price
- [ ] เพิ่ม sorted items (รวม waste)
- [ ] FIFO deduction source stock
- [ ] Create StockLot ใหม่สำหรับ output items
- [ ] lossWeight = sourceWeight - sum(item weight)
- [ ] bonusAmount = (sortedPrice - sourcePrice) × weight × 10%

#### E. Cancel Bill (ต้อง rebuild)
- [ ] Cancel BuyBill → restore stock (ถ้ายังไม่ถูกใช้)
- [ ] Cancel SellBill → restore stock + ลบ CreditEntry
- [ ] Cancel SortingBill → restore source stock only (output left untouched by design)
- [ ] ทุก cancel เขียน AuditLog CANCEL

#### F. History
- [ ] 3 tabs ทำงาน
- [ ] Pagination ทำงาน
- [ ] Expand bill แสดงรายการ items
- [ ] แสดง weight + formula (ถ้ามี)
- [ ] ปุ่ม cancel ทำงาน

#### G. Stock Page
- [ ] ดูสต็อก group by category
- [ ] ดู StockLot แต่ละ lot
- [ ] แสดง avg cost per kg

#### H. Dashboard
- [ ] แสดงยอดวันนี้ถูกต้อง
- [ ] แสดง recent bills
- [ ] แสดง category summary

#### I. Excel Import (ต้อง rebuild)
- [ ] ปุ่ม import แสดงในหน้า Buy
- [ ] เลือกไฟล์ .xls/.xlsx ได้
- [ ] TIS-620 encoding ทำงาน
- [ ] Preview dialog แสดง rows
- [ ] Auto-match สินค้า (ไม่ข้ามหมวด)
- [ ] ผู้ใช้แก้ mapping ได้
- [ ] Import เข้า cart ได้

#### J. Weight Formula (ต้อง rebuild DB + code)
- [ ] พิมพ์ `860-3` → preview `= 857 กก.`
- [ ] Enter → input ยังเป็น `860-3`
- [ ] Cart แสดง `857 กก.` + `จาก 860-3`
- [ ] History แสดง formula
- [ ] DB เก็บ `weightExpression` field
- [ ] AuditLog เก็บ `itemFormulas[]`

#### K. Bill Number (ต้อง rebuild)
- [ ] สร้าง bill → ได้ billNumber (BUY-2569-XXXXX)
- [ ] Sequence นับถูกต้อง
- [ ] รีเซ็ตทุกปี
- [ ] Unique constraint

#### L. AuditLog (ต้อง rebuild)
- [ ] CREATE/UPDATE/DELETE/CANCEL entries
- [ ] details มี itemFormulas[] (ถ้ามี)
- [ ] ห้ามแก้/ลบ entries

#### M. User Roles
- [ ] admin เห็นทุกเมนู
- [ ] staff ไม่เห็นเมนู "ผู้ใช้งาน", "สินค้า", "พนักงาน"
- [ ] staff ไม่สามารถ create/edit/delete users/products/employees

#### N. Deployment
- [ ] `bun run lint` exit 0
- [ ] `npx tsc --noEmit` ไม่มี error ใหม่
- [ ] Vercel build success
- [ ] Production smoke test ผ่าน (login + buy + sell + sort + cancel + history)
- [ ] ไม่มี error 5xx ใน Vercel logs

---

## 15. ข้อห้ามเด็ดขาด

- 🚫 ห้ามใช้ `eval()` หรือ `new Function()`
- 🚫 ห้าม hardcode password ใน source
- 🚫 ห้าม commit `.env` หรือ secret
- 🚫 ห้าม `prisma migrate reset` บน production
- 🚫 ห้าม seed production DB
- 🚫 ห้าม hard delete bill ใน DB (ใช้ soft delete)
- 🚫 ห้ามแก้ stock ตรงๆ ใน DB (ใช้ bill/cancel)
- 🚫 ห้ามเปลี่ยน schema.prisma provider เป็น sqlite แล้ว commit
- 🚫 ห้าม push โดยมี `db/custom.db` ใน diff
- 🚫 ห้าม auto-match สินค้าข้ามหมวดวัสดุ
- 🚫 ห้ามลบ AuditLog entries
- 🚫 ห้ามตั้ง `typescript.ignoreBuildErrors: true`
