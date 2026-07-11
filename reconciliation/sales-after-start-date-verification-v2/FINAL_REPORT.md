# Sales After Start Date Verification v2 — With Owner Decisions

**Task 46**: Update Sales After Start Date Verification With Owner Decisions
**Status**: VERIFICATION / REPORT ONLY — No production data modified.
**Input file**: รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls

## Owner Decisions Applied

| # | Raw name | Decision | Destination |
|---|---|---|---|
| 1 | "-" / code 0210 | Owner intentionally deleted/blanked | EXCLUDED_NOT_IN_SCOPE_SALES.csv |
| 2 | ทองแดงท่อ Candy | Sorting/dismantling output from ทองแดงใหญ่ | SORTING_RELATED_SALES_NEED_MOVEMENT.csv |
| 3 | อลูมิเนียมแผ่นเพจ | Map to อลูมิเนียมแผ่นเพลท (old wrong name) | SALES_AFTER_START_DATE.csv |
| 4 | อลูมิเนียมเพลท | Map to อลูมิเนียมแผ่นเพลท (owner prefers "อลูมิเนียมเพลท" as future name) | SALES_AFTER_START_DATE.csv |

## Aluminum Plate Naming Check

| Check | Result |
|---|---|
| Current active MT product "อลูมิเนียมแผ่นเพลท" | EXISTS — id cmr7a7plm0007mzie5kkgqpdh (0 stock) |
| Old MT product "อลูมิเนียมเพลท" | EXISTS — id prod_mqgp9g5d78sw9tuoeuem3i1b (0 stock) |
| Owner-preferred future name | อลูมิเนียมเพลท |
| Product master cleanup recommended? | YES — consolidate to one product (owner prefers "อลูมิเนียมเพลท") |
| For this report, matched to | อลูมิเนียมแผ่นเพลท (has start date 23/06/2569) |

## Summary

| # | Metric | Value |
|---|---|---:|
| 1 | Total Excel rows parsed | 534 |
| 2 | Total detailed sale item rows | 416 |
| 3 | Sales after start date row count | 42 |
| 4 | Sales after start date total weight | 12321.6 kg |
| 5 | Product count with sales after start date | 34 |
| 6 | Unmatched count after owner decisions | 0 |
| 7 | Ambiguous count after owner decisions | 0 |
| 8 | Excluded not in scope count | 258 |
| 9 | Sorting-related sale rows requiring movement | 4 |
| 10 | Aluminum plate rows mapped | 2 |
| 11 | Current active aluminum plate product name | อลูมิเนียมแผ่นเพลท |
| 12 | Owner-preferred aluminum plate name | อลูมิเนียมเพลท |
| 13 | Product master cleanup recommended later? | YES |
| 14 | Output folder path | /home/z/my-project/reconciliation/sales-after-start-date-verification-v2 |
| 15 | Report ready for owner review | YES |

## Top Products by Sale Weight After Start Date

| # | Product | Start date | Rows | Weight (kg) | Amount (THB) |
|---|---|---|---:|---:|---:|
| 1 | สแตนเลส 304 | 05/02/2569 | 4 | 5786.3 | 201250 |
| 2 | อลูมิเนียมฉาก | 24/06/2569 | 2 | 1051.4 | 1051.4 |
| 3 | อลูมิเนียมกระป๋อง | 25/06/2569 | 1 | 770 | 65450 |
| 4 | สแตนเลส 202 | 05/02/2569 | 3 | 735.2 | 12220 |
| 5 | อลูมิเนียมบาง | 27/06/2569 | 1 | 515.2 | 39990 |
| 6 | อลูมิเนียมสายไฟ | 23/06/2569 | 1 | 398.4 | 44725 |
| 7 | ขี้กลึงอลูมิเนียม | 22/01/2569 | 1 | 377.2 | 18482.8 |
| 8 | หม้อน้ำทองแดง | 04/07/2569 | 1 | 347.2 | 77034 |
| 9 | ทองเหลือง | 04/07/2569 | 1 | 280.6 | 74936 |
| 10 | หม้อน้ำอลูมิเนียม | 23/06/2569 | 1 | 208.2 | 14532 |
| 11 | ทองแดงใหญ่ | 04/07/2569 | 1 | 208 | 85698 |
| 12 | สแตนเลสดูดติด | 05/02/2569 | 1 | 206 | 3360 |
| 13 | ขี้กลึงตะกั่ว | 22/01/2569 | 1 | 203 | 7105 |
| 14 | อลูมิเนียมแข็ง | 27/06/2569 | 1 | 198.4 | 15108 |
| 15 | อลูมิเนียมเครื่อง | 23/06/2569 | 1 | 131.6 | 11724.5 |

## Sorting-Related Sales (Require Movement Before Reconciliation)

| Sale date | Bill no | Buyer | Raw name | Weight (kg) | Amount (THB) | Required handling |
|---|---|---|---|---:|---:|---|
| 08/01/2569 | A2007349 | บริษัท นิวโซลูชั่นส์ (ไทยแลนด์) จำกัด สำนักงานใหญ่ | ทองแดงท่อ Candy | 2.9 | 1065 | Create/verify sorting movement before final stock reconciliation |
| 05/02/2569 | A2007395 | บริษัท นิวโซลูชั่นส์ (ไทยแลนด์) จำกัด สำนักงานใหญ่ | ทองแดงท่อ Candy | 53.2 | 19504 | Create/verify sorting movement before final stock reconciliation |
| 21/04/2569 | A2007502 | ร้าน เอส.เอ็ม.เอ รีไซเคิล (สมพร) | ทองแดงท่อ Candy | 56 | 21615 | Create/verify sorting movement before final stock reconciliation |
| 04/07/2569 | A2007621 | ร้าน เอส.เอ็ม.เอ รีไซเคิล (สมพร) | ทองแดงท่อ Candy | 22.6 | 9446 | Create/verify sorting movement before final stock reconciliation |

**Source product**: ทองแดงใหญ่
**Movement type**: sorting/dismantling output from ทองแดงใหญ่
**Total**: 4 rows, 134.7 kg, 51630 THB

## Unmatched Sales Products (after owner decisions)

**0 unmatched** — all products matched after owner decisions. ✅

## Ambiguous Sales Products

**0 ambiguous** — all products matched cleanly. ✅

## Stock Reconciliation Note

These sales **should be deducted** during the stock reconciliation step, but:
- Do NOT deduct them yet
- Do NOT create SellBills
- Do NOT adjust stock quantities
- Owner must review this list first
- ทองแดงท่อ Candy sales require sorting/dismantling movement first (not direct deduction from ทองแดงใหญ่)

## Safety Confirmation

- ✅ No production data modified
- ✅ No SellBills created
- ✅ No StockLots created or deleted
- ✅ No stock adjusted
- ✅ No product master changed

**No production data was modified.**
