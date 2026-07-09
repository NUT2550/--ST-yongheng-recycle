# Purchase Round 1 Cleanup — After Owner Mapping Confirmation

## 1. Aliases Added/Used

| Alias | Target product | Source |
|---|---|---|
| ทองแดงช็อต | ทองแดงปอกช็อต | Task 63 owner-confirmed |
| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Task 63 owner-confirmed |
| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |
| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |
| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |
| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |

## 2. Format B Repeated Bill Grouping Fix

**Fixed**: Format B files repeat the same bill number under different product summary sections. The parser now uses a Map to group all rows with the same bill number into one BuyBill with multiple BuyBillItems.

| File | Bills before fix (Task 62) | Bills after fix (Task 63) |
|---|---:|---:|
| ซื้อ 2-7-2569 แบบละเอียด.xls | 13 | 13 |
| ซื้อ 3-7-2569 แบบละเอียด.xls | 39 | 29 |
| ซื้อ 4-7-2569 แบบละเอียด.xls | 53 | 31 |

## 3. Bills Found for Cleanup

| Metric | Value |
|---|---:|
| Total unique bills (after grouping fix) | 73 |
| Safe to import | 2 |
| Duplicates (already in DB) | 71 |
| Unmatched products | 0 |

## 4. Bills Imported

| Count | Value |
|---|---:|
| Bills imported | 2 |
| Items imported | 3 |
| Total weight | 36.3 kg |
| Total amount | 7427.6 THB |

| Bill no | File | Date | Seller | Items | Weight | Amount |
|---|---|---|---|---:|---:|---:|
| A1051345 | ซื้อ 4-7-2569 แบบละเอียด.xls | 4/7/2569 | ลูกค้าทั่วไป | 2 | 16.3 | 6867.6 |
| A1051350 | ซื้อ 4-7-2569 แบบละเอียด.xls | 4/7/2569 | ลูกค้าทั่วไป | 1 | 20 | 560 |

## 5. Bills Skipped

| Reason | Count |
|---|---:|
| Duplicate (already in DB) | 71 |
| Unmatched products | 0 |
| DB errors | 0 |

## 6. Remaining Unmatched/Ambiguous Products

| Product | Count | Files |
|---|---:|---|
| แสตนเลส 202 | 1 | ซื้อ 3-7-2569 แบบละเอียด.xls |

## 7. Duplicate Bill Handling

| Metric | Value |
|---|---:|
| Duplicate bills found | 71 |
| Duplicates skipped (not imported) | 71 |
| Previously imported (Task 62) | 16 |
| New imports this task | 2 |

## 8. Stock Before/After

| Metric | Before | After | Change |
|---|---:|---:|---:|
| BuyBills | 86 | 88 | +2 |
| StockLots | 963 | 966 | +3 |
| Total stock weight | 600145.6 | 600181.8999999999 | +36.3 |

## 9. Confirmation: No SellBills Modified

SellBills before: 9 → after: 9 — **UNCHANGED ✅**

## 10. Confirmation: No Product Master Modified

Products before: 113 → after: 113 — **UNCHANGED ✅**

**Purchase round 1 cleanup completed. Only safe remaining non-duplicate bills were imported.**
