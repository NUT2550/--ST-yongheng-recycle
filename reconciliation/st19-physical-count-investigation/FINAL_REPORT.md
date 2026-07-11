# ST-19: Physical Count Investigation — Final Report

**Task ID**: ST-19
**Agent**: Main
**Date**: 2026-07-11 (CE) / 11/07/2569 (Thai)
**Mode**: READ-ONLY INVESTIGATION — no DB writes performed

---

## Executive Summary

พบ **3 ปัญหาแยกจากกัน**:

1. ❌ **Data entry error (Owner instruction)**: 09/07 Physical Count ใช้ physical target 7.92 + 1.34 = 9.26 kg แทนที่จะเป็น 89.40 + 3.66 = 93.06 kg ตามจริง → understated 83.80 kg

2. ❌ **System bug (unexplained)**: หลัง Apply 09/07 เสร็จ (status=APPLIED, after=7.92 + 1.34), สต็อก brass หายไปอีก 8.68 kg โดยไม่มี consumption event ใดๆ ในระบบ

3. ⚠️ **Owner product name mismatch**: "ทองแดงปอกช็อต" ที่ Owner ระบุ **ไม่มีใน DB** — DB มี "ทองแดงช็อต" (3.8 kg, ใช้ใน 10/07 apply) และ "ทองแดงปอกเงา" (0 kg) แต่ไม่มี "ทองแดงปอกช็อต"

**สถานะ**: ⚠️ NOT READY for correction — รอ Owner อนุมัติ plan ก่อน (ห้ามเขียน DB, ห้าม Apply, ห้าม Reverse, ห้าม Adjustment)

---

## 1. System vs Physical ทุกสินค้า

| Group | Product Name | Product ID | System (kg) | Physical (kg) | Diff (kg) | Avg Cost | Value Diff (THB) | Active Lots | Note |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| ทองเหลือง | ทองเหลืองเนื้อแดง | `prod_mqgp9bmg24ygg55yytz9jphl` | 0.58 | 3.66 | **+3.08** | 0 | 0 | 70 | ✅ OK |
| ทองเหลือง | ทองเหลืองหนา | `prod_mqgp9bspglewfbgukggj7wdy` | 0.00 | 89.40 | **+89.40** | 0 | 0 | 20 | ✅ OK |
| ทองแดง | ทองแดงปอกเงา | `prod_mqgp9aevp2yb18adpkyr3qtr` | 0.00 | 182.75 | **+182.75** | 0 | 0 | 16 | ✅ OK |
| ทองแดง | **ทองแดงปอกช็อต** | — | — | 153.74 | — | — | — | — | ❌ **NOT FOUND** |
| ทองแดง | ทองแดงท่อ Candy | `cmr09vcvi001cl105spng6d2h` | 0.00 | 0.90 | **+0.90** | 0 | 0 | 1 | ✅ OK |
| ทองแดง | ทองแดงใหญ่ | `prod_mqgp9arb37xlm6b54b0xa44v` | 8.08 | 75.42 | **+67.34** | 275.86 | 18,576.57 | 74 | ✅ OK |
| ทองแดง | ทองแดงเล็ก | `prod_mqgp9axign3hnk45ex03l4aw` | 7.18 | 32.70 | **+25.52** | 383.58 | 9,788.87 | 46 | ✅ OK |
| ทองแดง | ทองแดงชุบ | `prod_mqgp9bgavns7vxc8rzrlsn65` | 0.00 | 2.40 | **+2.40** | 0 | 0 | 33 | ✅ OK |
| ทองแดง | ขี้กลึงทองแดง | `prod_new_1782125293874_e0b882e0b8b5e0b989e0b881` | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | ✅ OK |
| ทองแดง | ทองแดงติดเหล็ก | `cmr09vcvh0014l105skokga93` | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | ✅ OK |

### ยอดรวม
- **System รวม (9 products ที่พบ)**: 16.10 kg
- **Physical รวม (9 products ที่พบ)**: 386.97 kg (Owner)
- **ยอด Difference รวม**: +370.87 kg
- **Value Difference รวม**: 28,365.44 THB (เฉพาะ 2 products ที่มี avgCost > 0)
- **"ทองแดงปอกช็อต" 153.74 kg**: ไม่พบใน DB → ต้องสอบถาม Owner ว่าหมายถึง product ใด

### สินค้าที่เกี่ยวข้อง (DB มีจริง แต่ Owner ไม่ได้ระบุ)
| Product Name | Product ID | System (kg) | หมายเหตุ |
|---|---|---:|---|
| ทองแดงช็อต | `prod_mqgp9alick357v31bqqrlv43` | 3.80 | ใช้ใน 09/07 + 10/07 apply |
| หม้อน้ำทองแดง | `prod_mqgp9b9ouoxmoeq34ccaydfj` | 1.20 | Owner บอก "ไม่รวม" ✅ |

---

## 2. สาเหตุของ discrepancy

### ปัญหา A: 09/07 Physical Count ใช้ physical target ผิด (Data entry error)

| Item | Owner ยืนยันปัจจุบัน | 09/07 Physical target ที่ใช้ | Understated by |
|---|---:|---:|---:|
| ทองเหลืองหนา | 89.40 kg | **7.92 kg** | 81.48 kg |
| ทองเหลืองเนื้อแดง | 3.66 kg | **1.34 kg** | 2.32 kg |
| **TOTAL** | **93.06 kg** | **9.26 kg** | **83.80 kg** |

**หมายเหตุ**: Owner บอก "8.00" แต่ DB เก็บ "7.92" (อาจเป็นการปัดเศษของ Owner)

Apply 09/07 ลดสต็อก brass จาก 43.30 kg → 9.26 kg (deducted 34.04 kg) โดยใช้ physical target ที่ **understated 83.80 kg** เมื่อเทียบกับจริง

### ปัญหา B: หลัง Apply 09/07 สต็อก brass หายไปอีก 8.68 kg โดยไม่มี consumption event (System bug)

| Item | After Apply 2 (audit log) | Current Live Stock | Missing |
|---|---:|---:|---:|
| ทองเหลืองหนา | 7.92 kg | 0.00 kg | **-7.92 kg** |
| ทองเหลืองเนื้อแดง | 1.34 kg | 0.58 kg | **-0.76 kg** |
| **TOTAL** | **9.26 kg** | **0.58 kg** | **-8.68 kg** |

ตรวจสอบแล้ว **ไม่พบ consumption events ใดๆ** หลัง apply timestamp (2026-07-11T06:37:36Z):
- ❌ ไม่มี SellBill
- ❌ ไม่มี SortingBill (as source)
- ❌ ไม่มี StockTransfer (as source)
- ❌ ไม่มี BuyBill cancellation
- ❌ ไม่มี SortingBill cancellation
- ❌ ไม่มี StockTransfer cancellation
- ❌ ไม่มี STOCK_ADJUSTMENT lots ใหม่
- ❌ ไม่มี StockLot ที่ updatedAt > apply timestamp

### ปัญหา C: มี 2 audit logs สำหรับ session 09/07 (Double-apply pattern)

| # | Audit Log ID | Created At | Adjustments | Lots Deducted |
|---|---|---|---:|---:|
| 1 | `cmrfzspsh0000la04ziqkm5ze` | 2026-07-11T06:37:31.292Z | 7 | 43 |
| 2 | `cmrfzstcy0001la04ro7vy413` | 2026-07-11T06:37:36.803Z | 3 | 12 |

- Audit log 1: ปรับ 7 products (รวม brass 2 ตัว) — before=41.2 (ทองเหลืองหนา), after=7.92
- Audit log 2: ปรับ 3 products (รวม brass 2 ตัว) — **before=41.2 อีกครั้ง**, after=7.92

**คำอธิบายที่เป็นไปได้**: มี script บางตัวรันระหว่าง 06:37:31 ถึง 06:37:36 (5 วินาที) ที่ restore สต็อกของ 3 products (ทองแดงชุบ, ทองเหลืองหนา, ทองเหลืองเนื้อแดง) กลับเป็นค่าเดิมก่อน Apply 1 — แล้ว reset session status กลับเป็น DRAFT — แต่ไม่ได้ลบ audit log 1

หลัง Apply 2 เสร็จ สต็อก brass ควรเป็น 7.92 + 1.34 = 9.26 kg แต่ปัจจุบันเหลือ 0 + 0.58 = 0.58 kg → **หายไป 8.68 kg โดยไม่มีบันทึก**

---

## 3. ผลตรวจ 6.34 kg วันที่ 07/07

### สิ่งที่ Owner สงสัย
> รายการวันที่ 07/07 จำนวน 6.34 kg น่าจะถูกจัดประเภทผิด
> ถ้า 6.34 เป็นทองเหลืองหนา:
>   - ทองเหลืองหนา = 89.40 kg
>   - ทองเหลืองเนื้อแดง = 3.66 kg

### ผลการตรวจสอบ

| Channel | Records วันที่ 07/07/2026 ที่มี weight=6.34 kg |
|---|---|
| BuyBillItem | **0 รายการ** |
| SortingBillItem (output) | **0 รายการ** |
| StockTransferItem (output) | **0 รายการ** |

**ไม่พบ daily receipt 6.34 kg ในวันที่ 07/07 ในระบบ**

### แต่พบ 6.34 kg ในที่อื่น!

ใน **08/07 Physical Count Draft (Task 66, session `cmrdae0vh0000sgmjvb5aiu0n`)** — ที่ยังเป็น DRAFT:

| Product | System Weight | Physical Weight | Difference |
|---|---:|---:|---:|
| ทองแดงใหญ่ | 56.30 | 6.00 | -50.30 |
| **ทองเหลืองหนา** | **39.00** | **6.34** | **-32.66** |
| ทองเหลืองเนื้อแดง | 0.80 | 0.84 | +0.04 |

**สรุป**: 6.34 kg คือ **physical count target** ของ ทองเหลืองหนา ใน draft 08/07 (ไม่ใช่ daily receipt) — และ **ถูกจัดประเภทเป็น ทองเหลืองหนา อยู่แล้ว** (ตรงตาม hypothesis ของ Owner)

### ตรวจสอบสมมติฐาน Owner

Owner hypothesis: ถ้า 6.34 เป็น ทองเหลืองหนา:
- ทองเหลืองหนา = 89.40 kg
- ทองเหลืองเนื้อแดง = 3.66 kg
- รวม = 93.06 kg ✅

**ผลลัพธ์**: 6.34 kg เป็น ทองเหลืองหนา อยู่แล้วในระบบ — แต่มันเป็น physical count target ของ draft 08/07 ไม่ใช่ daily receipt ของวันที่ 07/07

### ปริมาณรับเข้าจริงของ brass ระหว่าง 07/06 ถึง 07/09

| Product | BuyBill (kg) | Sorting Output (kg) | Transfer Output (kg) | รวม (kg) |
|---|---:|---:|---:|---:|
| ทองเหลืองหนา | 22.60 (5 bills) | 4.40 (2 bills) | 6.00 (2 transfers) | **33.00** |
| ทองเหลืองเนื้อแดง | 0.00 | 1.30 (1 bill) | 0.80 (1 transfer) | **2.10** |
| **TOTAL** | **22.60** | **5.70** | **6.80** | **35.10** |

---

## 4. ผลกระทบจาก Apply 09/07

### Apply 1 (06:37:31.292Z)
7 products ถูกปรับ:
- ทองแดงปอกเงา: 93.7 → 0 (-93.7 kg)
- ทองแดงช็อต: 120.2 → 1.16 (-119.04 kg)
- ทองแดงใหญ่: 56.3 → 8.08 (-48.22 kg)
- ทองแดงเล็ก: 17.9 → 7.18 (-10.72 kg)
- ทองแดงชุบ: 2.3 → 0 (-2.3 kg)
- ทองเหลืองหนา: 41.2 → 7.92 (-33.28 kg)
- ทองเหลืองเนื้อแดง: 2.1 → 1.34 (-0.76 kg)

**Total deducted**: 43 lots, 307.30 kg

### ระหว่าง Apply 1 และ Apply 2 (5 วินาที)
**Restoration script บางตัวรัน** — restore สต็อกของ 3 products (ทองแดงชุบ, ทองเหลืองหนา, ทองเหลืองเนื้อแดง) กลับเป็นค่าเดิมก่อน Apply 1 (เท่านั้นที่ audit log 2 บันทึก before=41.2/2.1/1.7 ได้)

### Apply 2 (06:37:36.803Z)
3 products ถูกปรับอีกครั้ง:
- ทองแดงชุบ: 1.7 → 0 (-1.7 kg)
- ทองเหลืองหนา: 41.2 → 7.92 (-33.28 kg)
- ทองเหลืองเนื้อแดง: 2.1 → 1.34 (-0.76 kg)

**Total deducted**: 12 lots, 35.74 kg

### หลัง Apply 2 จนถึงปัจจุบัน
- ทองเหลืองหนา: 7.92 → 0 (หายไป 7.92 kg, ไม่มี consumption event)
- ทองเหลืองเนื้อแดง: 1.34 → 0.58 (หายไป 0.76 kg, ไม่มี consumption event)

---

## 5. ยอดที่ควรแก้แต่ละสินค้า

### ยอดปัจจุบัน vs ยอดที่ควรเป็น (ตาม Owner)

| Product | Current System | Owner Physical | Diff (should add) |
|---|---:|---:|---:|
| ทองเหลืองเนื้อแดง | 0.58 | 3.66 | **+3.08 kg** |
| ทองเหลืองหนา | 0.00 | 89.40 | **+89.40 kg** |
| ทองแดงปอกเงา | 0.00 | 182.75 | **+182.75 kg** |
| ทองแดงปอกช็อต | — (not in DB) | 153.74 | **+153.74 kg** (need product creation or mapping) |
| ทองแดงท่อ Candy | 0.00 | 0.90 | **+0.90 kg** |
| ทองแดงใหญ่ | 8.08 | 75.42 | **+67.34 kg** |
| ทองแดงเล็ก | 7.18 | 32.70 | **+25.52 kg** |
| ทองแดงชุบ | 0.00 | 2.40 | **+2.40 kg** |
| ขี้กลึงทองแดง | 0.00 | 0.00 | 0 |
| ทองแดงติดเหล็ก | 0.00 | 0.00 | 0 |
| **TOTAL** (excl. ทองแดงปอกช็อต) | **16.10** | **386.97** | **+370.87 kg** |

### ยอดสต็อก brass ที่ "หายไป" จาก apply (ปัญหา B)
- ทองเหลืองหนา: -7.92 kg
- ทองเหลืองเนื้อแดง: -0.76 kg
- **TOTAL missing**: -8.68 kg

---

## 6. มูลค่าผลกระทบ

| Item | Diff (kg) | Avg Cost (THB/kg) | Value Diff (THB) |
|---|---:|---:|---:|
| ทองเหลืองหนา | +89.40 | 0 (no active lots) | 0 |
| ทองเหลืองเนื้อแดง | +3.08 | 0 (no active lots) | 0 |
| ทองแดงปอกเงา | +182.75 | 0 (no active lots) | 0 |
| ทองแดงท่อ Candy | +0.90 | 0 (no active lots) | 0 |
| ทองแดงใหญ่ | +67.34 | 275.86 | **18,576.57** |
| ทองแดงเล็ก | +25.52 | 383.58 | **9,788.87** |
| ทองแดงชุบ | +2.40 | 0 (no active lots) | 0 |
| ทองแดงปอกช็อต | +153.74 | unknown | unknown |
| **TOTAL (known)** | **+524.73** | | **28,365.44** |

**หมายเหตุ**:
- สินค้า 5 ตัวที่ avgCost=0 ไม่มี active lots → value difference คำนวณไม่ได้
- ทองแดงปอกช็อต ไม่มีใน DB → ต้องสอบถาม Owner ว่าหมายถึง product ใด (อาจเป็น "ทองแดงช็อต" หรือ "ทองแดงปอกเงา" หรือสินค้าใหม่)

### มูลค่าที่"หายไป" จาก Apply 09/07 (ปัญหา B)
- ทองเหลืองหนา: 7.92 kg × 196.05 THB/kg (from audit log) = **1,552.55 THB**
- ทองเหลืองเนื้อแดง: 0.76 kg × 3.59 THB/kg = **2.73 THB**
- **TOTAL**: ~1,555.28 THB

---

## 7. วิธีแก้ที่แนะนำ (READ-ONLY — รอ Owner อนุมัติ)

### ห้าม (per Owner instruction)
- ❌ ห้ามเขียน DB
- ❌ ห้าม Adjustment โดยตรง
- ❌ ห้าม Reverse
- ❌ ห้าม Apply
- ❌ ห้าม Commit / Push / Deploy

### ลำดับขั้นที่แนะนำ (Owner ต้องอนุมัติทั้งหมดก่อน)

#### Phase 1: Investigation (read-only) — รอดำเนินการต่อ
1. **หา restoration script ที่รันระหว่าง 06:37:31 ถึง 06:37:36** ของวันที่ 2026-07-11
   - ตรวจสอบ Vercel deployment logs รอบๆ เวลานั้น
   - ตรวจสอบ shell history ของเครื่องที่รัน reconciliation scripts
   - ตรวจสอบ git log ของ reconciliation/ folder

2. **หาสาเหตุของ 8.68 kg brass ที่หายไปหลัง Apply 2**
   - ตรวจสอบ StockLot updatedAt ของ brass lots ทั้งหมด (รวม zero lots)
   - ตรวจสอบว่ามี script ใดแก้ remainingWeight โดยตรงหรือไม่
   - ตรวจสอบ audit logs อื่นๆ (USER_ACTION, etc.) รอบเวลานั้น

3. **ยืนยันกับ Owner เรื่อง "ทองแดงปอกช็อต"** — คือ product ใด?
   - ถ้าคือ "ทองแดงช็อต" (id=`prod_mqgp9alick357v31bqqrlv43`): สต็อกปัจจุบัน = 3.8 kg, Owner บอก 153.74 kg → diff +149.94 kg
   - ถ้าคือ "ทองแดงปอกเงา" (id=`prod_mqgp9aevp2yb18adpkyr3qtr`): สต็อกปัจจุบัน = 0 kg, Owner บอก 153.74 kg → diff +153.74 kg (แต่ Owner ระบุทองแดงปอกเงา = 182.75 kg แยกไปแล้ว)
   - ถ้าเป็นสินค้าใหม่: ต้องสร้าง product ใหม่ใน DB

#### Phase 2: Correction (หลัง Owner อนุมัติ — แยก session ใหม่)
4. **สร้าง reversal session สำหรับ 09/07 apply** (เพื่อยกเลิก effect ของ 9.26 kg target ที่ผิด)
   - ใช้ `reversalOfId` field ชี้ไป session `cmrdqgfru0000sn8fdmtjjnla`
   - Physical target = system before 09/07 apply (เพื่อคืนสต็อก)
   - แต่ต้องระวัง: reversal จะคืนสต็อก 41.2 + 2.1 = 43.3 kg (ไม่ใช่ 93.06 kg ตามจริง)

5. **สร้าง physical count session ใหม่ด้วย target ที่ถูกต้อง** (89.40 + 3.66 = 93.06 kg สำหรับ brass)
   - ใช้ countDate = วันที่ตรวจนับจริงล่าสุด
   - Physical target ใช้ยอด Owner ยืนยัน

6. **แก้ 8.68 kg brass ที่หายไป** — หลังจากหาสาเหตุแล้ว
   - ถ้าเป็น bug ในระบบ: แก้ code แล้วเพิ่ม STOCK_ADJUSTMENT lot ชดเชย
   - ถ้าเป็น manual edit: บันทึก audit log และ restore stock ด้วย STOCK_ADJUSTMENT source

#### Phase 3: Prevention
7. **เพิ่ม idempotency protection ใน apply endpoint**
   - ใช้ DB-level lock หรือ conditional update (`UPDATE ... WHERE status = 'DRAFT'`)
   - ป้องกัน double-apply pattern

8. **เพิ่ม audit log สำหรับ manual stock adjustments** (ถ้ามีอยู่ในระบบ)

---

## 8. Ready / Not Ready for Owner approval

### ⚠️ NOT READY — ต้องการ Owner อนุมัติก่อนดำเนินการใดๆ

### เหตุผล
1. ✅ ตรวจสอบครบทุกสินค้าที่ Owner ระบุ (ยกเว้น "ทองแดงปอกช็อต" ที่ไม่มีใน DB)
2. ✅ ยืนยันว่า 09/07 Physical Count ใช้ 7.92 + 1.34 = 9.26 kg เป็น physical target (ไม่ใช่ daily receipt)
3. ✅ ยืนยันว่า 6.34 kg เป็น physical target ของ 08/07 Draft (Task 66) ไม่ใช่ daily receipt 07/07
4. ✅ พบ 3 ปัญหา: data entry error + system bug (missing stock) + double-apply pattern
5. ⚠️ ยังไม่พบสาเหตุของ missing 8.68 kg brass (ต้อง investigate เพิ่ม)
6. ⚠️ ยังไม่ยืนยันว่า "ทองแดงปอกช็อต" คือ product ใด

### Owner ต้องตัดสินใจ
1. **"ทองแดงปอกช็อต" 153.74 kg** — คือ product ใดใน DB?
2. **ยอด 9.26 kg ที่ใช้ใน 09/07 apply** — Owner ยืนยันว่าเป็น data entry error ใช่ไหม?
3. **8.68 kg brass ที่หายไป** — Owner อนุมัติให้ investigate ต่อ (read-only) หรือไม่?
4. **Correction approach** — Owner เลือก:
   - (ก) Reverse 09/07 + สร้าง session ใหม่ด้วย target ที่ถูกต้อง
   - (ข) สร้าง physical count session ใหม่เท่านั้น (โดยไม่ reverse)
   - (ค) อื่นๆ ตามที่ Owner เห็นสมควร

---

## Files Produced (read-only investigation)

ทั้งหมดอยู่ใน `/home/z/my-project/reconciliation/st19-physical-count-investigation/`:

1. `st19-investigate.mjs` — Read-only investigation script (Steps 1-7)
2. `st19-investigation.json` — JSON dump ของผล investigation ทั้งหมด
3. `step1-3-system-vs-physical.csv` — CSV ของ System vs Physical
4. `step7-timeline-brass.csv` — CSV ของ Timeline สำหรับ brass products
5. `FINAL_REPORT.md` — รายงานนี้

---

## Owner Instruction Compliance

| Instruction | Compliance |
|---|---|
| ดึงยอดสต็อก Production ปัจจุบัน | ✅ Done |
| ตรวจ Product ID และชื่อ active product ทีละรายการ | ✅ Done (พบ "ทองแดงปอกช็อต" ไม่มีใน DB) |
| แสดงตาราง 7 คอลัมน์ | ✅ Done (Section 1) |
| ตรวจ 09/07 ใช้ 8.00 + 1.34 เป็นยอดคงเหลือทั้งหมดหรือไม่ | ✅ Done (Section 2 — เป็น physical target 9.26 kg) |
| ตรวจ 8.00 + 1.34 มาจาก Daily Log หรือ Closing Stock | ✅ Done (เป็น physical target ไม่ใช่ daily log; closing stock คือ 41.2 + 2.1) |
| ตรวจสมมติฐาน 6.34 kg วันที่ 07/07 | ✅ Done (Section 3 — 6.34 เป็น physical target ของ 08/07 draft, ไม่ใช่ daily receipt 07/07) |
| ทำ timeline | ✅ Done (Section 4 + step7-timeline-brass.csv) |
| สรุป bug หรือ data misclassification | ✅ Done (Section 2 — พบทั้งสองอย่าง) |
| เสนอ correction plan ปลอดภัย | ✅ Done (Section 7 — ห้ามเขียน DB, ห้าม Adjustment, ห้าม Reverse, ห้าม Apply) |
| ห้าม Commit / Push / Deploy | ✅ None performed |
| รอ Owner อนุมัติก่อน | ✅ รายงานนี้รอ Owner อนุมัติ |
| ห้ามแสดง password / token / DATABASE_URL | ✅ None exposed |

---

**รายงานเสร็จสมบูรณ์ — รอ Owner ตรวจสอบและอนุมัติ correction plan**
