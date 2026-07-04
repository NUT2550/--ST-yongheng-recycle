# Migration Documentation — Critical Fixes (Task 16)

## Schema Changes (additive only — safe migration)

### Added to `BuyBill`, `SellBill`, `SortingBill` models:

```prisma
billNumber    String?  @unique  // business running number (e.g. "BUY-2569-00001")
isCancelled   Boolean   @default(false)
cancelledAt   DateTime?
cancelledBy   String?
cancelReason  String?
```

**ผลกระทบ (Impact):**
- All new columns are OPTIONAL (`String?`, `DateTime?`) or have `@default(false)`
- Existing bills will have `billNumber = NULL`, `isCancelled = false`
- **ไม่มีข้อมูลเดิมถูกลบ/แก้**
- `@unique` on `billNumber` — NULL values allowed (multiple NULLs OK in PostgreSQL)

### New model: `AuditLog`

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  action     String   // CREATE, UPDATE, DELETE, CANCEL
  entityType String   // BUY_BILL, SELL_BILL, SORTING_BILL
  entityId   String
  userId     String?
  userName   String?
  details    String?  // JSON string
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([createdAt])
}
```

**ผลกระทบ:** New table — empty on creation. No impact on existing data.

## How to apply migration

### Production (Supabase PostgreSQL)

**⚠️ IMPORTANT:** Run this AFTER deploying the code, not before.

1. Push code to GitHub → Vercel auto-deploys
2. After successful deploy, run:
   ```bash
   bun run db:push
   ```
3. `prisma db push` will:
   - Add new columns to existing tables (additive — safe)
   - Create new `AuditLog` table
   - NOT delete or modify existing data

## Backfilling billNumber for existing bills (optional)

Existing bills have `billNumber = NULL`. To backfill with running numbers:

```sql
-- For BuyBill (run in Supabase SQL Editor)
WITH ranked AS (
  SELECT
    id,
    date,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM date)
      ORDER BY date ASC, "createdAt" ASC
    ) AS seq
  FROM "BuyBill"
  WHERE "billNumber" IS NULL
)
UPDATE "BuyBill"
SET "billNumber" = CONCAT(
  'BUY-',
  EXTRACT(YEAR FROM ranked.date)::int + 543,
  '-',
  LPAD(ranked.seq::text, 5, '0')
)
FROM ranked
WHERE "BuyBill".id = ranked.id;
```

Repeat for `SellBill` (prefix `SELL`) and `SortingBill` (prefix `SORT`).

**Note:** This is OPTIONAL. The app works with NULL billNumbers — new bills get numbers automatically.

## Rollback plan

```sql
ALTER TABLE "BuyBill" DROP COLUMN IF EXISTS "billNumber";
ALTER TABLE "BuyBill" DROP COLUMN IF EXISTS "isCancelled";
ALTER TABLE "BuyBill" DROP COLUMN IF EXISTS "cancelledAt";
ALTER TABLE "BuyBill" DROP COLUMN IF EXISTS "cancelledBy";
ALTER TABLE "BuyBill" DROP COLUMN IF EXISTS "cancelReason";

ALTER TABLE "SellBill" DROP COLUMN IF EXISTS "billNumber";
ALTER TABLE "SellBill" DROP COLUMN IF EXISTS "isCancelled";
ALTER TABLE "SellBill" DROP COLUMN IF EXISTS "cancelledAt";
ALTER TABLE "SellBill" DROP COLUMN IF EXISTS "cancelledBy";
ALTER TABLE "SellBill" DROP COLUMN IF EXISTS "cancelReason";

ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "billNumber";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "isCancelled";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "cancelledAt";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "cancelledBy";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "cancelReason";

DROP TABLE IF EXISTS "AuditLog";
```

Then revert the code to the previous commit.

## Verification after migration

```sql
-- Check new columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'BuyBill' AND column_name IN ('billNumber', 'isCancelled', 'cancelledAt');

-- Check AuditLog table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'AuditLog'
);

-- Count existing bills (should match before migration)
SELECT
  (SELECT COUNT(*) FROM "BuyBill") AS buy_count,
  (SELECT COUNT(*) FROM "SellBill") AS sell_count,
  (SELECT COUNT(*) FROM "SortingBill") AS sort_count;
```
