-- ST-40: Add positive-yield fields to StockTransfer.
--
-- This migration is ADDITIVE ONLY — it does NOT rename, drop, or alter any existing
-- column. It only ADDs three new columns with safe defaults.
--
-- Business context:
--   When dismantling (แกะของ) output exceeds the estimated net source weight
--   (e.g. purchase deducted for contamination but actual recovered output is higher),
--   the system must allow the save AND conserve total source cost across outputs.
--
-- New columns:
--   gainWeight     — max(outputTotal - sourceWeight, 0); always >= 0
--   weightVariance — signed (outputTotal - sourceWeight); positive = gain, negative = loss
--   gainReason     — required text when gainWeight > 0 (e.g. "หักน้ำหนักประเมินตอนซื้อ")
--
-- Existing rows backfill to: gainWeight=0, weightVariance=0, gainReason=NULL
-- (which represents the pre-ST-40 behavior: no positive yield recorded).
--
-- Safe to apply before or after the ST-40 code deploy. Existing code that does not
-- reference these columns continues to work (they have defaults).

ALTER TABLE "StockTransfer"
    ADD COLUMN "gainWeight"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "weightVariance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "gainReason"     TEXT;
