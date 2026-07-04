# Weight Formula Tracking — Deploy Checklist

> ใช้สำหรับ owner ตรวจสอบขั้นตอน deployment ของ Weight Formula Tracking
> วันที่: 27/06/2569
> Local test: ✅ ผ่านครบทุก case (Buy/Sell/Sort + error cases)
> Production migration: รอ owner อนุมัติ

---

## ขั้นตอน Deployment (ตามลำดับ)

### □ Step 1: Pre-deploy backup
- [ ] เปิด Supabase Dashboard → Database → Backups
- [ ] กด "Create backup" ตั้งชื่อ `pre-weight-formula-migration`
- [ ] รอจน backup สำเร็จ
- [ ] บันทึก backup ID ไว้ (ถ้าต้อง rollback)

### □ Step 2: บันทึก row counts ก่อน migration
- [ ] เปิด Supabase Dashboard → SQL Editor
- [ ] รัน query นี้ แล้วบันทึกผลลัพธ์:
```sql
SELECT 'BuyBill' AS t, COUNT(*) FROM "BuyBill"
UNION ALL SELECT 'SellBill', COUNT(*) FROM "SellBill"
UNION ALL SELECT 'SortingBill', COUNT(*) FROM "SortingBill"
UNION ALL SELECT 'BuyBillItem', COUNT(*) FROM "BuyBillItem"
UNION ALL SELECT 'SellBillItem', COUNT(*) FROM "SellBillItem"
UNION ALL SELECT 'SortingBillItem', COUNT(*) FROM "SortingBillItem";
```
- [ ] บันทึกผลลัพธ์ไว้เปรียบเทียบใน Step 4

### □ Step 3: Run migration SQL
- [ ] เปิดไฟล์ `docs/WEIGHT_FORMULA_PRODUCTION_MIGRATION_SQL.md`
- [ ] คัดลอก SQL block ในส่วน "SQL Migration Script"
- [ ] วางใน Supabase SQL Editor
- [ ] กด Run
- [ ] ตรวจผลลัพธ์ — ต้องไม่มี error

### □ Step 4: Verify migration สำเร็จ
- [ ] รัน verification queries จากไฟล์ migration SQL
- [ ] ตรวจ output:
  - ตารางแรก: ต้องมี **5 rows** (5 columns ใหม่)
  - ตารางที่ 2 (row counts): ต้องตรงกับ Step 2
  - ตารางที่ 3: `rows_with_formula = 0` สำหรับทุกตาราง (ข้อมูลเดิมยังเป็น NULL)
- [ ] ถ้าทั้ง 3 ตารางถูกต้อง → migration สำเร็จ

### □ Step 5: Push code ไป GitHub main
- [ ] ตรวจว่า local code มี weightExpression fields (commit `1600cd0` หรือใหม่กว่า):
```bash
git log --oneline | head -5
# ต้องเห็น commit ที่มี weightExpression changes
```
- [ ] Push ไป origin/main:
```bash
git push origin main
```
- [ ] รอ Vercel deploy สำเร็จ (ปกติ 1-3 นาที)

### □ Step 6: Vercel deploy verification
- [ ] เปิด https://st-yongheng-recycle.vercel.app/
- [ ] ตรวจว่า login page แสดงปกติ
- [ ] login ด้วย 01/[password]
- [ ] ตรวจว่า dashboard โหลดสำเร็จ

### □ Step 7: Production smoke test — Buy
- [ ] ไปที่หน้า "รับซื้อ"
- [ ] เลือกสินค้า เช่น "หนาพิเศษ"
- [ ] ใส่ weight = `860-3`
- [ ] ตรวจว่าแสดง **`= 857.00 กก.`** สีเขียวทันทีใต้ input
- [ ] ตรวจว่า input ยังแสดง `860-3` (ไม่เปลี่ยนเป็น 857)
- [ ] ใส่ราคา เช่น 10
- [ ] กด Enter — focus ย้ายไปช่อง price
- [ ] กด "เพิ่มรายการ"
- [ ] ตรวจ cart: ต้องแสดง `857.00 กก.` บน + `จาก 860-3` เทาเล็กล่าง
- [ ] ใส่ note = `TEST_WEIGHT_FORMULA_PROD_BUY`
- [ ] กด "บันทึกใบรับซื้อ"
- [ ] ตรวจ toast success — ต้องมี `(จาก 860-3)`
- [ ] บันทึก billNumber (เช่น BUY-2569-XXXXX)

### □ Step 8: Production smoke test — History (Buy)
- [ ] ไปที่หน้า "ประวัติรายการ"
- [ ] เลือก tab "รับซื้อ"
- [ ] คลิก bill ที่สร้างก่อนหน้าเพื่อขยาย
- [ ] ตรวจรายการ item:
  - น้ำหนักต้องแสดง `857.00 กก.` บน
  - ด้านล่างต้องมี `จาก 860-3` สีเทาเล็ก

### □ Step 9: Cancel test Buy bill
- [ ] ไปที่หน้าประวัติ → tab รับซื้อ
- [ ] หา bill ที่สร้าง (note: TEST_WEIGHT_FORMULA_PROD_BUY)
- [ ] กดปุ่ม "ยกเลิก" (ถ้ามี)
- [ ] ใส่เหตุผล: `cancel test`
- [ ] ยืนยัน
- [ ] ไปที่หน้า "สต็อก" ตรวจว่าสต็อกกลับเดิม

### □ Step 10: Production smoke test — Sell (ถ้ามี stock)
- [ ] ไปที่หน้า "ขาย"
- [ ] เลือกสินค้าที่มี stock
- [ ] ใส่ weight = `1000-15-2`
- [ ] ตรวจ preview `= 983.00 กก.`
- [ ] input ยังแสดง `1000-15-2`
- [ ] ใส่ราคาขาย เช่น 20
- [ ] เพิ่มรายการ — cart ต้องแสดง `983.00 กก.` + `จาก 1000-15-2`
- [ ] ใส่ note = `TEST_WEIGHT_FORMULA_PROD_SELL`
- [ ] บันทึกใบขาย
- [ ] ไปที่ history → tab ขาย → ขยาย bill — ต้องเห็น formula

### □ Step 11: Production smoke test — Sort
- [ ] ไปที่หน้า "คัดแยก"
- [ ] เลือกสินค้าต้นทาง (steel)
- [ ] ใส่ source weight = `68.4-0.2`
- [ ] ตรวจ preview `= 68.20 กก.`
- [ ] input ยังแสดง `68.4-0.2`
- [ ] ใส่ source price
- [ ] ใส่ weighed total = `68.4-0.2` (preview 68.20)
- [ ] เพิ่ม sorted item น้ำหนัก `55-5` (= 50)
- [ ] ตรวจ preview 50.00 กก.
- [ ] เพิ่ม item 2 น้ำหนัก `20-1.8` (= 18.2)
- [ ] ใส่ note = `TEST_WEIGHT_FORMULA_PROD_SORT`
- [ ] บันทึกใบคัดแยก
- [ ] ไปที่ history → tab คัดแยก → ขยาย bill:
  - source weight ต้องแสดง `68.20 กก.` + `(จาก 68.4-0.2)`
  - item weights ต้องแสดง formula ใต้ weight

### □ Step 12: Production smoke test — Error cases
- [ ] หน้ารับซื้อ ลองใส่ `860-` → ต้องไม่แสดง preview (หรือ error)
- [ ] ลองใส่ `abc` → ต้องไม่แสดง preview
- [ ] ลองใส่ `10/0` → ต้องไม่แสดง preview
- [ ] กด "เพิ่มรายการ" ต้องมี toast error

### □ Step 13: Audit log verification (Supabase SQL Editor)
- [ ] รัน query นี้เพื่อดู audit logs:
```sql
SELECT
  "action",
  "entityType",
  "userName",
  "createdAt",
  details::jsonb->'itemFormulas' AS formulas,
  details::jsonb->'sourceWeightExpression' AS source_expr
FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND details LIKE '%TEST_WEIGHT_FORMULA%'
ORDER BY "createdAt" DESC
LIMIT 20;
```
- [ ] ตรวจว่า:
  - มี entry CREATE สำหรับ BUY/SELL/SORT
  - แต่ละ CREATE มี `formulas` ที่ไม่ null
  - SORT_CREATE มี `source_expr` = `"68.4-0.2"`

### □ Step 14: Cleanup test bills
- [ ] Cancel bill BUY ที่สร้าง (ถ้ายังไม่ cancel)
- [ ] Cancel bill SELL
- [ ] Cancel bill SORT
- [ ] ตรวจสต็อกกลับเดิม
- [ ] **ห้าม hard delete** — ให้ cancel อย่างเดียว (soft delete)

### □ Step 15: Final verification
- [ ] ลองสร้าง bill จริง (ไม่ใช่ test) 1 รายการเพื่อยืนยันระบบใช้ได้จริง
- [ ] ตรวจ Vercel logs ไม่มี error 5xx
- [ ] ตรวจ Supabase logs ไม่มี error

---

## Rollback Plan (ถ้ามีปัญหา)

### ถ้า migration ล้มเหลว:
1. รัน rollback SQL:
```sql
ALTER TABLE "BuyBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SellBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "sourceWeightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "weighedTotalExpression";
```

### ถ้า code มี bug:
1. Revert commit ใน GitHub:
```bash
git revert <commit-hash>
git push origin main
```
2. รอ Vercel redeploy

### ถ้า DB พัง:
1. Restore backup จาก Step 1
2. ติดต่อ Supabase support ถ้าจำเป็น

---

## อาการที่ต้องสังเกต (red flags)

🚨 **หยุดและ rollback ถ้าเจอ**:
- หน้า login ขาว / 500 error
- API `/api/products` return 500
- Toast error "weight Expression column does not exist"
- Stock ผิดปกติหลัง cancel
- Audit log ไม่มี entry ใหม่

---

## หมายเหตุ

- Migration นี้เป็น **additive only** — ไม่มี downtime
- ระหว่าง migration ระบบยังใช้ได้ (แค่ column ใหม่ยังไม่ถูกใช้)
- หลัง deploy code แล้ว API จะเริ่มส่ง `weightExpression` — ถ้า column ไม่มีจะ 500
- **ลำดับที่ถูก**: migration ก่อน → deploy ทีหลัง
