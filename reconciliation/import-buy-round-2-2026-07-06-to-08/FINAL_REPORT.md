# Purchase Import Round 2 — 6-8 July 2569

**Purchase import round 2 completed. Only clean non-duplicate bills were imported.**

## 1. Files Parsed

| File | Format | Bill-header rows | Unique bills (grouped) | Repeated bill numbers |
|---|---|---:|---:|---:|
| ซื้อ 6-7-2569 แบบละเอียด.xls | B (per-product) | 74 | 27 | 13 |
| ซื้อ 7-7-2569 แบบละเอียด.xls | B (per-product) | 43 | 25 | 10 |
| ซื้อ 8-7-2569 แบบละเอียด.xls | B (per-product) | 30 | 18 | 6 |

All 3 files are Format B (per-product). The Format B grouping fix from Task 63 was applied: same bill number appearing under multiple product sections is grouped into a single BuyBill with multiple BuyBillItems.

## 2. Aliases Used

All aliases below are used **only for import matching** — no new products created.

| Alias (raw input) | Target product | Source |
|---|---|---|
| ทองแดงช็อต | ทองแดงปอกช็อต | Owner-confirmed (Round 1 cleanup) |
| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Owner-confirmed (Round 1 cleanup) |
| แสตนเลส 202 | สแตนเลส 202 | Owner-confirmed (Round 2) — auto-normalized by แสตนเลส→สแตนเลส |
| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |
| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |
| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |
| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |

**Auto spelling normalization applied to all inputs:**
- อลูมีเนียม → อลูมิเนียม
- แสตนเลส → สแตนเลส

## 3. Bills Found

| Metric | Value |
|---|---:|
| Files parsed | 3 |
| Total unique bills (after Format B grouping fix) | 70 |
| Bills imported (Round 2) | 70 |
| Pre-existing duplicates (skipped) | 0 |
| Bills with unmatched products | 0 |
| Bills with amount mismatch | 0 |
| Repeated bill numbers within files (grouped, not DB-duplicated) | 29 |

## 4. Bills Imported

| Metric | Value |
|---|---:|
| Bills imported | 70 |
| Items imported | 147 |
| Total weight | 38977 kg |
| Total amount | 486437.65 THB |
| Bill number range | BUY-2569-00086 … BUY-2569-00155 |

| Bill no | File | Date | Seller | Items | Weight (kg) | Amount | Bill ID |
|---|---|---|---|---:|---:|---:|---|
| A1051369 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 1595 | 14993 | BUY-2569-00086 |
| A1051367 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 8 | 14.4 | 931.42 | BUY-2569-00087 |
| A1051371 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 2 | 32.4 | 283.24 | BUY-2569-00088 |
| A1051372 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 2 | 125.2 | 1109.8 | BUY-2569-00089 |
| A1051377 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 4 | 70.9 | 615.06 | BUY-2569-00090 |
| A1051379 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 329 | 3092.6 | BUY-2569-00091 |
| A1051383 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 4 | 132.7 | 1628 | BUY-2569-00092 |
| A1051384 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 3 | 23.2 | 813.04 | BUY-2569-00093 |
| A1051366 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | เจ๊เอ | 1 | 2126 | 19984.4 | BUY-2569-00094 |
| A1051381 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | เอสพีรีไซเคิล ชนัญชิดา รัตนปัญญา | 2 | 609 | 5712.6 | BUY-2569-00095 |
| A1051385 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณอดิเรก พึ่งสุนทร (ชัยรับเหมาแนะนำ) | 1 | 280 | 2632 | BUY-2569-00096 |
| A1051378 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณปลื้ม | 1 | 882 | 8290.8 | BUY-2569-00097 |
| A1051363 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 22.3 | 191.78 | BUY-2569-00098 |
| A1051389 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณปลื้ม | 1 | 522.2 | 4752.02 | BUY-2569-00099 |
| A1051375 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณกอล์ฟ บ้านแพ้ว | 1 | 420 | 3780 | BUY-2569-00100 |
| A1051382 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณอดิเรก พึ่งสุนทร (ชัยรับเหมาแนะนำ) | 1 | 775 | 6975 | BUY-2569-00101 |
| A1051364 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลุงสายัณห์ (พ่อคุณกอล์ฟ บ้านแพ้ว) | 11 | 68.1 | 22905.4 | BUY-2569-00102 |
| A1051373 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณปลื้ม | 1 | 304 | 2736 | BUY-2569-00103 |
| A1051388 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณใบเตย | 1 | 455 | 4095 | BUY-2569-00104 |
| A1051368 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | คุณส้มมหาชัย | 1 | 60 | 390 | BUY-2569-00105 |
| A1051386 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ร้านโคกขามรีไซเคิ้ล (สวง พรหมชน) | 1 | 1717 | 14766.2 | BUY-2569-00106 |
| A1051376 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ธัญญาลักษ์ กุลเกษ | 12 | 76.1 | 10207.8 | BUY-2569-00107 |
| A1051365 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 2 | 5.5 | 435.2 | BUY-2569-00108 |
| A1051374 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | เจ๊วิไล | 5 | 49.6 | 18689.4 | BUY-2569-00109 |
| A1051380 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 2 | 87 | 35818.4 | BUY-2569-00110 |
| A1051387 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 3 | 12.5 | 2254.3 | BUY-2569-00111 |
| A1051370 | ซื้อ 6-7-2569 แบบละเอียด.xls | 6/7/2569 | ลูกค้าทั่วไป | 1 | 47.8 | 1673 | BUY-2569-00112 |
| A1051393 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 2 | 207 | 1815.1 | BUY-2569-00113 |
| A1051394 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 30.2 | 268.78 | BUY-2569-00114 |
| A1051397 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 4 | 8 | 548.65 | BUY-2569-00115 |
| A1051400 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | เจ๊วิภา | 2 | 199 | 1862.6 | BUY-2569-00116 |
| A1051412 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณตุ้ยโคกขาม | 3 | 471 | 3818.6 | BUY-2569-00117 |
| A1051415 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณดำ | 1 | 1580 | 14852 | BUY-2569-00118 |
| A1051404 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณทองพูน มาทา (เปิดร้านแถวสาริน) ค้าง5000 | 1 | 1431 | 13451.4 | BUY-2569-00119 |
| A1051390 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณอดิเรก พึ่งสุนทร (ชัยรับเหมาแนะนำ) | 2 | 997 | 9221.8 | BUY-2569-00120 |
| A1051408 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณใบเตย | 3 | 544.2 | 5655.4 | BUY-2569-00121 |
| A1051392 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 5 | 15.5 | 3955.98 | BUY-2569-00122 |
| A1051411 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 96.8 | 880.88 | BUY-2569-00123 |
| A1051416 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลุงสายัณห์ (พ่อคุณกอล์ฟ บ้านแพ้ว) | 2 | 328.8 | 19012.6 | BUY-2569-00124 |
| A1051414 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณปลื้ม | 1 | 302 | 2748.2 | BUY-2569-00125 |
| A1051410 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | เจ๊เอ | 1 | 1090 | 9810 | BUY-2569-00126 |
| A1051406 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณทองพูน มาทา (เปิดร้านแถวสาริน) ค้าง5000 | 1 | 1228 | 11052 | BUY-2569-00127 |
| A1051405 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณอดิเรก พึ่งสุนทร (ชัยรับเหมาแนะนำ) | 1 | 189 | 1701 | BUY-2569-00128 |
| A1051399 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ร้านพิรัช แซ่ลิ้ม (ค้าของเก่า) | 3 | 51.3 | 580 | BUY-2569-00129 |
| A1051403 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ร้านพิรัช แซ่ลิ้ม (ค้าของเก่า) | 2 | 711.4 | 6239.7 | BUY-2569-00130 |
| A1051398 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณปลื้ม | 1 | 222 | 1998 | BUY-2569-00131 |
| A1051395 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 692 | 4498 | BUY-2569-00132 |
| A1051396 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 111 | 721.5 | BUY-2569-00133 |
| A1051402 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ร้านพิรัช แซ่ลิ้ม (ค้าของเก่า) | 1 | 120 | 780 | BUY-2569-00134 |
| A1051407 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | ลูกค้าทั่วไป | 1 | 454 | 4540 | BUY-2569-00135 |
| A1051401 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | คุณทองพูน มาทา (เปิดร้านแถวสาริน) ค้าง5000 | 1 | 232 | 2018.4 | BUY-2569-00136 |
| A1051391 | ซื้อ 7-7-2569 แบบละเอียด.xls | 7/7/2569 | สุภางค์ (ป้อมค้าของเก่า) | 1 | 415 | 3610.5 | BUY-2569-00137 |
| A1051417 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 1 | 69.9 | 622.11 | BUY-2569-00138 |
| A1051424 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 4 | 52.9 | 817.39 | BUY-2569-00139 |
| A1051427 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 2 | 499 | 4615.9 | BUY-2569-00140 |
| A1051418 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณตุ๋ย | 1 | 833 | 7830.2 | BUY-2569-00141 |
| A1051430 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | สุภางค์ (ป้อมค้าของเก่า) | 1 | 727 | 6833.8 | BUY-2569-00142 |
| A1051421 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณใบเตย | 6 | 1055.3 | 31491.8 | BUY-2569-00143 |
| A1051429 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 1 | 300 | 2730 | BUY-2569-00144 |
| A1051433 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณดำ | 1 | 700 | 6370 | BUY-2569-00145 |
| A1051432 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | นายอุเทน อ้วนวงษ์ (ประมูลเครื่องจักร ช่างเตี้ยแนะนำ) | 2 | 2087 | 19172.7 | BUY-2569-00146 |
| A1051422 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 1 | 732 | 6588 | BUY-2569-00147 |
| A1051431 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 1 | 1409 | 12681 | BUY-2569-00148 |
| A1051434 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 1 | 1138 | 10242 | BUY-2569-00149 |
| A1051426 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณ นุชจรีย์ น้าคุณอำนาจ | 1 | 724 | 6516 | BUY-2569-00150 |
| A1051419 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณอดิเรก พึ่งสุนทร (ชัยรับเหมาแนะนำ) | 1 | 747 | 6723 | BUY-2569-00151 |
| A1051423 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณเก่ ค้าของเก่า (กระทุ่มแบน) | 1 | 880 | 7920 | BUY-2569-00152 |
| A1051425 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณเค้ก | 2 | 234 | 3729 | BUY-2569-00153 |
| A1051428 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | คุณต้อย คลองเตย (นายวรชิต สุทธิชัยพิชาติ) | 1 | 4220 | 35870 | BUY-2569-00154 |
| A1051420 | ซื้อ 8-7-2569 แบบละเอียด.xls | 8/7/2569 | ลูกค้าทั่วไป | 2 | 0.8 | 288.2 | BUY-2569-00155 |

## 5. Bills Skipped

| Reason | Count |
|---|---:|
| Pre-existing duplicate (already in DB before Round 2) | 0 |
| Unmatched products | 0 |
| Amount mismatch | 0 |
| Invalid date/weight/price | 0 |
| DB errors during import | 0 |
| **Total skipped** | **0** |

## 6. Stock Lots Created

| Metric | Value |
|---|---:|
| Stock lots created | 147 |
| (one StockLot per BuyBillItem, source='BUY', FIFO preserved) | |

## 7. Stock Weight Before/After

| Metric | Before | After | Change |
|---|---:|---:|---:|
| BuyBills | 88 | 158 | +70 |
| StockLots | 966 | 1113 | +147 |
| Total stock weight (kg) | 600181.9 | 639158.9 | +38977 |

Expected: BuyBills increased ✅, StockLots increased ✅, total stock weight increased ✅

## 8. Unmatched / Ambiguous Products

(none — all products matched using confirmed aliases)

## 9. Duplicate Bills

| Metric | Value |
|---|---:|
| Pre-existing duplicates (skipped) | 0 |
| Repeated bill numbers within files (grouped into 1 bill each) | 29 |
| DB duplicate errors during import | 0 |

**Format B grouping rule applied:** Same bill number appearing under multiple product sections is grouped into a single BuyBill with multiple BuyBillItems. No bill is created more than once.

## 10. Owner Review Needed

**NO**

All 70 bills were imported successfully. No unmatched products, no ambiguous matches, no DB errors. No existing bills were missing items (all imported bills were new).

If an existing bill appears to be missing some items, it is **not** appended silently — it is reported here for owner review. No such cases occurred in Round 2.

## 11. Confirmation

| Invariant | Before | After | Status |
|---|---:|---:|---|
| SellBills count (must be unchanged) | 9 | 9 | ✅ UNCHANGED |
| Product count (must be unchanged) | 113 | 113 | ✅ UNCHANGED |
| SortingBills count (manual sorting records must not be recreated) | 144 | 144 | ✅ UNCHANGED |

Manual sorting records preserved (not recreated):
- TRN-2569-00006 ✅
- TRN-2569-00008 ✅
- TRN-2569-00009 ✅

## Import Method

- Direct DB insert via Prisma Client (bypass API to avoid pgbouncer interactive transaction timeout)
- Sequential `db.buyBill.create()` (nested items write) + sequential `db.stockLot.create()` per item
- No `db.$transaction()` used (pgbouncer-safe)
- FIFO stock lot logic preserved (each purchase creates a new lot with remainingWeight = purchased weight)

---

**Purchase import round 2 completed. Only clean non-duplicate bills were imported.**
