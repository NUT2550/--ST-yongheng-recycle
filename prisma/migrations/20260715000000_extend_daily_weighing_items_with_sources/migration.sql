-- ST-38: Extend DailyPurchaseWeighingItem with sorting/dismantling source breakdown.
--
-- This migration is ADDITIVE ONLY — it does not drop or change column types.
-- It renames `purchasedWeight` → `purchaseWeight` (clearer name; ST-35 column
-- had no Production data yet because ST-35 migration was not applied to Production
-- Supabase at the time ST-38 was authored), and adds new columns with safe
-- defaults so existing rows (if any) back-fill to zero.
--
-- Safe to apply on Production without downtime. After this migration:
--   purchaseWeight          = sum of BuyBillItem.weight (purchase source)
--   sortingOutputWeight     = sum of SortingBillItem.weight (isWaste=false) +
--                             sum of StockTransferItem.weight (isWaste=false, businessType='คัดแยก')
--   dismantlingOutputWeight = sum of StockTransferItem.weight (isWaste=false, businessType='แกะของ' or null)
--   expectedTotalWeight     = purchaseWeight + sortingOutputWeight + dismantlingOutputWeight
--   differenceWeight        = actualWeighedWeight - expectedTotalWeight (computed by app at save time)

-- 1. Rename `purchasedWeight` → `purchaseWeight` (clearer semantics; same Float type).
--    Safe because the column is non-nullable and the rename is metadata-only.
ALTER TABLE "DailyPurchaseWeighingItem"
    RENAME COLUMN "purchasedWeight" TO "purchaseWeight";

-- 2. Add new additive columns with safe defaults (zero).
ALTER TABLE "DailyPurchaseWeighingItem"
    ADD COLUMN "sortingOutputWeight"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "sortingBillCount"        INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "dismantlingOutputWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "dismantlingRecordCount"  INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "expectedTotalWeight"     DOUBLE PRECISION NOT NULL DEFAULT 0;
