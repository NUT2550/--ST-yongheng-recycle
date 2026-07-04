# Database Context — ยงเฮง มหาชัย รีไซเคิล

> Prisma schema และ stock flow สำหรับเข้าใจระบบ
> วันที่: 27/06/2569
> Source: `prisma/schema.prisma` (สถานะปัจจุบันใน repo)

---

## 1. Database Provider

| Environment | Provider | URL source |
|-------------|----------|------------|
| **Production** (Supabase) | `postgresql` | `DATABASE_URL` env var (Vercel) |
| **Local sandbox** | `postgresql` (schema) / SQLite (actual .env) | `.env` file — ปัจจุบันเป็น `file:/home/z/my-project/db/custom.db` |

> ⚠️ schema.prisma ใน repo ใช้ `postgresql` เสมอ — ถ้าเปลี่ยนเป็น `sqlite` ชั่วคราวสำหรับ local test ต้อง revert ก่อน commit

---

## 2. ตารางหลัก (Models)

### Master Data

#### `ProductCategory`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | PK |
| name | String (unique) | ชื่อหมวด เช่น "เหล็ก", "ทองแดง" |
| type | String | `STEEL` หรือ `METAL` |
| sortOrder | Int | ลำดับแสดงผล |
| products | Product[] | relation |

> มี 7 หมวด: เหล็ก, ทองแดง, ทองเหลือง, แสตนเลส, อลูมีเนียม, ตะกั่ว, อื่นๆ

#### `Product`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | PK |
| name | String (unique) | ชื่อสินค้า |
| categoryId | String | FK → ProductCategory |
| defaultBuyPrice | Float (default 0) | ราคารับซื้อ default (user กรอกเองในแต่ละ transaction) |
| sortOrder | Int | |
| stockLots | StockLot[] | lots ในสต็อก |
| buyItems, sellItems, sortingSource, sortingItems | relations | |

> มี 56 สินค้าใน seed.ts

#### `Customer`
| Field | Type |
|-------|------|
| id | String (cuid) |
| name | String |
| phone | String? |
| sellBills | SellBill[] |
| creditEntry | CreditEntry[] |

#### `Employee`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| name | String | |
| phone | String? | |
| hireDate | DateTime? | ใช้คำนวณสัดส่วนโบนัส |
| isActive | Boolean (default true) | |
| bonuses | SortingBonus[] | |

#### `User`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| username | String (unique) | |
| password | String | bcrypt hash |
| name | String | ชื่อ display |
| role | String (default "staff") | `admin` หรือ `staff` |
| isActive | Boolean (default true) | false = deactivated, login ไม่ได้ |

---

### Stock

#### `StockLot`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | PK |
| productId | String | FK → Product |
| remainingWeight | Float | น้ำหนักคงเหลือ (กก.) |
| costPerKg | Float | ต้นทุนต่อกก. (ใช้คิด FIFO) |
| dateAdded | DateTime | วันที่เพิ่ม lot |
| source | String | `BUY`, `SORTING`, `BUY_CANCEL`, `SORT_CANCEL`, `SELL_CANCEL` |
| sourceId | String? | FK ไปยัง bill ที่สร้าง lot นี้ |

> แต่ละ lot = ก้อนสต็อกที่ซื้อมาในราคาเดียวกัน
> FIFO = ขายจาก lot เก่าก่อน (orderBy dateAdded ASC)

---

### Bills

#### `BuyBill` (ใบรับซื้อ)
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| date | DateTime | |
| isCredit | Boolean (default false) | ซื้อเชื่อ = สร้าง PAYABLE CreditEntry |
| note | String? | |
| items | BuyBillItem[] | relation |
| totalAmount | Float (default 0) | ผลรวม amount ของ items |
| createdAt, updatedAt | DateTime | |

> ⚠️ **ไม่มี** `billNumber`, `isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason` ในสถานะปัจจุบัน

#### `BuyBillItem`
| Field | Type |
|-------|------|
| id | String (cuid) |
| buyBillId | String (FK) |
| productId | String (FK) |
| weight | Float |
| pricePerKg | Float |
| totalAmount | Float |

> ⚠️ ไม่มี `weightExpression` field ในสถานะปัจจุบัน

#### `SellBill` (ใบขาย)
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| date | DateTime | |
| customerId | String? | null = ลูกค้าทั่วไป |
| customer | Customer? | relation |
| isCredit | Boolean (default false) | ขายเชื่อ = สร้าง RECEIVABLE CreditEntry |
| note | String? | |
| items | SellBillItem[] | |
| totalAmount | Float | ยอดขายรวม |
| totalCost | Float (default 0) | ต้นทุน FIFO รวม |
| createdAt, updatedAt | DateTime | |

> ⚠️ ไม่มี `billNumber`, `isCancelled` fields

#### `SellBillItem`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| sellBillId | String (FK) | |
| productId | String (FK) | |
| weight | Float | |
| pricePerKg | Float | ราคาขาย |
| totalAmount | Float | weight × pricePerKg |
| costPerKg | Float (default 0) | ต้นทุน FIFO (weighted average) |
| totalCost | Float (default 0) | weight × costPerKg |

> ⚠️ ไม่มี `weightExpression` field

#### `SortingBill` (ใบคัดแยก)
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| date | DateTime | |
| sourceProductId | String | สินค้าต้นทาง (เช่น เหล็กผสม) |
| sourceProduct | Product | relation ("SortingSource") |
| sourceWeight | Float | น้ำหนักที่คัดมา |
| sourcePricePerKg | Float (default 0) | ราคารับซื้อต้นทาง (พนักงานใส่) |
| weighedTotal | Float (default 0) | น้ำหนักรวมที่ชั่งแยกได้ |
| lossWeight | Float (default 0) | sourceWeight - sum(item weight) |
| lossCost | Float (default 0) | lossWeight × sourceCostPerKg |
| note | String? | |
| items | SortingBillItem[] | |
| bonuses | SortingBonus[] | |
| createdAt, updatedAt | DateTime | |

> ⚠️ ไม่มี `billNumber`, `isCancelled`, `sourceWeightExpression`, `weighedTotalExpression`

#### `SortingBillItem`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| sortingBillId | String (FK) | |
| productId | String (FK) | |
| weight | Float | |
| isWaste | Boolean (default false) | true = ขยะ |
| costPerKg | Float (default 0) | ต้นทุน FIFO จาก source |
| totalCost | Float (default 0) | weight × costPerKg |
| sortedPricePerKg | Float (default 0) | ราคารับซื้อสินค้าที่คัดได้ |
| bonusAmount | Float (default 0) | (sortedPrice - sourcePrice) × weight × 10% |

> ⚠️ ไม่มี `weightExpression` field

---

### Credit (ค้างชำระ)

#### `CreditEntry`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| type | String | `RECEIVABLE` (ค้างรับ) หรือ `PAYABLE` (ค้างจ่าย) |
| amount | Float | ยอดเต็ม |
| paidAmount | Float (default 0) | ยอดที่จ่ายแล้ว |
| customerId | String? | สำหรับ RECEIVABLE |
| referenceType | String | `BUY_BILL` หรือ `SELL_BILL` |
| referenceId | String? | FK ไปยัง bill |
| description | String? | |
| date | DateTime | |
| isSettled | Boolean (default false) | true = จ่ายครบ |
| payments | CreditPayment[] | |

#### `CreditPayment`
| Field | Type |
|-------|------|
| id | String (cuid) |
| creditEntryId | String (FK) |
| amount | Float |
| date | DateTime |
| note | String? |

---

### Bonus

#### `SortingBonus`
| Field | Type | หมายเหตุ |
|-------|------|---------|
| id | String (cuid) | |
| date | DateTime | |
| employeeId | String (FK) | |
| sortingBillId | String? | อาจเป็น null สำหรับ bonus ที่สร้าง manual |
| totalWeight | Float (default 0) | น้ำหนักรวมที่คัดแยก |
| ratePerKg | Float (default 0) | อัตราโบนัส บาท/กก. |
| totalAmount | Float (default 0) | ยอดโบนัสรวม |
| note | String? | |
| isPaid | Boolean (default false) | |
| paidDate | DateTime? | |

---

## 3. Relations สำคัญ

```
ProductCategory 1───* Product 1───* StockLot
                          │
                          ├───* BuyBillItem *───1 BuyBill
                          ├───* SellBillItem *───1 SellBill *───1 Customer
                          ├───* SortingBillItem *───1 SortingBill (source)
                          └───1 SortingBill (source)

SellBill 1───* CreditEntry (RECEIVABLE)
BuyBill 1───* CreditEntry (PAYABLE)
CreditEntry 1───* CreditPayment

Employee 1───* SortingBonus *───1 SortingBill
```

---

## 4. Stock Flow

### Buy (รับซื้อ) → เพิ่ม stock
```
POST /api/buy-bills
  ↓
1. Create BuyBill + BuyBillItem
2. For each item: create StockLot
   - productId = item.productId
   - remainingWeight = item.weight
   - costPerKg = item.pricePerKg
   - source = "BUY"
   - sourceId = bill.id
   - dateAdded = bill.date
```

### Sell (ขาย) → ตัด stock (FIFO)
```
POST /api/sell-bills
  ↓
1. Pre-validate stock พอ (sum ของ lots ที่ remainingWeight > 0)
2. For each item:
   - Call deductStockFIFO(productId, weight, tx)
     - Find lots WHERE productId AND remainingWeight > 0 ORDER BY dateAdded ASC
     - Deduct จาก lot เก่าสุดก่อน → ลด remainingWeight
     - Track totalCost = sum(deductedWeight × lot.costPerKg)
     - Return { costPerKg: totalCost/weight, totalCost }
   - Create SellBillItem พร้อม costPerKg + totalCost
3. If isCredit: create CreditEntry (RECEIVABLE)
```

### Sort (คัดแยก) → ตัด source + เพิ่ม output
```
POST /api/sorting-bills
  ↓
1. Pre-validate source stock พอ
2. Deduct source stock (FIFO) — ได้ sourceCostPerKg
3. For each output item (not waste):
   - Create SortingBillItem พร้อม costPerKg = sourceCostPerKg
   - Create new StockLot:
     - productId = item.productId
     - remainingWeight = item.weight
     - costPerKg = sourceCostPerKg (สืบทอดจาก source)
     - source = "SORTING"
     - sourceId = bill.id
4. lossWeight = sourceWeight - sum(item.weight)
5. lossCost = lossWeight × sourceCostPerKg
```

### Cancel Bill → restore stock
> ⚠️ **Cancel feature หายไปจาก codebase ปัจจุบัน**

ในเวอร์ชันก่อนหน้า (ที่หายไป):
- Cancel BuyBill → ลบ/ลด StockLot ที่ sourceId = bill.id
- Cancel SellBill → เพิ่ม StockLot ใหม่ source = "SELL_CANCEL" remainingWeight = item.weight costPerKg = item.costPerKg
- Cancel SortingBill → เพิ่ม StockLot source = "SORT_CANCEL" ให้ source product (เท่านั้น — output stock left untouched by design)

---

## 5. จุดที่ห้ามทำ (Forbidden Operations)

### Production Database
- ❌ ห้าม `prisma migrate reset` — จะลบข้อมูลทั้งหมด
- ❌ ห้าม `prisma db push --force-reset`
- ❌ ห้าม `bun run prisma/seed.ts` บน production (จะ overwrite ข้อมูล)
- ❌ ห้าม `TRUNCATE TABLE` ใดๆ บน production
- ❌ ห้าม `DELETE FROM "Product"` (จะ break FK)
- ❌ ห้าม `DROP TABLE` ใดๆ
- ❌ ห้ามแก้ stock ตรงๆ ใน DB (ใช้ bill/cancel เท่านั้น)
- ❌ ห้าม hard delete bill (ใช้ soft delete `isCancelled = true` ถ้ามี)

### Schema
- ❌ ห้ามเปลี่ยน provider จาก postgresql → sqlite แล้ว commit
- ❌ ห้ามลบ field ที่มีอยู่ (จะ break production)
- ✅ เพิ่ม field ใหม่ได้ ถ้าเป็น nullable หรือมี default

### Code
- ❌ ห้ามใช้ `eval()` หรือ `new Function()`
- ❌ ห้าม hardcode password ใน source
- ❌ ห้าม commit `.env` หรือไฟล์ที่มี secret
- ❌ ห้ามแก้ `src/lib/auth.ts` โดยใส่ hardcoded JWT_SECRET fallback

---

## 6. Useful Queries

### ดู stock คงเหลือทั้งหมด
```sql
SELECT
  p.name AS product,
  c.name AS category,
  COALESCE(SUM(sl."remainingWeight"), 0) AS total_weight,
  COALESCE(SUM(sl."remainingWeight" * sl."costPerKg"), 0) AS total_cost
FROM "Product" p
LEFT JOIN "StockLot" sl ON sl."productId" = p.id AND sl."remainingWeight" > 0
LEFT JOIN "ProductCategory" c ON c.id = p."categoryId"
GROUP BY p.id, p.name, c.name
ORDER BY c."sortOrder", p."sortOrder";
```

### ดู bills ล่าสุด
```sql
SELECT 'BUY' AS type, id, date, "totalAmount" FROM "BuyBill"
UNION ALL
SELECT 'SELL', id, date, "totalAmount" FROM "SellBill"
UNION ALL
SELECT 'SORT', id, date, "totalAmount" FROM "SortingBill"
ORDER BY date DESC
LIMIT 20;
```

### ดู user ทั้งหมด + role
```sql
SELECT username, name, role, "isActive" FROM "User" ORDER BY username;
```
