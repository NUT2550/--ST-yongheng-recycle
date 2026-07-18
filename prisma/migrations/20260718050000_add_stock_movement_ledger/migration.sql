-- ST-47 additive-only foundation. Do not apply to Production without separate Owner approval.
CREATE TYPE "StockMovementType" AS ENUM (
  'BASELINE', 'PURCHASE_IN', 'SALE_OUT', 'SORTING_SOURCE_OUT',
  'SORTING_OUTPUT_IN', 'TRANSFER_SOURCE_OUT', 'TRANSFER_OUTPUT_IN',
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CANCELLATION_REVERSAL',
  'COMPENSATION_REVERSAL'
);

CREATE TYPE "StockBaselineStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

CREATE TABLE "StockBaseline" (
  "id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "baselineDate" TIMESTAMP(3) NOT NULL,
  "status" "StockBaselineStatus" NOT NULL DEFAULT 'DRAFT',
  "migrationVersion" TEXT NOT NULL,
  "note" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedByName" TEXT,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockBaseline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockBaseline_approval_fields_check" CHECK (
    ("status" <> 'APPROVED') OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)
  )
);

CREATE TABLE "StockBaselineItem" (
  "id" TEXT NOT NULL,
  "baselineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockBaselineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockBaselineItem_weight_check" CHECK ("weight" >= 0)
);

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "movementType" "StockMovementType" NOT NULL,
  "signedWeight" DOUBLE PRECISION NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "sourceDocumentNumber" TEXT,
  "reversalOfId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdById" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockMovement_nonzero_check" CHECK ("signedWeight" <> 0),
  CONSTRAINT "StockMovement_reversal_self_check" CHECK ("reversalOfId" IS NULL OR "reversalOfId" <> "id")
);

CREATE UNIQUE INDEX "StockBaseline_generation_key" ON "StockBaseline"("generation");
CREATE INDEX "StockBaseline_status_baselineDate_idx" ON "StockBaseline"("status", "baselineDate");
CREATE UNIQUE INDEX "StockBaselineItem_baselineId_productId_key" ON "StockBaselineItem"("baselineId", "productId");
CREATE INDEX "StockBaselineItem_productId_idx" ON "StockBaselineItem"("productId");
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");
CREATE INDEX "StockMovement_productId_businessDate_idx" ON "StockMovement"("productId", "businessDate");
CREATE INDEX "StockMovement_businessDate_idx" ON "StockMovement"("businessDate");
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");
CREATE INDEX "StockMovement_reversalOfId_idx" ON "StockMovement"("reversalOfId");

ALTER TABLE "StockBaselineItem" ADD CONSTRAINT "StockBaselineItem_baselineId_fkey"
  FOREIGN KEY ("baselineId") REFERENCES "StockBaseline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBaselineItem" ADD CONSTRAINT "StockBaselineItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL permits only one approved generation. This partial unique index is
-- intentionally expressed in SQL because Prisma schema cannot model it.
CREATE UNIQUE INDEX "StockBaseline_single_approved_key"
  ON "StockBaseline" ((1)) WHERE "status" = 'APPROVED';
