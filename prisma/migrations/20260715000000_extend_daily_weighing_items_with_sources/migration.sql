-- ST-38: Extend DailyPurchaseWeighingItem with sorting/dismantling source breakdown.
--
-- This migration is ADDITIVE ONLY — it does NOT rename, drop, or alter any existing
-- column. It only ADDs five new columns with safe non-null default 0.
--
-- Backward compatibility:
--   - ST-35 base tables (DailyPurchaseWeighingSession, DailyPurchaseWeighingItem)
--     are already applied in Production.
--   - The physical column `purchasedWeight` is RETAINED (not renamed).
--   - The ST-38 application exposes it as `purchaseWeight` via Prisma @map,
--     so ST-35 code that references `purchasedWeight` continues to work.
--   - Current row counts (sessions/items) were verified as zero before this review;
--     even so, the migration is safe for non-zero rows because all new columns
--     have DEFAULT 0 and the existing `purchasedWeight` column is untouched.
--
-- Safe to apply on Production before or after the ST-38 code deploy.
-- After this migration the application stores:
--   purchaseWeight (physical `purchasedWeight`) = sum of BuyBillItem.weight
--   sortingOutputWeight     = sum of SortingBillItem.weight (isWaste=false) +
--                             sum of StockTransferItem.weight (isWaste=false, businessType='คัดแยก')
--   dismantlingOutputWeight = sum of StockTransferItem.weight (isWaste=false, businessType='แกะของ' or null)
--   expectedTotalWeight     = purchaseWeight + sortingOutputWeight + dismantlingOutputWeight
--   differenceWeight        = actualWeighedWeight - expectedTotalWeight (computed by app at save time)

-- Add new additive columns with safe defaults (zero). No RENAME, no DROP, no type change.
ALTER TABLE "DailyPurchaseWeighingItem"
    ADD COLUMN "sortingOutputWeight"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "sortingBillCount"        INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "dismantlingOutputWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "dismantlingRecordCount"  INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "expectedTotalWeight"     DOUBLE PRECISION NOT NULL DEFAULT 0;
