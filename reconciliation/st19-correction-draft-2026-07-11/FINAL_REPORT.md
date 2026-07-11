# ST-19 Correction — Physical Count DRAFT Created (11/07/2569)

**Task ID**: ST-19 (Phase 2 — DRAFT creation)
**Agent**: Main
**Date**: 2026-07-11 (CE) / 11/07/2569 (Thai)
**Session ID**: `cmrgli52j0000oslknzwk9gah`
**Status**: ✅ **DRAFT CREATED** — pending Owner approval to Apply

---

## Executive Summary

สร้าง PhysicalCountSession DRAFT ใหม่เรียบร้อย:
- **Session ID**: `cmrgli52j0000oslknzwk9gah`
- **countDate**: 2026-07-11T10:00:00.000Z (11/07/2569)
- **status**: DRAFT (not applied)
- **items**: 10
- **Total physical target**: 540.97 kg
- **Total system stock (current)**: 19.64 kg
- **Total difference**: +521.33 kg (will be ADDED)
- **Total value difference**: 34,362.97 THB

**Safety invariants**: ✅ ALL PASS (only PhysicalCountSession +1, PhysicalCountItem +10, StockLot unchanged, Total stock weight unchanged, no other tables modified)

**Other sessions (08/07, 09/07, 10/07)**: ✅ ALL UNTOUCHED

---

## 1. Session ID

```
cmrgli52j0000oslknzwk9gah
```

---

## 2. countDate / status / note

| Field | Value |
|---|---|
| **countDate** | 2026-07-11T10:00:00.000Z (11/07/2569 Thai) |
| **status** | DRAFT (not applied) |
| **group** | ทองแดง/ทองเหลือง |
| **note** | Corrective physical count from Owner-confirmed current stock after ST-19 investigation |
| **createdAt** | 2026-07-11T16:45:10.315Z |
| **appliedAt** | null (not applied) |
| **appliedById** | null (not applied) |
| **items** | 10 |

---

## 3. Product mapping ทั้ง 10 รายการ

| # | Product Name | Product ID | Group | Category | Active Lots | Total Lots |
|---:|---|---|---|---|---:|---:|
| 1 | ทองเหลืองหนา | `prod_mqgp9bspglewfbgukggj7wdy` | ทองเหลือง | BRASS | 0 | 20 |
| 2 | ทองเหลืองเนื้อแดง | `prod_mqgp9bmg24ygg55yytz9jphl` | ทองเหลือง | BRASS | 1 | 70 |
| 3 | ทองแดงปอกเงา | `prod_mqgp9aevp2yb18adpkyr3qtr` | ทองแดง | COPPER | 0 | 16 |
| 4 | ทองแดงช็อต | `prod_mqgp9alick357v31bqqrlv43` | ทองแดง | COPPER | 2 | 26 |
| 5 | ทองแดงท่อ Candy | `cmr09vcvi001cl105spng6d2h` | ทองแดง | COPPER | 0 | 1 |
| 6 | ทองแดงใหญ่ | `prod_mqgp9arb37xlm6b54b0xa44v` | ทองแดง | COPPER | 6 | 74 |
| 7 | ทองแดงเล็ก | `prod_mqgp9axign3hnk45ex03l4aw` | ทองแดง | COPPER | 4 | 46 |
| 8 | ทองแดงชุบ | `prod_mqgp9bgavns7vxc8rzrlsn65` | ทองแดง | COPPER | 0 | 33 |
| 9 | ขี้กลึงทองแดง | `prod_new_1782125293874_e0b882e0b8b5e0b989e0b881` | ทองแดง | COPPER | 0 | 0 |
| 10 | ทองแดงติดเหล็ก | `cmr09vcvh0014l105skokga93` | ทองแดง | COPPER | 0 | 0 |

**Verification**:
- ✅ Exactly 10 products
- ✅ All 10 product IDs are unique (no duplicates)
- ✅ No ambiguous mappings (each name has exactly 1 match in DB)
- ✅ "ทองแดงช็อต" uses Product ID `prod_mqgp9alick357v31bqqrlv43` (same as 10/07 apply product)
- ✅ "หม้อน้ำทองแดง" is NOT in the items list (excluded per Owner instruction)

---

## 4. Current / Physical / Difference / After

| # | Product Name | Current System (kg) | Physical (kg) | Difference (kg) | After Apply (kg) | Direction |
|---:|---|---:|---:|---:|---:|---|
| 1 | ทองเหลืองหนา | 0.00 | 89.40 | **+89.40** | 89.40 | เพิ่มสต็อก |
| 2 | ทองเหลืองเนื้อแดง | 0.58 | 3.66 | **+3.08** | 3.66 | เพิ่มสต็อก |
| 3 | ทองแดงปอกเงา | 0.00 | 182.75 | **+182.75** | 182.75 | เพิ่มสต็อก |
| 4 | ทองแดงช็อต | 3.80 | 153.74 | **+149.94** | 153.74 | เพิ่มสต็อก |
| 5 | ทองแดงท่อ Candy | 0.00 | 0.90 | **+0.90** | 0.90 | เพิ่มสต็อก |
| 6 | ทองแดงใหญ่ | 8.08 | 75.42 | **+67.34** | 75.42 | เพิ่มสต็อก |
| 7 | ทองแดงเล็ก | 7.18 | 32.70 | **+25.52** | 32.70 | เพิ่มสต็อก |
| 8 | ทองแดงชุบ | 0.00 | 2.40 | **+2.40** | 2.40 | เพิ่มสต็อก |
| 9 | ขี้กลึงทองแดง | 0.00 | 0.00 | 0.00 | 0.00 | ไม่เปลี่ยนแปลง |
| 10 | ทองแดงติดเหล็ก | 0.00 | 0.00 | 0.00 | 0.00 | ไม่เปลี่ยนแปลง |
| **TOTAL** | (10 items) | **19.64** | **540.97** | **+521.33** | **540.97** | — |

**Key validation**: ✅ All items: `expectedAfter == physicalWeight` (target end-state confirmed)

---

## 5. Average cost และ value difference

| # | Product Name | Difference (kg) | Average Cost (THB/kg) | Value Difference (THB) |
|---:|---|---:|---:|---:|
| 1 | ทองเหลืองหนา | +89.40 | 0.00 | 0.00 |
| 2 | ทองเหลืองเนื้อแดง | +3.08 | 0.00 | 0.00 |
| 3 | ทองแดงปอกเงา | +182.75 | 0.00 | 0.00 |
| 4 | ทองแดงช็อต | +149.94 | 40.00 | 5,997.60 |
| 5 | ทองแดงท่อ Candy | +0.90 | 0.00 | 0.00 |
| 6 | ทองแดงใหญ่ | +67.34 | 275.86 | 18,576.41 |
| 7 | ทองแดงเล็ก | +25.52 | 383.58 | 9,788.96 |
| 8 | ทองแดงชุบ | +2.40 | 0.00 | 0.00 |
| 9 | ขี้กลึงทองแดง | 0.00 | 0.00 | 0.00 |
| 10 | ทองแดงติดเหล็ก | 0.00 | 0.00 | 0.00 |
| **TOTAL** | | **+521.33** | — | **34,362.97** |

**หมายเหตุ**: 7 สินค้ามี avgCost=0 (no active StockLots) → value difference คำนวณได้ 0 แม้จะมี weight difference มาก

---

## 6. Physical weight รวม

```
Total Physical Weight (Owner-confirmed): 540.97 kg
```

Breakdown by group:
- ทองเหลือง: 89.40 + 3.66 = **93.06 kg**
- ทองแดง: 182.75 + 153.74 + 0.90 + 75.42 + 32.70 + 2.40 + 0 + 0 = **447.91 kg**

---

## 7. System stock รวมก่อน Apply

```
Total System Stock (10 products, live DB): 19.64 kg
```

Breakdown by group:
- ทองเหลือง: 0.00 + 0.58 = **0.58 kg**
- ทองแดง: 0.00 + 3.80 + 0.00 + 8.08 + 7.18 + 0.00 + 0 + 0 = **19.06 kg**

---

## 8. Expected system stock รวมหลัง Apply

```
Expected Total System Stock After Apply (= Owner Physical Target): 540.97 kg
```

Net change: 540.97 - 19.64 = **+521.33 kg**

Breakdown by group (after apply):
- ทองเหลือง: 89.40 + 3.66 = **93.06 kg** (was 0.58 kg, +92.48 kg)
- ทองแดง: 182.75 + 153.74 + 0.90 + 75.42 + 32.70 + 2.40 + 0 + 0 = **447.91 kg** (was 19.06 kg, +428.85 kg)

---

## 9. ยืนยันทองแดงช็อต

| Field | Value |
|---|---|
| Product ID | `prod_mqgp9alick357v31bqqrlv43` |
| Product Name (DB) | ทองแดงช็อต |
| Used in 10/07 apply (3.8 kg target)? | ✅ YES (same product ID) |
| Current system stock | **3.80 kg** |
| Physical target (Owner) | **153.74 kg** |
| Difference | **+149.94 kg** (will be ADDED to stock) |
| Expected after Apply | **153.74 kg** ✅ matches Owner target |

Apply จะสร้าง STOCK_ADJUSTMENT lot ใหม่ +149.94 kg ที่ cost 40 THB/kg = 5,997.60 THB

---

## 10. ยืนยันว่าไม่รวมหม้อน้ำทองแดง

| Check | Result |
|---|---|
| หม้อน้ำทองแดง in items list? | ❌ NO (correctly excluded) ✅ |
| หม้อน้ำทองแดง stock will be modified? | ❌ NO ✅ |
| หม้อน้ำทองแดง product ID in any item? | ❌ NO ✅ |

**หม้อน้ำทองแดง** (Product ID: `prod_mqgp9b9ouoxmoeq34ccaydfj`) — **ไม่ถูกแตะ** สต็อกปัจจุบัน 1.20 kg คงเดิม

---

## 11. ยืนยันว่าไม่มีการ Apply หรือแก้ StockLot

### DB-level safety check

| Metric | Before | After | Change | Expected | Status |
|---|---:|---:|---:|---|---|
| PhysicalCountSession | 5 | 6 | +1 | +1 (new DRAFT) | ✅ PASS |
| PhysicalCountItem | 20 | 30 | +10 | +10 (10 items in new session) | ✅ PASS |
| **TotalStockWeight** | **572,189.44 kg** | **572,189.44 kg** | **0** | **0 (unchanged)** | ✅ PASS |
| **StockLot** | **1,153** | **1,153** | **0** | **0 (unchanged)** | ✅ PASS |
| BuyBill | 174 | 174 | 0 | 0 (unchanged) | ✅ PASS |
| SellBill | 18 | 18 | 0 | 0 (unchanged) | ✅ PASS |
| SortingBill | 146 | 146 | 0 | 0 (unchanged) | ✅ PASS |
| StockTransfer | 11 | 11 | 0 | 0 (unchanged) | ✅ PASS |
| Product | 113 | 113 | 0 | 0 (unchanged) | ✅ PASS |

**Overall safety**: ✅ ALL PASS

### Other sessions untouched

| Session | Date | Status | Applied At | Untouched? |
|---|---|---|---|---|
| `cmrbzw8te0000jo04qz2skp4q` | 08/07 | DRAFT | null | ✅ YES |
| `cmrbzwau00007jo043ivzvzcz` | 08/07 | DRAFT | null | ✅ YES |
| `cmrdae0vh0000sgmjvb5aiu0n` | 08/07 | DRAFT | null | ✅ YES |
| `cmrdqgfru0000sn8fdmtjjnla` | 09/07 | APPLIED | 2026-07-11T06:37:35.914Z | ✅ YES |
| `cmrfzuu1b0002la044u1ikzzd` | 10/07 | APPLIED | 2026-07-11T06:39:26.056Z | ✅ YES |

### Prohibited actions — all confirmed NOT performed

| Prohibited Action | Performed? |
|---|---|
| Apply | ❌ NOT performed |
| Reverse | ❌ NOT performed |
| Adjustment (direct) | ❌ NOT performed |
| Delete | ❌ NOT performed |
| Merge | ❌ NOT performed |
| Edit 08/07 sessions | ❌ NOT performed |
| Edit 09/07 session | ❌ NOT performed |
| Edit 10/07 session | ❌ NOT performed |
| Direct StockLot write | ❌ NOT performed |
| Restoration script | ❌ NOT performed |
| Direct SQL edit | ❌ NOT performed |
| Commit / Push / Deploy | ❌ NOT performed |

---

## 12. Ready / Not Ready for Owner final Apply approval

### ✅ READY for Owner final Apply approval (when Owner is ready)

### เหตุผล
1. ✅ DRAFT session created with 10 items, all match Owner-confirmed physical targets
2. ✅ All 10 product IDs unique, no ambiguity, no duplicates
3. ✅ "ทองแดงช็อต" uses same product ID as 10/07 apply (3.8 kg → 153.74 kg, +149.94 kg)
4. ✅ "หม้อน้ำทองแดง" correctly excluded
5. ✅ All `expectedAfter == physicalWeight` (target end-state confirmed)
6. ✅ No negative stock after apply (all targets ≥ 0)
7. ✅ All snapshot systemWeight matches live stock at creation time
8. ✅ Safety invariants ALL PASS — only +1 session, +10 items, 0 other changes
9. ✅ Other sessions (08/07, 09/07, 10/07) untouched
10. ✅ No Apply/Reverse/Adjustment/Delete/Merge performed
11. ✅ No Commit/Push/Deploy performed

### ข้อมูลสำคัญสำหรับ Owner เมื่อตัดสินใจ Apply
- **Net stock change**: +521.33 kg (+92.48 kg brass, +428.85 kg copper)
- **Value impact**: +34,362.97 THB (คำนวณจาก 2 products ที่มี avgCost > 0; 7 products มี avgCost=0 เพราะไม่มี active StockLots)
- **Apply method**: 8 รายการเป็น positive adjustment → สร้าง STOCK_ADJUSTMENT lot ใหม่, 2 รายการ diff=0 → skip
- **No items will be deducted** (no FIFO deduction needed — all differences are positive)
- **Expected audit log**: 1 PHYSICAL_COUNT_APPLY entry with 8 adjustments, 8 STOCK_ADJUSTMENT lots created, 0 lots deducted

### ข้อแนะนำเมื่อ Apply
1. **Verify ก่อน Apply**: re-run live preview เพื่อยืนยัน stock ยังตรงกับ snapshot ใน DRAFT
2. **Apply ผ่าน UI หรือ API** (POST /api/physical-counts/{id}/apply) — ห้ามใช้ direct SQL
3. **หลัง Apply**: ตรวจสอบ status=APPLIED, appliedAt, appliedById, audit log, stock lots ใหม่

---

## Files Produced

ทั้งหมดอยู่ใน `/home/z/my-project/reconciliation/st19-correction-draft-2026-07-11/`:

1. `step1-2-verify-mappings.mjs` — Read-only verification script (Steps 1+2)
2. `step1-2-verify-mappings.json` — JSON dump of mapping verification
3. `step1-2-verify-mappings.csv` — CSV summary of product mappings
4. `step3-4-create-draft.mjs` — DRAFT creation script (Steps 3+4+5)
5. `step3-4-create-draft.json` — JSON dump of created DRAFT + live preview
6. `step4-live-preview.csv` — CSV of live preview (Current/Physical/Diff/After)
7. `step5-safety-check.csv` — CSV of safety invariants (before/after)
8. `FINAL_REPORT.md` — รายงานนี้ (12 ส่วน)

---

## Owner Instruction Compliance

| Instruction | Compliance |
|---|---|
| สร้าง Physical Count Correction session ใหม่ใน Production แบบ DRAFT เท่านั้น | ✅ Done (status=DRAFT) |
| countDate: 11/07/2569 | ✅ Done (2026-07-11) |
| group: ทองแดง/ทองเหลือง | ✅ Done |
| note: "Corrective physical count from Owner-confirmed current stock after ST-19 investigation" | ✅ Done (exact text) |
| status: DRAFT | ✅ Done |
| ห้าม Apply ในรอบนี้ | ✅ NOT applied |
| 10 items ตามยอด Owner | ✅ Done (all 10 items with exact weights) |
| "ทองแดงปอกช็อต" map to "ทองแดงช็อต" | ✅ Done |
| Physical count = ยอดคงเหลือรวมสุดท้าย ไม่ใช่น้ำหนักที่ต้องบวกเพิ่ม | ✅ Done (expectedAfter = physicalWeight) |
| ไม่รวม หม้อน้ำทองแดง | ✅ Done (excluded) |
| ห้ามสร้าง item ของหม้อน้ำทองแดง | ✅ NOT created |
| ห้ามแก้ยอดหม้อน้ำทองแดง | ✅ NOT modified |
| ค้นหา active Product จริงทีละชื่อ | ✅ Done |
| "ทองแดงช็อต" ต้องใช้ Product เดียวกับ 10/07 apply | ✅ Done (id matches) |
| ห้ามสร้าง Product ใหม่ | ✅ NOT created (used existing) |
| ตรวจ Draft เดิม 11/07/2569 | ✅ Done (0 existing) |
| สร้าง Draft ใหม่เพียง 1 session | ✅ Done (1 session created) |
| ห้ามแก้ Draft วันที่ 08/07 | ✅ NOT modified |
| ห้ามแก้ Session วันที่ 09/07 | ✅ NOT modified |
| ห้ามแก้ Session วันที่ 10/07 | ✅ NOT modified |
| บันทึก system stock snapshot, physical count, difference, average cost, value difference, product ID, product name | ✅ All fields stored on PhysicalCountItem |
| Physical Count = ยอดเป้าหมายสุดท้าย ไม่ใช่จำนวนเพิ่มเข้าสต็อก | ✅ Done (physicalWeight = target end-state) |
| Live Preview หลังสร้าง Draft | ✅ Done (re-fetched session + live stock) |
| ตรวจ after-apply = Owner physical ทุกสินค้า | ✅ Done (all match) |
| ไม่มี Product ซ้ำ | ✅ Done (10 unique IDs) |
| ไม่มีชื่อผู้ซื้อหรือลูกค้าปะปน | ✅ Done (no Customer/SellBill data involved) |
| ไม่มี negative stock | ✅ Done (no items would go negative) |
| ไม่มีรายการหม้อน้ำทองแดง | ✅ Done (excluded) |
| คำนวณ Physical weight รวม | ✅ Done (540.97 kg) |
| ห้าม Apply/Reverse/Adjustment/Delete/Merge | ✅ NOT performed |
| ห้ามเขียน StockLot โดยตรง | ✅ NOT performed |
| ห้ามรัน restoration script | ✅ NOT performed |
| ห้ามใช้ direct SQL แก้ยอด | ✅ NOT performed |
| ห้าม Commit / Push / Deploy | ✅ NOT performed |
| หยุดรอ Owner approval | ✅ Done (status=DRAFT, awaiting approval) |

---

**รายงานเสร็จสมบูรณ์ — รอ Owner อนุมัติ Apply**
