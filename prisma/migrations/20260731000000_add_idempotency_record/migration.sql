-- ST-62: Add IdempotencyRecord table for durable request-level idempotency.
-- Additive only: creates a new table, does not modify existing tables.
-- Backward compatible: old application code does not reference this table.

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

-- Rollback:
-- DROP TABLE IF EXISTS "IdempotencyRecord";
