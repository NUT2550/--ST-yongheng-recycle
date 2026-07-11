# Sales Import — 2-8 July 2569

**Sales import completed. Only clean non-duplicate bills with sufficient stock were imported.**

## 1. ZIP Extracted

- **ZIP file**: `ขาย 2-8 7-2569 แบบละเอียด.zip`
- **Extracted to**: `reconciliation/import-sell-2026-07-02-to-08/extracted/`
- **ZIP extracted**: YES ✅

## 2. Extracted Files List

| File | Classification | Size (bytes) |
|---|---|---:|
| ขาย 4-7-2569 แบบละเอียด.xls | SALES | 11264 |
| ขาย 8-7-2569 แบบละเอียด.xls | SALES | 4608 |
| ขาย 7-7-2569 แบบละเอียด.xls | SALES | 5632 |
| ขาย 6-7-2569 แบบละเอียด.xls | SALES | 5120 |
| ขาย 2-7-2569 แบบละเอียด.xls | SALES | 4608 |

## 3. Sales Files Processed

| File | Format | Transaction rows | Unique bills (grouped) | Repeated bill numbers |
|---|---|---:|---:|---:|
| ขาย 4-7-2569 แบบละเอียด.xls | Sales detailed | 11 | 3 | 2 |
| ขาย 8-7-2569 แบบละเอียด.xls | Sales detailed | 1 | 1 | 0 |
| ขาย 7-7-2569 แบบละเอียด.xls | Sales detailed | 4 | 4 | 0 |
| ขาย 6-7-2569 แบบละเอียด.xls | Sales detailed | 3 | 3 | 0 |
| ขาย 2-7-2569 แบบละเอียด.xls | Sales detailed | 1 | 1 | 0 |

## 4. Ignored Files

(none — all extracted files start with "ขาย")

## 5. Aliases Used

All aliases used **only for import matching** — no new products created.

| Alias (raw input) | Target product | Source |
|---|---|---|
| ทองแดงช็อต | ทองแดงปอกช็อต | Owner-confirmed (purchase Round 1 cleanup) |
| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Owner-confirmed (purchase Round 1 cleanup) |
| แสตนเลส 202 | สแตนเลส 202 | Owner-confirmed (purchase Round 2) |
| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |
| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |
| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |
| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |

**Auto spelling normalization:** อลูมีเนียม→อลูมิเนียม, แสตนเลส→สแตนเลส

## 6. Sell Bills Found

| Metric | Value |
|---|---:|
| Files parsed | 5 |
| Total unique bills (after Format B grouping fix) | 12 |
| Bills safe to import | 9 |
| Duplicates (already in DB) | 0 |
| Bills with unmatched products | 0 |
| Bills with insufficient stock | 3 |
| Repeated bill numbers within files (grouped, no DB duplicate) | 2 |

## 7. Sell Bills Imported

| Metric | Value |
|---|---:|
| Bills imported | 9 |
| Items imported | 9 |
| Total weight sold | 86846.5 kg |
| Total revenue | 911891.6 THB |
| Total FIFO cost | 444091.52 THB |

| Bill no | File | Date | Buyer | Items | Weight (kg) | Revenue | FIFO Cost | Bill ID |
|---|---|---|---|---:|---:|---:|---:|---|
| A2007623 | ขาย 4-7-2569 แบบละเอียด.xls | 4/7/2569 | ลูกค้าทั่วไป | 1 | 0.8 | 20 | 7.54 | SELL-2569-00003 |
| A2007631 | ขาย 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ซิงเคอหยวน | 1 | 28890 | 309123 | 187030.33 | SELL-2569-00004 |
| A2007630 | ขาย 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ซิงเคอหยวน | 1 | 28830 | 308481 | 0 | SELL-2569-00005 |
| A2007628 | ขาย 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 42 | 924 | 380.1 | SELL-2569-00006 |
| A2007629 | ขาย 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 1.2 | 30 | 10.62 | SELL-2569-00007 |
| A2007627 | ขาย 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 280 | 2049.6 | 1696.8 | SELL-2569-00008 |
| A2007624 | ขาย 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 6 | 132 | 0 | SELL-2569-00009 |
| A2007626 | ขาย 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 1.5 | 30 | 0 | SELL-2569-00010 |
| A2007620 | ขาย 2-7-2569 แบบละเอียด.xls | 2/7/2569 | เหล็กสยามยามาโตะ | 1 | 28795 | 291102 | 254966.13 | SELL-2569-00011 |

## 8. Sell Bills Skipped

| Reason | Count |
|---|---:|
| Duplicate (already in DB) | 0 |
| Unmatched products | 0 |
| Insufficient stock | 3 |
| Invalid date/weight/price | 0 |
| Import errors (DB) | 0 |
| **Total skipped** | **3** |

## 9. Stock Deducted Summary

| Metric | Value |
|---|---:|
| Total weight deducted (FIFO) | 86846.5 kg |
| Total FIFO cost of goods sold | 444091.52 THB |
| StockLot rows updated (remainingWeight decreased) | 9+ lots |
| Negative stock lots after import | 0 (must be 0) |

## 10. Stock Weight Before/After

| Metric | Before | After | Change |
|---|---:|---:|---:|
| SellBills | 9 | 18 | +9 |
| BuyBills | 158 | 158 | 0 |
| StockLots | 1115 | 1115 | 0 |
| Total stock weight (kg) | 639158.8000000003 | 552312.3000000002 | -86846.5 |
| Products | 113 | 113 | 0 |
| SortingBills | 144 | 144 | 0 |

Expected: SellBills increased ✅, total stock weight decreased ✅, StockLots updated (remainingWeight decreased) ✅

## 11. Unmatched / Ambiguous Products

(none — all products matched using confirmed aliases)

## 12. Duplicate Sell Bills

| Metric | Value |
|---|---:|
| Pre-existing duplicates (skipped) | 0 |
| Repeated bill numbers within files (grouped into 1 bill each) | 2 |
| DB duplicate errors during import | 0 |

## 13. Insufficient Stock Items

| File | Bill no | Product | Requested (kg) | Available (kg) | Shortfall (kg) |
|---|---|---|---:|---:|---:|
| ขาย 4-7-2569 แบบละเอียด.xls | A2007621 | ทองแดงใหญ่ | 208 | 56.3 | 151.7 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007621 | ทองแดงเล็ก | 98.2 | 17.7 | 80.5 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007621 | หม้อน้ำทองแดง | 347.2 | 1.2 | 346 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007621 | ทองแดงท่อ Candy | 22.6 | 0 | 22.6 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007621 | ทองเหลืองเนื้อแดง | 82 | 0.8 | 81.2 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007622 | ทองแดงชุบ | 4.2 | 2.3 | 1.9 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007622 | ทองเหลืองหนา | 280.6 | 39 | 241.6 |
| ขาย 4-7-2569 แบบละเอียด.xls | A2007622 | หม้อน้ำทองเหลือง | 86.4 | 0 | 86.4 |
| ขาย 6-7-2569 แบบละเอียด.xls | A2007625 | เหล็กหล่อเล็ก | 12235 | 1354 | 10881 |

## 14. Owner Review Needed

**YES**

The following items require owner attention:
- 9 insufficient stock item(s) listed in section 13

## 15. Confirmation

| Invariant | Before | After | Status |
|---|---:|---:|---|
| BuyBills count (must be unchanged) | 158 | 158 | ✅ UNCHANGED |
| Product count (must be unchanged) | 113 | 113 | ✅ UNCHANGED |
| SortingBills count (must be unchanged) | 144 | 144 | ✅ UNCHANGED |
| Negative stock lots (must be 0) | - | 0 | ✅ NO NEGATIVE STOCK |

Manual sorting records preserved (not recreated):
- TRN-2569-00006 ✅
- TRN-2569-00008 ✅
- TRN-2569-00009 ✅

## Import Method

- Direct DB insert via Prisma Client (bypass API to avoid pgbouncer interactive transaction timeout)
- **FIFO stock deduction**: StockLots ordered by `dateAdded ASC` (oldest first); each lot's `remainingWeight` decreased by `min(remaining, needed)`
- Sequential `db.stockLot.update()` per lot (pgbouncer-safe, no `$transaction`)
- Pre-validation: fresh stock re-check per item BEFORE any deduction (skip whole bill on any insufficient item — no partial import)
- `costPerKg` = weighted average = `Σ(deducted_k × lot_k.costPerKg) / weight`
- `totalCost` = `Σ(deducted_k × lot_k.costPerKg)`
- AuditLog written per imported bill (action=CREATE, entityType=SELL_BILL)
- New `externalBillNumber` column added to SellBill table (TEXT, UNIQUE) for duplicate detection — schema-only change, no app UI changes

---

**Sales import completed. Only clean non-duplicate bills with sufficient stock were imported.**
