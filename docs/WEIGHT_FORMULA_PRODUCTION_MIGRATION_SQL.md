# Weight Formula Tracking — Production Migration SQL

> **วันที่**: 27/06/2569
> **สถานะ**: พร้อม run ใน Supabase SQL Editor — รอ Owner อนุมัติ
> **ความเสี่ยง**: ต่ำมาก — Additive only, nullable columns, ไม่กระทบข้อมูลเดิม

---

## ⚠️ ก่อน run

1. **Backup ฐานข้อมูล** (แนะนำ):
   - Supabase Dashboard → Database → Backups → Create backup
   - หรือใช้ `pg_dump` ถ้ามี access

2. **Check row counts ก่อน migration** (เก็บค่าไว้เปรียบเทียบ):
   ```sql
   SELECT 'BuyBill' AS t, COUNT(*) FROM "BuyBill"
   UNION ALL SELECT 'SellBill', COUNT(*) FROM "SellBill"
   UNION ALL SELECT 'SortingBill', COUNT(*) FROM "SortingBill"
   UNION ALL SELECT 'BuyBillItem', COUNT(*) FROM "BuyBillItem"
   UNION ALL SELECT 'SellBillItem', COUNT(*) FROM "SellBillItem"
   UNION ALL SELECT 'SortingBillItem', COUNT(*) FROM "SortingBillItem";
   ```
   บันทึกผลลัพธ์ไว้เปรียบเทียบหลัง migration — ต้องเท่ากัน

---

## SQL Migration Script

**วิธีใช้**:
1. เปิด Supabase Dashboard → SQL Editor
2. วางสคริปต์ด้านล่างทั้งหมด
3. กด Run
4. ดูผลลัพธ์จาก verification queries ด้านล่าง

```sql
-- ============================================================
-- Weight Formula Tracking — Additive Migration
-- Target: Supabase Postgres (production)
-- Date: 27/06/2569
-- ============================================================
-- IMPORTANT:
-- - Additive only (no drops, no alters of existing columns)
-- - All new columns are NULLABLE TEXT, so existing rows = NULL
-- - NULL means "user typed a plain number" — backward compatible
-- - Safe to run on production without downtime
--
-- Rollback (if needed):
--   ALTER TABLE "BuyBillItem" DROP COLUMN IF EXISTS "weightExpression";
--   ALTER TABLE "SellBillItem" DROP COLUMN IF EXISTS "weightExpression";
--   ALTER TABLE "SortingBillItem" DROP COLUMN IF EXISTS "weightExpression";
--   ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "sourceWeightExpression";
--   ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "weighedTotalExpression";
-- ============================================================

BEGIN; -- transaction — ทั้งหมดสำเร็จหรือ rollback ทั้งหมด

-- 1. BuyBillItem.weightExpression
ALTER TABLE "BuyBillItem"
  ADD COLUMN IF NOT EXISTS "weightExpression" TEXT;

-- 2. SellBillItem.weightExpression
ALTER TABLE "SellBillItem"
  ADD COLUMN IF NOT EXISTS "weightExpression" TEXT;

-- 3. SortingBillItem.weightExpression
ALTER TABLE "SortingBillItem"
  ADD COLUMN IF NOT EXISTS "weightExpression" TEXT;

-- 4. SortingBill.sourceWeightExpression
ALTER TABLE "SortingBill"
  ADD COLUMN IF NOT EXISTS "sourceWeightExpression" TEXT;

-- 5. SortingBill.weighedTotalExpression
ALTER TABLE "SortingBill"
  ADD COLUMN IF NOT EXISTS "weighedTotalExpression" TEXT;

COMMIT;
```

---

## Verification Queries (run หลัง migration)

```sql
-- ============================================================
-- Verify: all 5 new columns exist
-- Expected: 5 rows, all is_nullable = 'YES'
-- ============================================================
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN (
    'weightExpression',
    'sourceWeightExpression',
    'weighedTotalExpression'
  )
ORDER BY table_name, column_name;

-- Expected output:
--   BuyBillItem       | weightExpression        | text | YES
--   SellBillItem      | weightExpression        | text | YES
--   SortingBill       | sourceWeightExpression  | text | YES
--   SortingBill       | weighedTotalExpression  | text | YES
--   SortingBillItem   | weightExpression        | text | YES


-- ============================================================
-- Verify: row counts unchanged (compare with pre-migration)
-- ============================================================
SELECT 'BuyBill' AS table_name, COUNT(*) AS row_count FROM "BuyBill"
UNION ALL
SELECT 'SellBill', COUNT(*) FROM "SellBill"
UNION ALL
SELECT 'SortingBill', COUNT(*) FROM "SortingBill"
UNION ALL
SELECT 'BuyBillItem', COUNT(*) FROM "BuyBillItem"
UNION ALL
SELECT 'SellBillItem', COUNT(*) FROM "SellBillItem"
UNION ALL
SELECT 'SortingBillItem', COUNT(*) FROM "SortingBillItem";


-- ============================================================
-- Verify: existing rows have NULL weightExpression (backward compat)
-- Expected: rows_with_formula = 0 for all existing rows
-- ============================================================
SELECT 'BuyBillItem' AS t,
  COUNT(*) FILTER (WHERE "weightExpression" IS NOT NULL) AS rows_with_formula,
  COUNT(*) AS total
FROM "BuyBillItem"
UNION ALL
SELECT 'SellBillItem',
  COUNT(*) FILTER (WHERE "weightExpression" IS NOT NULL),
  COUNT(*)
FROM "SellBillItem"
UNION ALL
SELECT 'SortingBillItem',
  COUNT(*) FILTER (WHERE "weightExpression" IS NOT NULL),
  COUNT(*)
FROM "SortingBillItem"
UNION ALL
SELECT 'SortingBill.source',
  COUNT(*) FILTER (WHERE "sourceWeightExpression" IS NOT NULL),
  COUNT(*)
FROM "SortingBill"
UNION ALL
SELECT 'SortingBill.weighed',
  COUNT(*) FILTER (WHERE "weighedTotalExpression" IS NOT NULL),
  COUNT(*)
FROM "SortingBill";
```

---

## หลัง migration สำเร็จ

1. **Regenerate Prisma client บน Vercel** — Vercel build จะรัน `prisma generate` อัตโนมัติเมื่อ deploy
2. **Deploy code ผ่าน GitHub push** — commit ที่มี weightExpression fields อยู่แล้ว (commit `1600cd0` + ถ้ามี commit ใหม่)
3. **Smoke test บน production** — ดู `WEIGHT_FORMULA_DEPLOY_CHECKLIST.md`

---

## ข้อควรระวัง

- ❌ **ห้าม run migration บน production ก่อน backup**
- ❌ **ห้าม deploy code ก่อน migration สำเร็จ** — API จะส่ง `weightExpression` ไปแต่ DB ไม่มี column → 500 error
- ✅ **Order**: backup → run SQL → verify → deploy code → smoke test
- ✅ ถ้ามี rollback จำเป็น: run rollback SQL + revert code commit

---

## Post-migration: sync Prisma migration history (optional)

ถ้าต้องการให้ Prisma migrate dev รู้ว่า migration นี้ถูก apply แล้ว (ไม่ให้ re-apply):

```bash
# หลัง run SQL ใน Supabase แล้ว รันที่เครื่อง local:
bun x prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# หรือสร้าง migration baseline:
bun x prisma migrate dev --name add_weight_expression --create-only
# แล้วแก้ไฟล์ migration ให้ว่าง (เพราะ apply ด้วย SQL ไปแล้ว)
# รัน: bun x prisma migrate resolve --applied <migration_name>
```

**ไม่จำเป็นถ้าใช้ `prisma db push` เท่านั้น** — db push ไม่สน migration history
