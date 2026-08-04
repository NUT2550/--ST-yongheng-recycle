-- ST-62: Add IdempotencyRecord table + StockTransfer.idempotencyKey column.
-- Additive only: creates a new table and adds a nullable column.
-- Backward compatible: old application code does not reference these.

-- 1. IdempotencyRecord table
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROCESSING',
    "resourceId" TEXT,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");
CREATE INDEX "IdempotencyRecord_state_createdAt_idx" ON "IdempotencyRecord"("state", "createdAt");

-- 2. StockTransfer.idempotencyKey column (durable correlation for recovery)
ALTER TABLE "StockTransfer" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE INDEX IF NOT EXISTS "StockTransfer_idempotencyKey_idx" ON "StockTransfer"("idempotencyKey");

-- Rollback:
-- DROP INDEX IF EXISTS "StockTransfer_idempotencyKey_idx";
-- ALTER TABLE "StockTransfer" DROP COLUMN IF EXISTS "idempotencyKey";
-- DROP TABLE IF EXISTS "IdempotencyRecord";
