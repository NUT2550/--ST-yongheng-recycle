-- ============================================================
-- Weight Formula Tracking — Additive Migration Script
-- Target: Supabase Postgres (production)
-- Date: 27/06/2569
-- ============================================================
--
-- IMPORTANT:
-- - This migration is ADDITIVE ONLY (no drops, no alters of existing columns)
-- - All new columns are NULLABLE TEXT, so existing rows will have NULL
-- - NULL means "user typed a plain number" — backward compatible
-- - Safe to run on production without downtime
--
-- How to apply:
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire script
--   3. Run
--   4. Verify with the SELECT statements at the bottom
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

-- ============================================================
-- Verification Queries (run after migration)
-- ============================================================

-- Check that all 5 new columns exist (expected: 5 rows, all is_nullable = 'YES'):
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

-- Row counts (should be unchanged from before migration):
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

-- All existing rows should have NULL weightExpression (backward compat check):
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
