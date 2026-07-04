# Current Open Issues — ยงเฮง มหาชัย รีไซเคิล

> งานที่ยังต้องทำ — แยกตาม priority
> วันที่: 27/06/2569

---

## P0 — ต้องทำก่อนใช้งานจริง

### P0-1: Bill Cancel Feature หายไปจาก codebase
**สถานะ**: ❌ Code หายไป (เคยทำแล้วใน Task ก่อนหน้า แต่ถูก reset)

**รายละเอียด**:
- ไม่มี `src/app/api/buy-bills/[id]/route.ts`
- ไม่มี `src/app/api/sell-bills/[id]/route.ts`
- ไม่มี `src/app/api/sorting-bills/[id]/route.ts`
- schema.prisma ไม่มี `isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason` fields
- ไม่มี `billNumber` field
- ไม่มี `AuditLog` model
- ไม่มี `src/lib/bill-helpers.ts`

**ผลกระทบ**: ถ้าพนักงานสร้างบิลผิด → ไม่สามารถยกเลิกได้ (ต้องแก้ใน DB ตรงๆ ซึ่งเป็นอันตราย)

**วิธีแก้**:
1. เพิ่ม fields ใน schema.prisma:
   - `BuyBill.isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason`, `billNumber`
   - `SellBill.isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason`, `billNumber`
   - `SortingBill.isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason`, `billNumber`
   - สร้าง `AuditLog` model
2. สร้าง `src/lib/bill-helpers.ts` (generateBillNumber + writeAuditLog)
3. สร้าง `src/app/api/{buy,sell,sorting}-bills/[id]/route.ts` พร้อม DELETE handler
4. อัปเดต POST routes ให้ generate billNumber + write AuditLog
5. Migration SQL สำหรับ Supabase
6. อัปเดต history-page.tsx ให้แสดง billNumber + cancel button

---

### P0-2: Production DB Migration สำหรับ Weight Formula Tracking
**สถานะ**: ⏳ SQL พร้อม, รอ owner run ใน Supabase SQL Editor

**ไฟล์ที่เตรียมไว้**: `prisma/migrations/add_weight_expression.sql`

**คอลัมน์ใหม่ 5 ตัว** (additive only, nullable TEXT):
- `BuyBillItem.weightExpression`
- `SellBillItem.weightExpression`
- `SortingBillItem.weightExpression`
- `SortingBill.sourceWeightExpression`
- `SortingBill.weighedTotalExpression`

**ขั้นตอน**:
1. Owner เปิด https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/sql/new
2. วาง SQL จากไฟล์ `prisma/migrations/add_weight_expression.sql`
3. กด Run
4. รัน verification queries (ในไฟล์เดียวกัน)
5. ตรวจผลลัพธ์ — ต้องมี 5 columns ใหม่ + row counts ไม่เปลี่ยน

**ผลกระทบถ้าไม่ run**: code ที่จะใช้ weightExpression (เมื่อ recreate แล้ว) จะ fail เพราะ columns ไม่มีใน DB

---

### P0-3: Weight Formula Tracking Code หายไปจาก codebase
**สถานะ**: ❌ Code หายไป (เคยทำใน Task 21 แต่ถูก reset)

**รายละเอียด**: parser (`src/lib/safe-math.ts`) ยังอยู่ แต่:
- schema.prisma ไม่มี `weightExpression` fields
- types.ts ไม่มี weightExpression ใน interfaces
- API routes ไม่รับ/เก็บ weightExpression
- buy/sell/sort pages ไม่แสดง live preview / formula hint ใน cart
- history-page.tsx ไม่แสดง formula

**ผลกระทบ**: ผู้ใช้กรอก `860-3` → ระบบคำนวณ 857 ได้ แต่ไม่เก็บสูตร — ใน history เห็นแค่ 857 ไม่เห็นว่ามาจาก 860-3

**วิธีแก้**:
1. รัน P0-2 migration ก่อน
2. Recreate Task 21:
   - เพิ่ม weightExpression ใน schema.prisma (5 fields)
   - เพิ่มใน types.ts
   - อัปเดต 3 API routes (buy/sell/sorting)
   - อัปเดต 4 UI pages (buy/sell/sort/history) ให้แสดง live preview + formula hint
3. Push ไป GitHub main → Vercel deploy

---

### P0-4: Excel Import Feature หายไปจาก codebase
**สถานะ**: ❌ Code หายไป

**รายละเอียด**:
- ไม่มี `src/app/api/excel/parse/route.ts`
- ไม่มี `src/components/excel-import-dialog.tsx`
- buy-page.tsx ไม่มี Excel import button

**ผลกระทบ**: พนักงานไม่สามารถ import บิลจาก Excel เดิมได้ — ต้องกรอกทีละรายการ

**วิธีแก้**: Recreate Task ที่เคยทำ (TIS-620 encoding + preview dialog + auto-match product)

---

## P1 — ควรทำต่อ

### P1-1: Product Alias Mapping หายไปจาก codebase
**สถานะ**: ❌ Files หายไป (เคยทำใน Task 20)

**ไฟล์ที่หายไป**:
- `data/product-alias-approved-candidates.csv` (48 รายการ)
- `data/product-alias-need-review.csv` (14 รายการ)
- `data/product-no-match.csv` (60 รายการ)
- `data/product_alias_proposal.csv` (122 รายการ)
- `docs/PRODUCT_NAME_MAPPING_REPORT.md` (อัปเดต)

**ผลกระทบ**: ไม่สามารถ map ชื่อสินค้าเดิมจาก Excel → สินค้าใหม่ได้อัตโนมัติ

**วิธีแก้**:
1. Recreate ไฟล์ mapping ทั้งหมด (ต้องการ Excel เดิมของ owner)
2. ประยุกต์ Owner Business Rules (cross-category prohibition)
3. สร้าง ProductAlias table + import logic (ถ้าต้องการ auto-match)

---

### P1-2: User 04 (พนักงาน ยงเฮง) ยังไม่ได้สร้าง
**สถานะ**: ⏳ รอ owner สร้าง

**รายละเอียด**: ใน codebase มีแค่ `prisma/create-user-01.ts` สำหรับ user 01 — ไม่มี script สำหรับ user 04

**วิธีแก้**:
1. ใช้หน้า Users ในเว็บ (login as admin) เพื่อสร้าง user 04
2. หรือสร้าง script `prisma/create-user-04.ts` คล้าย create-user-01.ts

---

### P1-3: User 01 Role ใน production
**สถานะ**: ⚠️ ไม่แน่ใจ

**รายละเอียด**: worklog Task 18 บอกว่า 01 ถูก promote เป็น admin ใน DB production — แต่ seed.ts ยังสร้าง 01 เป็น staff

**วิธีตรวจ**:
```sql
SELECT username, role, "isActive" FROM "User" WHERE username = '01';
```

ถ้า role = staff → promote ผ่านหน้า Users หรือ SQL:
```sql
UPDATE "User" SET role = 'admin' WHERE username = '01';
```

---

### P1-4: `db/custom.db` ถูก track ใน git
**สถานะ**: ⚠️ Pre-existing issue

**รายละเอียด**: `db/custom.db` (SQLite binary) ถูก commit เข้า repo — ไม่ควร track

**ผลกระทบ**: ทุกครั้งที่ run dev local + สร้าง bill → binary file เปลี่ยน → ปนมาใน diff

**วิธีแก้**:
1. เพิ่ม `db/*.db` ใน `.gitignore`
2. `git rm --cached db/custom.db`
3. Commit + push

---

### P1-5: `JWT_SECRET` ไม่อยู่ใน .env ของ local sandbox
**สถานะ**: ⚠️ ทำให้ local dev server fail

**รายละเอียด**: `.env` มีแค่ `DATABASE_URL` — auth.ts จะ throw error ทุก request

**วิธีแก้**:
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

> ⚠️ อย่า commit `.env` (มันถูก gitignore อยู่แล้วแต่ระวัง)

---

## P2 — ทำทีหลังได้

### P2-1: Sorting Source Product รองรับทุกหมวด
**สถานะ**: ⚠️ ปัจจุบัน sort-page.tsx กรอง source product เฉพาะ STEEL category

**รายละเอียด**: ในจริง owner อาจต้องการคัดแยกจาก source ที่ไม่ใช่เหล็ก (เช่น คัด "ของแกะ" เป็น มอเตอร์/คอมดำ)

**วิธีแก้**: ลบ filter `category.type === 'STEEL'` ใน sort-page.tsx (ถ้า owner ยืนยัน)

---

### P2-2: `prisma/schema.prisma.sqlite.bak` หายไป
**สถานะ**: ℹ️ ไม่มีผลกระทบ

**รายละเอียด**: worklog Task 19 บอกว่าลบ backup files ไปแล้ว — ปัจจุบันไม่มี `.bak` ใน repo (ถูกต้อง)

---

### P2-3: Vercel Build `typescript.ignoreBuildErrors`
**สถานะ**: ⚠️ มีอยู่ใน next.config.ts

**รายละเอียด**: `next.config.ts` ตั้ง `ignoreBuildErrors: true` สำหรับ TypeScript — ทำให้ Vercel build ไม่ตรวจ type errors

**ผลกระทบ**: code ที่มี type error จะ deploy ผ่าน (ระบบอาจพังตอน runtime)

**วิธีแก้**: ลบบรรทัดนี้ออกจาก next.config.ts + แก้ type errors ทั้งหมด

---

### P2-4: ทดสอบ TIS-620 Excel ใน production
**สถานะ**: ⏳ รอ P0-4 (Excel import feature) ก่อน

**รายละเอียด**: parser TIS-620 ทำงานใน local ได้ แต่ยังไม่เคยทดสอบกับ `.xls` จริงจากระบบเดิม

---

### P2-5: ตั้งค่า timezone อย่างชัดเจน
**สถานะ**: ℹ️ ปัจจุบันใช้ server timezone

**รายละเอียด**: ระบบใช้ `new Date()` หลายจุด — ควรตั้ง timezone เป็น Asia/Bangkok อย่างชัดเจน

---

## สรุปสถานะรวม

| Priority | จำนวน | สถานะ |
|----------|-------|-------|
| **P0** | 4 | ต้องทำก่อนใช้งานจริง — cancel feature, migration, weight formula code, excel import |
| **P1** | 5 | ควรทำ — alias mapping, user 04, role 01, db/custom.db, JWT_SECRET |
| **P2** | 5 | ทำทีหลัง — sorting source, tsconfig, timezone, etc. |

### สถานะ features ที่หายไปจาก codebase ปัจจุบัน (เคยทำใน Task 20/21/22)

| Feature | สถานะใน codebase | ต้อง recreate? |
|---------|------------------|----------------|
| billNumber | ❌ ไม่มี | ✅ ใน P0-1 |
| isCancelled (soft delete) | ❌ ไม่มี | ✅ ใน P0-1 |
| AuditLog | ❌ ไม่มี | ✅ ใน P0-1 |
| bill-helpers.ts | ❌ ไม่มี | ✅ ใน P0-1 |
| DELETE /api/{type}-bills/{id} | ❌ ไม่มี | ✅ ใน P0-1 |
| Excel import | ❌ ไม่มี | ✅ ใน P0-4 |
| weightExpression DB storage | ❌ ไม่มี | ✅ ใน P0-3 (หลัง P0-2 migration) |
| Product alias mapping | ❌ ไม่มี | ✅ ใน P1-1 |
| `parseWeightExpression` parser | ✅ มี (`src/lib/safe-math.ts`) | ไม่ต้อง — ใช้ได้เลย |
