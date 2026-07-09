# Fix Business Classification for 08/07/2569 Sorting Records

**Business classification fixed. Stock quantities were not changed.**

## 1. Root Cause

In Task 61, records TRN-2569-00008 and TRN-2569-00009 were created via `POST /api/stock-transfers` (StockTransfer table = แกะของ), but by business meaning they are คัดแยก records.

The MetalTrack History page has 2 separate tabs:
- **คัดแยก tab** → queries `SortingBill` table only
- **แกะของ tab** → queries `StockTransfer` table only

Since the records were in `StockTransfer`, they appeared in the แกะของ tab, not the คัดแยก tab where the owner expected them.

## 2. Schema Field Added

**Added new nullable field `businessType String?` to `StockTransfer` model** in `prisma/schema.prisma`:

```prisma
model StockTransfer {
  ...
  businessType  String?  // คัดแยก | แกะของ | null — business classification for History tab display (null/empty = แกะของ default)
  ...
}
```

**Why a new field (not an existing one):**
- `StockTransfer` had no existing `type`/`category`/`recordType` field
- Adding a nullable column is backward-compatible (existing records default to null = แกะของ)
- No data migration needed for other StockTransfers
- Applied to DB via direct SQL: `ALTER TABLE "StockTransfer" ADD COLUMN "businessType" TEXT`
- Prisma client regenerated

**Field semantics:**
- `null` or `''` → default แกะของ (shows in แกะของ tab)
- `'แกะของ'` → explicitly แกะของ (shows in แกะของ tab)
- `'คัดแยก'` → business classification คัดแยก (shows in คัดแยก tab)

## 3. Records Updated

| Bill Number | businessType Before | businessType After | Effect |
|---|---|---|---|
| TRN-2569-00006 | null | **แกะของ** | Set businessType=แกะของ (keep in แกะของ tab) |
| TRN-2569-00008 | null | **คัดแยก** | Set businessType=คัดแยก (move to คัดแยก tab display) |
| TRN-2569-00009 | null | **คัดแยก** | Set businessType=คัดแยก (move to คัดแยก tab display) |

**Method:** Sequential `db.stockTransfer.updateMany()` (pgbouncer-safe, no `$transaction`). No stock movement, no FIFO reversal, no record recreation.

## 4. Where Each Record Now Appears

| Bill Number | คัดแยก tab | แกะของ tab | Double-counted? |
|---|---|---|---|
| TRN-2569-00006 | ❌ No | ✅ YES | No |
| TRN-2569-00008 | ✅ YES | ❌ No | No |
| TRN-2569-00009 | ✅ YES | ❌ No | No |

**Verified via live API:**
- คัดแยก tab (StockTransfers with businessType=คัดแยก): found TRN-2569-00008, TRN-2569-00009 ✅
- แกะของ tab (StockTransfers with businessType=แกะของ or null): found TRN-2569-00006 ✅, excluded 00008/00009 ✅

## 5. Stock Safety Result

| Metric | Value | Expected | Status |
|---|---:|---|---|
| Total stock weight | 552312.3 kg | unchanged | ✅ PASS |
| StockLot count | 1115 | unchanged | ✅ PASS |
| StockTransfer count | 10 | unchanged (only businessType field updated) | ✅ PASS |
| SortingBill count | 144 | unchanged | ✅ PASS |
| BuyBill count | 158 | unchanged | ✅ PASS |
| SellBill count | 18 | unchanged | ✅ PASS |
| Product count | 113 | unchanged | ✅ PASS |

**No stock movement was created.** The fix only updated the `businessType` metadata field on 3 existing StockTransfer rows. No StockLot was created, modified, or deleted. No FIFO reversal. No record recreation.

## 6. Files Changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `businessType String?` to `StockTransfer` model |
| `src/lib/types.ts` | Added `businessType: string | null` to `StockTransfer` interface |
| `src/lib/api.ts` | Added `businessType` param to `fetchStockTransfers()` |
| `src/app/api/stock-transfers/route.ts` | GET: added `businessType` query filter; POST: added `businessType` to create data |
| `src/components/history-page.tsx` | `loadSortBills`: merge SortingBills + StockTransfers(businessType=คัดแยก); `loadTransferBills`: filter businessType=แกะของ; `BillList`: duck-type render in sort tab |

## 7. Deployment Status

- ✅ Schema applied to Supabase DB (column `StockTransfer.businessType` added via direct SQL)
- ✅ Prisma client regenerated
- ✅ Code changes (5 files) complete
- ✅ ESLint passes (`bun run lint` clean)
- ✅ Live API verification passed (login → GET /api/stock-transfers?businessType=คัดแยก and ?businessType=แกะของ)
- ⏳ GitHub push: pending (use PAT to push to main)

## 8. Confirmation

| Invariant | Status |
|---|---|
| No stock changed | ✅ CONFIRMED (552,312.3 kg before = after) |
| No duplicate records created | ✅ CONFIRMED (each target bill number appears exactly once) |
| No records recreated | ✅ CONFIRMED (only businessType field updated on existing rows) |
| No BuyBills modified | ✅ CONFIRMED (158 = 158) |
| No SellBills modified | ✅ CONFIRMED (18 = 18) |
| No StockLots created/modified/deleted | ✅ CONFIRMED (1,115 = 1,115) |
| No SortingBills created/modified | ✅ CONFIRMED (144 = 144) |
| No products changed | ✅ CONFIRMED (113 = 113) |
| No FIFO reversal | ✅ CONFIRMED |

## 9. Display Logic Summary

### คัดแยก tab (after fix)
Shows **merged** list of:
1. All non-cancelled `SortingBill` records (bill numbers like `SORT-2569-*`)
2. `StockTransfer` records where `businessType = 'คัดแยก'` (bill numbers like `TRN-2569-*`)

Merged sort: `date DESC, createdAt DESC`. Total = SortingBill count + StockTransfer(คัดแยก) count.

### แกะของ tab (after fix)
Shows `StockTransfer` records where `businessType IS NULL OR businessType = '' OR businessType = 'แกะของ'`.
Excludes `StockTransfer` records where `businessType = 'คัดแยก'`.

## 10. Record Details (After Fix)

| Bill Number | ID | Date | Room | Source Product | Source Weight | businessType | Items | Cancelled |
|---|---|---|---|---|---:|---|---:|---|
| TRN-2569-00006 | cmrc3nnjh0001jy04yu8s3cat | 2026-07-08 | 24 | ของแกะราคาสูง | 2.1 | แกะของ | 2 | false |
| TRN-2569-00008 | cmrd404o80001i8046f99gnjm | 2026-07-08 | 21 | เหล็กหนาสั้น | 62.6 | คัดแยก | 12 | false |
| TRN-2569-00009 | cmrd40ti70013i804ymlbxjur | 2026-07-08 | 22 | เครื่องจักร | 20.6 | คัดแยก | 6 | false |

---

**Business classification fixed. Stock quantities were not changed.**
