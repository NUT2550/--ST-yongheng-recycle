# Physical Count Draft — 08/07/2569 (Copper/Brass)

**Physical count draft saved only. No stock quantities were adjusted.**

## 1. Session ID Created

`cmrdae0vh0000sgmjvb5aiu0n`

## 2. Date Used

- **Count date (Thai)**: 08/07/2569
- **Count date (CE)**: 2026-07-08

## 3. Products Included

| # | Product | Product ID |
|---:|---|---|
| 1 | ทองแดงใหญ่ | prod_mqgp9arb37xlm6b54b0xa44v |
| 2 | ทองเหลืองหนา | prod_mqgp9bspglewfbgukggj7wdy |
| 3 | ทองเหลืองเนื้อแดง | prod_mqgp9bmg24ygg55yytz9jphl |

**Mapping applied**: Owner wrote "ทองเหลือง" → mapped to "ทองเหลืองหนา" (established mapping from Task 61).

## 4. System Stock Per Product

| Product | System Weight (kg) | Lots |
|---|---:|---:|
| ทองแดงใหญ่ | 56.3 | 74 |
| ทองเหลืองหนา | 39 | 19 |
| ทองเหลืองเนื้อแดง | 0.8 | 69 |

## 5. Physical Stock Per Product

| Product | Physical Weight (kg) |
|---|---:|
| ทองแดงใหญ่ | 6 |
| ทองเหลืองหนา | 6.34 |
| ทองเหลืองเนื้อแดง | 0.84 |

## 6. Difference Per Product

| Product | System (kg) | Physical (kg) | Difference (kg) | Direction |
|---|---:|---:|---:|---|
| ทองแดงใหญ่ | 56.3 | 6 | -50.3 | ลดสต็อก |
| ทองเหลืองหนา | 39 | 6.34 | -32.66 | ลดสต็อก |
| ทองเหลืองเนื้อแดง | 0.8 | 0.84 | 0.04 | เพิ่มสต็อก |
| **TOTAL** | **96.1** | **13.18** | **-82.92** | - |

## 7. Average Cost/kg

| Product | Average Cost (THB/kg) | System Value (THB) |
|---|---:|---:|
| ทองแดงใหญ่ | 377.24 | 21238.57 |
| ทองเหลืองหนา | 207.11 | 8077.4 |
| ทองเหลืองเนื้อแดง | 9.42 | 7.54 |

*Average cost = Σ(lot.remainingWeight × lot.costPerKg) / Σ(lot.remainingWeight) across all active StockLots for the product.*

## 8. Value Difference

| Product | Difference (kg) | Avg Cost (THB/kg) | Value Difference (THB) |
|---|---:|---:|---:|
| ทองแดงใหญ่ | -50.3 | 377.24 | -18975.17 |
| ทองเหลืองหนา | -32.66 | 207.11 | -6764.21 |
| ทองเหลืองเนื้อแดง | 0.04 | 9.42 | 0.38 |
| **TOTAL** | **-82.92** | - | **-25739** |

## 9. Total Difference Weight

**-82.92 kg**

Breakdown:
- ทองแดงใหญ่: -50.3 kg (ลดสต็อก)
- ทองเหลืองหนา: -32.66 kg (ลดสต็อก)
- ทองเหลืองเนื้อแดง: 0.04 kg (เพิ่มสต็อก)

## 10. Total Value Difference

**-25739 THB**

Breakdown:
- ทองแดงใหญ่: -18975.17 THB
- ทองเหลืองหนา: -6764.21 THB
- ทองเหลืองเนื้อแดง: 0.38 THB

## 11. Safety Check Result

| Metric | Before | After | Change | Expected | Status |
|---|---:|---:|---:|---|---|
| PhysicalCountSession | 2 | 3 | +1 | +1 | ✅ PASS |
| PhysicalCountItem | 8 | 11 | +3 | +3 | ✅ PASS |
| Total stock weight (kg) | 552312.3 | 552312.3 | 0 | 0 (unchanged) | ✅ PASS |
| StockLot | 1115 | 1115 | 0 | 0 (unchanged) | ✅ PASS |
| BuyBill | 158 | 158 | 0 | 0 (unchanged) | ✅ PASS |
| SellBill | 18 | 18 | 0 | 0 (unchanged) | ✅ PASS |
| SortingBill | 144 | 144 | 0 | 0 (unchanged) | ✅ PASS |
| Product | 113 | 113 | 0 | 0 (unchanged) | ✅ PASS |

**Overall: ✅ ALL SAFETY CHECKS PASSED**

## 12. Confirmation

| Invariant | Status |
|---|---|
| No stock quantities changed | ✅ CONFIRMED |
| No StockLots created | ✅ CONFIRMED |
| No BuyBills modified | ✅ CONFIRMED |
| No SellBills modified | ✅ CONFIRMED |
| No SortingBills modified | ✅ CONFIRMED |
| No adjustment applied (status=DRAFT) | ✅ CONFIRMED |

## Session Details

- **Session ID**: `cmrdae0vh0000sgmjvb5aiu0n`
- **Count date**: 2026-07-08 (08/07/2569 Thai)
- **Group**: ทองแดง/ทองเหลือง
- **Status**: DRAFT (DRAFT — not applied)
- **Note**: Draft from owner confirmed physical count for 08/07/2569. Do not apply until owner reviews preview.
- **Items**: 3

## Items Created

| # | Item ID | Product | System (kg) | Physical (kg) | Diff (kg) | Avg Cost | Value Diff | Direction |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | cmrdae0vi0002sgmjdfucb72u | ทองแดงใหญ่ | 56.3 | 6 | -50.3 | 377.24 | -18975.17 | ลดสต็อก |
| 2 | cmrdae0vi0003sgmj7mssmnxs | ทองเหลืองหนา | 39 | 6.34 | -32.66 | 207.11 | -6764.21 | ลดสต็อก |
| 3 | cmrdae0vi0004sgmj1ow32xdu | ทองเหลืองเนื้อแดง | 0.8 | 0.84 | 0.04 | 9.42 | 0.38 | เพิ่มสต็อก |

## Method

- Direct DB insert via Prisma Client (pgbouncer-safe sequential ops, no `$transaction`)
- Single `db.physicalCountSession.create()` with nested `items.create[]` (one round-trip)
- Status set to `DRAFT` — no apply step executed
- No StockLot rows touched
- Average cost computed from live StockLot data at draft-creation time (snapshot stored on each item)

---

**Physical count draft saved only. No stock quantities were adjusted.**
