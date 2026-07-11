# UI Before/After — StockTransfer Card Style in คัดแยก Tab

## Root Cause

In Task 68, the คัดแยก tab was modified to merge SortingBills + StockTransfers(businessType=คัดแยก). The BillList render logic used duck-typing to detect StockTransfer records and rendered them with `TransferBillCard` — which uses the **cyan/PackageOpen** (แกะของ) style.

This made TRN-2569-00008 and TRN-2569-00009 visually stand out as "transfer" records (blue/cube icon) even though they are business-classified as คัดแยก.

## Before Fix

| Tab | Record | Icon | Icon Color | Badge Color |
|---|---|---|---|---|
| คัดแยก | TRN-2569-00008 (StockTransfer) | PackageOpen (cube) | text-cyan-600 (blue) | bg-cyan-100 / text-cyan-700 |
| คัดแยก | TRN-2569-00009 (StockTransfer) | PackageOpen (cube) | text-cyan-600 (blue) | bg-cyan-100 / text-cyan-700 |
| คัดแยก | SORT-2569-* (SortingBill) | RefreshCw (sort) | text-purple-600 | bg-purple-100 / text-purple-700 |
| แกะของ | TRN-2569-00006 (StockTransfer) | PackageOpen (cube) | text-cyan-600 | bg-cyan-100 / text-cyan-700 |

**Problem:** StockTransfer records in คัดแยก tab used cyan/PackageOpen style, making them visually inconsistent with normal SortingBill records (purple/RefreshCw).

## After Fix

| Tab | Record | Icon | Icon Color | Badge Color | Changed? |
|---|---|---|---|---|---|
| คัดแยก | TRN-2569-00008 (StockTransfer) | **RefreshCw** (sort) | **text-purple-600** | **bg-purple-100 / text-purple-700** | ✅ YES — now matches sort style |
| คัดแยก | TRN-2569-00009 (StockTransfer) | **RefreshCw** (sort) | **text-purple-600** | **bg-purple-100 / text-purple-700** | ✅ YES — now matches sort style |
| คัดแยก | SORT-2569-* (SortingBill) | RefreshCw (sort) | text-purple-600 | bg-purple-100 / text-purple-700 | (unchanged) |
| แกะของ | TRN-2569-00006 (StockTransfer) | PackageOpen (cube) | text-cyan-600 | bg-cyan-100 / text-cyan-700 | (unchanged — keeps transfer style) |

**Result:** All cards in the คัดแยก tab now use the same purple/RefreshCw style. The แกะของ tab keeps the cyan/PackageOpen style.

## Production Verification (Agent Browser)

### คัดแยก tab (inspected first 6 cards via JS eval)

| # | Date | Source | Icon Color | Icon | Status |
|---|---|---|---|---|---|
| 1 | 08/07/2569 10:00 | เครื่องจักร · 20.60 กก. (TRN-2569-00009) | text-purple-600 | RefreshCw (sort) | ✅ sort style |
| 2 | 08/07/2569 10:00 | เหล็กหนาสั้น · 62.60 กก. (TRN-2569-00008) | text-purple-600 | RefreshCw (sort) | ✅ sort style |
| 3 | 07/07/2569 09:42 | เหล็กบาง · 54.80 กก. (SORT-2569-00152) | text-purple-600 | RefreshCw (sort) | ✅ sort style |
| 4 | 06/07/2569 15:53 | เหล็กบาง · 81.00 กก. (SORT-2569-00151) | text-purple-600 | RefreshCw (sort) | ✅ sort style |
| 5 | 06/07/2569 15:45 | เหล็กหนาสั้น · 13.60 กก. (SORT-2569-00150) | text-purple-600 | RefreshCw (sort) | ✅ sort style |
| 6 | 04/07/2569 10:32 | เครื่องจักร · 18.50 กก. (SORT-2569-00149) | text-purple-600 | RefreshCw (sort) | ✅ sort style |

**All 6 cards use text-purple-600 + RefreshCw** — StockTransfer records (00008, 00009) now visually match SortingBill records. ✅

### แกะของ tab (inspected all 4 cards via JS eval)

| # | Date | Source | Icon Color | Icon | Status |
|---|---|---|---|---|---|
| 1 | 09/07/2569 07:23 | สายไฟทองแดง · 1.60 กก. (TRN-2569-00010) | text-cyan-600 | PackageOpen (transfer) | ✅ keeps transfer style |
| 2 | 08/07/2569 10:00 | ของแกะราคาสูง · 2.10 กก. (TRN-2569-00006) | text-cyan-600 | PackageOpen (transfer) | ✅ keeps transfer style |
| 3 | 08/07/2569 03:35 | สายไฟทองแดง · 13.70 กก. (TRN-2569-00005) | text-cyan-600 | PackageOpen (transfer) | ✅ keeps transfer style |
| 4 | 01/07/2569 17:56 | สายไฟไม่ปอก · 3.80 กก. (TRN-2569-00002) | text-cyan-600 | PackageOpen (transfer) | ✅ keeps transfer style |

**All 4 cards use text-cyan-600 + PackageOpen** — แกะของ tab style unchanged. ✅
