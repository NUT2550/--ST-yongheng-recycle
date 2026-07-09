# Task 71: Fix UI Style for StockTransfer Records Displayed as Sorting

**Sorting-style display fixed for businessType=คัดแยก records. No stock data was changed.**

## 1. Root Cause

In Task 68, the คัดแยก tab was modified to merge SortingBills + StockTransfers(businessType=คัดแยก). The render logic used duck-typing to detect StockTransfer records and rendered them with `TransferBillCard` — which uses the **cyan/PackageOpen** (แกะของ/transfer) style.

This made TRN-2569-00008 and TRN-2569-00009 visually stand out as "transfer" records (blue/cube icon) even though they are business-classified as คัดแยก. The owner wanted them to visually match normal SortingBill records (purple/RefreshCw) when shown in the คัดแยก tab.

## 2. Files Changed

| File | Change Type | Lines |
|---|---|---|
| `src/components/history-page.tsx` | UI presentation only | +16 / -3 |

**No other files changed.** No DB schema, no API routes, no lib files, no types.

## 3. Exact UI Fix

### Change 1: BillList render passes `displayMode="sort"`

When a StockTransfer record is rendered in the คัดแยก tab (type='sort'), the BillList now passes `displayMode="sort"` to `TransferBillCard`:

```tsx
<TransferBillCard ... displayMode="sort" />
```

### Change 2: TransferBillCard applies sort-style when displayMode='sort'

`TransferBillCard` now accepts an optional `displayMode` prop ('transfer' | 'sort', default 'transfer'). When `displayMode='sort'`:
- **Icon**: `RefreshCw` (instead of `PackageOpen`)
- **Icon color**: `text-purple-600` (instead of `text-cyan-600`)
- **Room badge**: `bg-purple-100 text-purple-700` (instead of `bg-cyan-100 text-cyan-700`)

When `displayMode='transfer'` (default, used in แกะของ tab): all styles unchanged.

### Visual Result

| Tab | Record Type | Icon | Color | Badge |
|---|---|---|---|---|
| คัดแยก | SortingBill | RefreshCw | purple-600 | purple-100/700 |
| คัดแยก | StockTransfer(businessType=คัดแยก) | **RefreshCw** ✅ | **purple-600** ✅ | **purple-100/700** ✅ |
| แกะของ | StockTransfer(businessType=แกะของ/null) | PackageOpen | cyan-600 | cyan-100/700 |

## 4. Production Deploy Status

| Item | Value |
|---|---|
| Commit | `6c84a5e` |
| Author | NUT2550 <207142776+NUT2550@users.noreply.github.com> |
| Pushed to GitHub | ✅ `3e7f2ba..6c84a5e main -> main` |
| Vercel deployment | ✅ READY (deployment age 3s after push) |
| Vercel blocked | ❌ NO (verified author) |

## 5. UI Verification Result (Agent Browser)

### คัดแยก tab — first 6 cards inspected via JS eval

| # | Date | Source | Icon Color | Icon | Status |
|---|---|---|---|---|---|
| 1 | 08/07/2569 10:00 | เครื่องจักร 20.60kg (TRN-2569-00009) | text-purple-600 | RefreshCw | ✅ sort style |
| 2 | 08/07/2569 10:00 | เหล็กหนาสั้น 62.60kg (TRN-2569-00008) | text-purple-600 | RefreshCw | ✅ sort style |
| 3 | 07/07/2569 09:42 | เหล็กบาง 54.80kg (SORT-2569-00152) | text-purple-600 | RefreshCw | ✅ sort style |
| 4 | 06/07/2569 15:53 | เหล็กบาง 81.00kg (SORT-2569-00151) | text-purple-600 | RefreshCw | ✅ sort style |
| 5 | 06/07/2569 15:45 | เหล็กหนาสั้น 13.60kg (SORT-2569-00150) | text-purple-600 | RefreshCw | ✅ sort style |
| 6 | 04/07/2569 10:32 | เครื่องจักร 18.50kg (SORT-2569-00149) | text-purple-600 | RefreshCw | ✅ sort style |

**All 6 cards use text-purple-600 + RefreshCw** — StockTransfer records (00008, 00009) now visually match SortingBill records. ✅

### แกะของ tab — all 4 cards inspected via JS eval

| # | Date | Source | Icon Color | Icon | Status |
|---|---|---|---|---|---|
| 1 | 09/07/2569 07:23 | สายไฟทองแดง 1.60kg (TRN-2569-00010) | text-cyan-600 | PackageOpen | ✅ transfer style (unchanged) |
| 2 | 08/07/2569 10:00 | ของแกะราคาสูง 2.10kg (TRN-2569-00006) | text-cyan-600 | PackageOpen | ✅ transfer style (unchanged) |
| 3 | 08/07/2569 03:35 | สายไฟทองแดง 13.70kg (TRN-2569-00005) | text-cyan-600 | PackageOpen | ✅ transfer style (unchanged) |
| 4 | 01/07/2569 17:56 | สายไฟไม่ปอก 3.80kg (TRN-2569-00002) | text-cyan-600 | PackageOpen | ✅ transfer style (unchanged) |

**All 4 cards use text-cyan-600 + PackageOpen** — แกะของ tab style unchanged. ✅

### Screenshots

- คัดแยก tab: `/tmp/prod-sort-tab-task71-fixed.png`
- แกะของ tab: `/tmp/prod-transfer-tab-task71-fixed.png`

## 6. Confirmation

| Invariant | Status |
|---|---|
| No stock changed | ✅ CONFIRMED (552,312.3 kg unchanged) |
| No records deleted | ✅ CONFIRMED (StockTransfer=10, SortingBill=144 unchanged) |
| No records recreated | ✅ CONFIRMED (no DB writes in code diff) |
| No DB data changed | ✅ CONFIRMED (businessType values unchanged: 00006=แกะของ, 00008=คัดแยก, 00009=คัดแยก) |
| No BuyBills modified | ✅ CONFIRMED (158 unchanged) |
| No SellBills modified | ✅ CONFIRMED (18 unchanged) |
| No products changed | ✅ CONFIRMED (113 unchanged) |
| No StockLots modified | ✅ CONFIRMED (1,115 unchanged) |

## 7. Safety Check Summary

| Metric | Value | Expected | Status |
|---|---:|---|---|
| Total stock weight | 552312.3 kg | 552312.3 | ✅ PASS |
| StockLot count | 1115 | 1115 | ✅ PASS |
| StockTransfer count | 10 | 10 | ✅ PASS |
| SortingBill count | 144 | 144 | ✅ PASS |
| BuyBill count | 158 | 158 | ✅ PASS |
| SellBill count | 18 | 18 | ✅ PASS |
| Product count | 113 | 113 | ✅ PASS |
| DB writes in diff | 0 | 0 | ✅ PASS |

---

**Sorting-style display fixed for businessType=คัดแยก records. No stock data was changed.**
