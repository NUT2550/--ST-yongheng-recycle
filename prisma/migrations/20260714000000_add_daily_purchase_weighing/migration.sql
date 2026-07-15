-- ST-35: Add DailyPurchaseWeighingSession and DailyPurchaseWeighingItem tables.
-- This migration is ADDITIVE ONLY — does not alter or drop any existing tables.
-- Safe to apply on Production without downtime.

-- Create DailyPurchaseWeighingSession table
CREATE TABLE "DailyPurchaseWeighingSession" (
    "id" TEXT NOT NULL,
    "weighingDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPurchaseWeighingSession_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint: one session per date + category
CREATE UNIQUE INDEX "DailyPurchaseWeighingSession_weighingDate_category_key"
    ON "DailyPurchaseWeighingSession"("weighingDate", "category");

-- Create indexes for query performance
CREATE INDEX "DailyPurchaseWeighingSession_weighingDate_idx"
    ON "DailyPurchaseWeighingSession"("weighingDate");

CREATE INDEX "DailyPurchaseWeighingSession_category_idx"
    ON "DailyPurchaseWeighingSession"("category");

-- Create DailyPurchaseWeighingItem table
CREATE TABLE "DailyPurchaseWeighingItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchasedWeight" DOUBLE PRECISION NOT NULL,
    "purchaseBillCount" INTEGER NOT NULL,
    "actualWeighedWeight" DOUBLE PRECISION,
    "differenceWeight" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPurchaseWeighingItem_pkey" PRIMARY KEY ("id")
);

-- Foreign key: sessionId → DailyPurchaseWeighingSession.id (CASCADE on delete)
ALTER TABLE "DailyPurchaseWeighingItem"
    ADD CONSTRAINT "DailyPurchaseWeighingItem_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "DailyPurchaseWeighingSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign key: productId → Product.id
ALTER TABLE "DailyPurchaseWeighingItem"
    ADD CONSTRAINT "DailyPurchaseWeighingItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create indexes for query performance
CREATE INDEX "DailyPurchaseWeighingItem_sessionId_idx"
    ON "DailyPurchaseWeighingItem"("sessionId");

CREATE INDEX "DailyPurchaseWeighingItem_productId_idx"
    ON "DailyPurchaseWeighingItem"("productId");
