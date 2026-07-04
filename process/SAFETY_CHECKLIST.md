# Production Safety Checklist — ยงเฮง มหาชัย รีไซเคิล

> Checklist มาตรฐานสำหรับการ migration + deploy + smoke test
> วันที่: 27/06/2569

---

## 1. ก่อน Migration (Pre-migration)

### 1.1 Backup
- [ ] สร้าง Supabase backup: https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups
- [ ] ตั้งชื่อ `pre-<feature-name>-migration-<date>`
- [ ] บันทึก backup ID ไว้ (ถ้าต้อง rollback)

### 1.2 บันทึก Row Counts (ก่อน)
- [ ] เปิด Supabase SQL Editor
- [ ] รัน query:
```sql
SELECT 'BuyBill' AS t, COUNT(*) FROM "BuyBill"
UNION ALL SELECT 'SellBill', COUNT(*) FROM "SellBill"
UNION ALL SELECT 'SortingBill', COUNT(*) FROM "SortingBill"
UNION ALL SELECT 'BuyBillItem', COUNT(*) FROM "BuyBillItem"
UNION ALL SELECT 'SellBillItem', COUNT(*) FROM "SellBillItem"
UNION ALL SELECT 'SortingBillItem', COUNT(*) FROM "SortingBillItem"
UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
UNION ALL SELECT 'ProductCategory', COUNT(*) FROM "ProductCategory"
UNION ALL SELECT 'User', COUNT(*) FROM "User"
UNION ALL SELECT 'Customer', COUNT(*) FROM "Customer"
UNION ALL SELECT 'Employee', COUNT(*) FROM "Employee"
UNION ALL SELECT 'StockLot', COUNT(*) FROM "StockLot";
```
- [ ] บันทึกผลลัพธ์ไว้เปรียบเทียบหลัง migration

### 1.3 ตรวจ Code State
- [ ] `git status` — working tree clean (หรือมีเฉพาะ changes ที่ตั้งใจ)
- [ ] `grep "provider" prisma/schema.prisma` → ต้องเป็น `postgresql`
- [ ] ตรวจ diff ไม่มี `.env` หรือ `db/custom.db`
- [ ] ตรวจ diff ไม่มี secret (password, key, token)
- [ ] `bun run lint` → exit 0

### 1.4 ตรวจ Migration SQL
- [ ] อ่าน SQL ทั้งหมด — ต้องเป็น additive only (ADD COLUMN, CREATE TABLE)
- [ ] ไม่มี DROP, ALTER (ของเดิม), TRUNCATE, DELETE
- [ ] ทุก column ใหม่ต้องเป็น nullable หรือมี default
- [ ] มี BEGIN/COMMIT transaction
- [ ] มี verification queries ด้านล่าง

---

## 2. ระหว่าง Migration

### 2.1 Run Migration
- [ ] เปิด https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/sql/new
- [ ] วาง SQL ทั้งหมด
- [ ] กด Run
- [ ] ตรวจผลลัพธ์ — ต้องไม่มี error
- [ ] ถ้ามี error → หยุดทันที + rollback ด้วย rollback SQL

### 2.2 Monitor
- [ ] รอจน query เสร็จ (ปกติ < 5 วินาที)
- [ ] ตรวจว่าไม่มี active sessions ที่ค้าง
- [ ] ถ้าระหว่าง migration มี user ใช้งานอยู่ → migration อาจ lock → รอหรือ rollback

---

## 3. หลัง Migration (Post-migration)

### 3.1 Verify Columns
- [ ] รัน verification query:
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN (/* columns ที่เพิ่ม */)
ORDER BY table_name, column_name;
```
- [ ] ตรวจว่ามีจำนวน rows ถูกต้อง
- [ ] ตรวจ `is_nullable = 'YES'` สำหรับทุก column ใหม่

### 3.2 Verify Row Counts (หลัง)
- [ ] รัน row count query เดิม (จาก 1.2)
- [ ] เปรียบเทียบกับก่อน migration — ต้องเท่ากันทุกตาราง

### 3.3 Verify Backward Compat
- [ ] รัน query ตรวจข้อมูลเดิม:
```sql
-- ตัวอย่างสำหรับ weightExpression
SELECT COUNT(*) FILTER (WHERE "weightExpression" IS NOT NULL) AS rows_with_formula,
       COUNT(*) AS total
FROM "BuyBillItem";
```
- [ ] `rows_with_formula` ต้องเป็น 0 (ข้อมูลเดิมยังเป็น NULL)

---

## 4. ก่อน Deploy (Pre-deploy)

### 4.1 Code Review
- [ ] `git diff origin/main..HEAD` — ตรวจทุกบรรทัด
- [ ] ไม่มี hardcoded password/secret
- [ ] ไม่มี `.env` ใน diff
- [ ] ไม่มี `db/custom.db` ใน diff
- [ ] ไม่มี temp files (_tmp_*, *.bak)

### 4.2 Schema Check
- [ ] `grep "provider" prisma/schema.prisma` → `postgresql`
- [ ] schema ตรงกับ DB ที่ migrate แล้ว (column ใหม่ต้องมีใน schema)

### 4.3 Type Check + Lint
- [ ] `bun run lint` → exit 0
- [ ] `npx tsc --noEmit` → ไม่มี error ใหม่ (error ใน `examples/` และ `skills/` เป็น pre-existing — ไม่เกี่ยว)

### 4.4 Commit + Push
- [ ] `git add <files>` — เฉพาะไฟล์ที่ตั้งใจ
- [ ] `git commit -m "feat: <description>"`
- [ ] `git push origin main`

---

## 5. หลัง Deploy (Post-deploy)

### 5.1 Vercel Deploy Status
- [ ] เปิด https://vercel.com/dashboard
- [ ] ดู deployment ล่าสุด — รอจน status = "Ready"
- [ ] ถ้า status = "Error" → ดู build logs + rollback code

### 5.2 Smoke Test พื้นฐาน
- [ ] เปิด https://st-yongheng-recycle.vercel.app/
- [ ] ตรวจ login page แสดงปกติ
- [ ] Login ด้วย `01` / <password>
- [ ] Dashboard โหลดสำเร็จ
- [ ] ไม่มี error ใน browser console

### 5.3 Smoke Test Buy Bill
- [ ] ไปที่หน้า "รับซื้อ"
- [ ] เลือกสินค้า (เช่น "หนาพิเศษ")
- [ ] ใส่น้ำหนัก = `100` (หรือ `100-5` ถ้าทดสอบ formula)
- [ ] ใส่ราคา = `10`
- [ ] กด "เพิ่มรายการ"
- [ ] ตรวจ cart แสดงรายการถูกต้อง
- [ ] ใส่ note = `SMOKE_TEST_BUY_<date>`
- [ ] กด "บันทึกใบรับซื้อ"
- [ ] ตรวจ toast success + ยอดถูกต้อง (100 × 10 = 1000)
- [ ] บันทึก bill ID (จาก URL หรือ history)

### 5.4 Smoke Test Sell Bill
- [ ] ไปที่หน้า "ขาย"
- [ ] เลือกสินค้าที่มี stock (จาก buy ข้างบน)
- [ ] ใส่น้ำหนัก = `50` (น้อยกว่า stock)
- [ ] ใส่ราคาขาย = `15`
- [ ] กด "เพิ่มรายการ"
- [ ] ใส่ note = `SMOKE_TEST_SELL_<date>`
- [ ] กด "บันทึกใบขาย"
- [ ] ตรวจ toast success + ยอดขาย 750 + ต้นทุน FIFO

### 5.5 Smoke Test Sorting Bill
- [ ] ไปที่หน้า "คัดแยก"
- [ ] เลือกสินค้าต้นทาง (steel)
- [ ] ใส่ source weight = `30`
- [ ] ใส่ source price = `5`
- [ ] เพิ่ม sorted item: สินค้า + น้ำหนัก 20 + ราคา 8
- [ ] ใส่ note = `SMOKE_TEST_SORT_<date>`
- [ ] กด "บันทึกใบคัดแยก"
- [ ] ตรวจ toast success + loss weight = 10

### 5.6 Smoke Test Cancel (ถ้ามี feature)
- [ ] ไปที่หน้า "ประวัติรายการ"
- [ ] หา bill ที่สร้าง (note: SMOKE_TEST_*)
- [ ] กดปุ่ม "ยกเลิก" (ถ้ามี)
- [ ] ใส่เหตุผล: `cancel smoke test`
- [ ] ยืนยัน
- [ ] ตรวจ toast success

### 5.7 Smoke Test History
- [ ] ไปที่หน้า "ประวัติรายการ"
- [ ] สลับ tab รับซื้อ/ขาย/คัดแยก
- [ ] คลิก bill เพื่อขยาย
- [ ] ตรวจรายการ items แสดงถูกต้อง
- [ ] ตรวจยอดรวมตรงกับที่สร้าง

### 5.8 Smoke Test AuditLog (ถ้ามี feature)
- [ ] ใน Supabase SQL Editor:
```sql
SELECT action, "entityType", "userName", "createdAt"
FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
ORDER BY "createdAt" DESC
LIMIT 20;
```
- [ ] ตรวจมี entries CREATE/CANCEL สำหรับ bills ที่สร้าง/ยกเลิก

### 5.9 Smoke Test Stock Restore (ถ้า cancel)
- [ ] ใน Supabase SQL Editor:
```sql
SELECT p.name, SUM(sl."remainingWeight") AS total
FROM "StockLot" sl
JOIN "Product" p ON p.id = sl."productId"
WHERE p.name = '<product ที่ทดสอบ>'
GROUP BY p.name;
```
- [ ] ตรวจ stock กลับเดิมหลัง cancel

---

## 6. Cleanup

### 6.1 Cleanup Test Bills
- [ ] Cancel bill SMOKE_TEST_BUY_* (ถ้ามี cancel feature)
- [ ] Cancel bill SMOKE_TEST_SELL_*
- [ ] Cancel bill SMOKE_TEST_SORT_*
- [ ] ห้าม hard delete — ใช้ cancel เท่านั้น

### 6.2 Final Verification
- [ ] ลองสร้าง bill จริง 1 รายการ (note: ไม่ใช่ SMOKE_TEST)
- [ ] ตรวจ Vercel logs ไม่มี error 5xx: https://vercel.com/dashboard → project → Logs
- [ ] ตรวจ Supabase logs ไม่มี error: https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/logs

---

## 7. Rollback Plan

### 7.1 ถ้า migration ล้มเหลว
- [ ] รัน rollback SQL (มีในไฟล์ migration):
```sql
-- ตัวอย่างสำหรับ weightExpression
ALTER TABLE "BuyBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SellBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "sourceWeightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "weighedTotalExpression";
```

### 7.2 ถ้า code มี bug
- [ ] `git revert <commit-hash>`
- [ ] `git push origin main`
- [ ] รอ Vercel redeploy

### 7.3 ถ้า DB พัง
- [ ] Restore จาก Supabase backup (จากขั้นตอน 1.1)
- [ ] ติดต่อ Supabase support ถ้าจำเป็น

---

## 8. อาการที่ต้องหยุดและ rollback (Red Flags)

🚨 **หยุดทันที ถ้าเจอ**:
- หน้า login ขาว / 500 error
- API return 500 ทุก endpoint
- Toast error "column does not exist" (DB migration ไม่ครบ)
- Stock ผิดปกติหลัง cancel (เช่น ติดลบ, ไม่ restore)
- AuditLog ไม่มี entry ใหม่
- ผู้ใช้ login ไม่ได้ทั้งที่รหัสถูก
- Vercel build fail ระหว่าง deploy

---

## 9. ห้าม (Absolute Prohibitions)

- ❌ ห้าม deploy code ก่อน DB migration (ถ้ามี schema changes)
- ❌ ห้าม `prisma migrate reset` บน production
- ❌ ห้าม `bun run prisma/seed.ts` บน production
- ❌ ห้าม hard delete bill ใน DB
- ❌ ห้ามแก้ stock ตรงๆ ใน DB
- ❌ ห้าม push โดย schema.prisma provider != postgresql
- ❌ ห้าม push โดยมี `.env` หรือ `db/custom.db` ใน diff
- ❌ ห้าม push โดยมี secret ใน code
- ❌ ห้าม skip smoke test หลัง deploy
- ❌ ห้าม ignore error ใน Vercel/Supabase logs
