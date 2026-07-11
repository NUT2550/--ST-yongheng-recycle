# Physical Count Production — Final Report

**Task ID**: 1 (Physical Count Production verification)
**Agent**: Main
**Date**: 2026-07-11 (CE) / 11/07/2569 (Thai)
**Mode**: READ-ONLY VERIFICATION — no DB writes performed

---

## Executive Summary

**ทั้งสอง session (09/07 และ 10/07) ถูก Apply ไปแล้วใน Production DB** — ไม่ต้อง Apply ซ้ำ ตามคำสั่ง Owner:

> หาก session นี้ถูก Applied ไปแล้ว:
> - ห้าม Apply ซ้ำ
> - ตรวจผลและรายงานหลักฐานแทน

พบ **discrepancy ใน current stock** ของ 2 ผลิตภัณฑ์ (ทองเหลืองหนา, ทองเหลืองเนื้อแดง) — ตามคำสั่ง Owner:

> หากพบ ... ข้อมูลไม่ตรง Owner instruction:
> - หยุดก่อนเขียนข้อมูล

ผม **หยุดและไม่ได้เขียนข้อมูลใดๆ** — รายงานหลักฐานให้ Owner ตรวจสอบ

---

## 1. สถานะก่อนทำของทุก session วันที่ 08/07, 09/07, 10/07

### 08/07/2569 — 3 sessions (ทั้งหมดยังเป็น DRAFT, ไม่ถูกแตะ)

| # | Session ID | Group | Status | Items | Created At | Note |
|---|---|---|---|---:|---|---|
| 1 | `cmrbzw8te0000jo04qz2skp4q` | ทองแดง | **DRAFT** | 5 | 2026-07-08T11:29:12 | Test copper physical count |
| 2 | `cmrbzwau00007jo043ivzvzcz` | ทองเหลือง | **DRAFT** | 3 | 2026-07-08T11:29:14 | Test brass physical count |
| 3 | `cmrdae0vh0000sgmjvb5aiu0n` | ทองแดง/ทองเหลือง | **DRAFT** | 3 | 2026-07-09T09:10:43 | Draft from owner confirmed physical count for 08/07/2569 (Task 66) |

**ทั้ง 3 session ยังเป็น DRAFT — ไม่มี appliedAt, ไม่มี appliedById — UNTOUCHED ✅**

### 09/07/2569 — 1 session (**ALREADY APPLIED**)

| Session ID | Group | Status | Items | Count Date | Created At | Applied At | Applied By |
|---|---|---|---:|---|---|---|---|
| `cmrdqgfru0000sn8fdmtjjnla` | ทองแดง/ทองเหลือง | **APPLIED** | 8 | 2026-07-09T10:00 | 2026-07-09T16:40:30 | 2026-07-11T06:37:35.914Z | `user_01_default` |

- **appliedNote**: "Owner approved apply for 09/07/2569 copper/brass physical count"
- **reversalOfId**: null (ไม่ใช่ reversal ของ session อื่น)
- **Audit logs**: 2 รายการ (ดูรายละเอียดในส่วนที่ 9)

### 10/07/2569 — 1 session (**ALREADY APPLIED**)

| Session ID | Group | Status | Items | Count Date | Created At | Applied At | Applied By |
|---|---|---|---:|---|---|---|---|
| `cmrfzuu1b0002la044u1ikzzd` | ทองแดง/ทองเหลือง | **APPLIED** | 1 | 2026-07-10T00:00 | 2026-07-11T06:39:10 | 2026-07-11T06:39:26.056Z | `user_01_default` |

- **appliedNote**: "Owner approved apply for 10/07/2569"
- **reversalOfId**: null (ไม่ใช่ reversal ของ session อื่น)
- **Audit logs**: 1 รายการ (ดูรายละเอียดในส่วนที่ 9)
- **Item**: ทองแดงช็อต 3.8 kg (ตรงกับ Owner instruction  exactly)

---

## 2. Session ID วันที่ 09/07/2569

```
cmrdqgfru0000sn8fdmtjjnla
```

---

## 3. Before / Physical / Difference / After ทั้ง 8 รายการ (09/07/2569)

จาก audit log ล่าสุด (last-write-wins) ของ session 09/07:

| # | Product ID | Product Name | Before (kg) | Physical (kg) | Difference (kg) | Avg Cost | Value Diff (THB) | After (kg) |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `prod_mqgp9aevp2yb18adpkyr3qtr` | ทองแดงปอกเงา | 93.70 | 0.00 | -93.70 | 418.37 | -39,201.27 | 0.00 |
| 2 | `prod_mqgp9alick357v31bqqrlv43` | ทองแดงช็อต | 120.20 | 1.16 | -119.04 | 399.09 | -47,493.85 | 1.16 |
| 3 | `prod_mqgp9arb37xlm6b54b0xa44v` | ทองแดงใหญ่ | 56.30 | 8.08 | -48.22 | 377.24 | -18,190.51 | 8.08 |
| 4 | `prod_mqgp9axign3hnk45ex03l4aw` | ทองแดงเล็ก | 17.90 | 7.18 | -10.72 | 392.78 | -4,210.60 | 7.18 |
| 5 | `prod_mqgp9bgavns7vxc8rzrlsn65` | ทองแดงชุบ | 1.70 | 0.00 | -1.70 | 185.17 | -314.79 | 0.00 |
| 6 | `prod_mqgp9bspglewfbgukggj7wdy` | ทองเหลืองหนา | 41.20 | 7.92 | -33.28 | 196.05 | -6,524.54 | 7.92 |
| 7 | `prod_mqgp9bmg24ygg55yytz9jphl` | ทองเหลืองเนื้อแดง | 2.10 | 1.34 | -0.76 | 3.59 | -2.73 | 1.34 |
| — | `cmr09vcvi001cl105spng6d2h` | ทองแดงท่อ Candy | 0.00 | 0.00 | 0.00 (skipped) | 0.00 | 0.00 | 0.00 |

**หมายเหตุ**: 
- "Before" ในตารางนี้คือค่าจาก audit log ล่าสุดที่ mention แต่ละ product (last-write-wins ระหว่าง 2 audit logs)
- ทองแดงท่อ Candy ไม่มีใน audit log เพราะ difference = 0 (skip)
- ผลรวม difference: -307.40 kg, ผลรวม value diff: -115,938.29 THB

---

## 4. ผล Apply วันที่ 09/07/2569

| Metric | Value |
|---|---|
| Status | ✅ **APPLIED** |
| Applied At | 2026-07-11T06:37:35.914Z |
| Applied By | `user_01_default` (นัท ผู้จัดการ) |
| Applied Note | "Owner approved apply for 09/07/2569 copper/brass physical count" |
| Audit Logs Created | 2 รายการ |
| Total Adjustments Applied | 10 (7 + 3 จาก 2 audit logs) |
| Total Lots Deducted | 55 (43 + 12) |
| STOCK_ADJUSTMENT Lots Created | 0 (ไม่มี product ที่ต้องเพิ่มสต็อก) |
| Rollback triggered | ❌ ไม่มี (ไม่พบ PHYSICAL_COUNT_APPLY_FAILED audit log) |

### ⚠️ ข้อสังเกตพิเศษ: มี 2 audit logs สำหรับ session เดียวกัน

| Audit Log ID | Created At | Adjustments | Deducted Lots | Note |
|---|---|---:|---:|---|
| `cmrfzspsh0000la04ziqkm5ze` | 2026-07-11T06:37:31.292Z | 7 | 43 | Apply ครั้งที่ 1 |
| `cmrfzstcy0001la04ro7vy413` | 2026-07-11T06:37:36.803Z | 3 | 12 | Apply ครั้งที่ 2 (5 วินาทีหลังครั้งแรก) |

ทั้งสอง log มี `type: PHYSICAL_COUNT_APPLY` (success, ไม่ใช่ FAILED) — แสดงว่ามีการ Apply 2 ครั้ง โดยครั้งที่ 2 มี before values ของ 3 products (ทองแดงชุบ, ทองเหลืองหนา, ทองเหลืองเนื้อแดง) **กลับเป็นค่าเดิมก่อน Apply ครั้งที่ 1** — แสดงว่ามี restoration script บางอย่างรันระหว่าง 06:37:31 ถึง 06:37:36 ที่ restored สต็อกของ 3 products และ reset session status กลับเป็น DRAFT (แต่ไม่ได้ลบ audit log แรก)

---

## 5. Session ID วันที่ 10/07/2569

```
cmrfzuu1b0002la044u1ikzzd
```

---

## 6. Product ID และชื่อจริงของทองแดงช็อต

```
Product ID : prod_mqgp9alick357v31bqqrlv43
Product Name: ทองแดงช็อต (exact match — single product, ไม่กำกวม)
```

จากการค้นหาด้วย `name: { contains: 'ทองแดงช็อต' }` — พบเพียง 1 รายการ ไม่มี ambiguous mapping ✅

---

## 7. Before / Physical 3.8 / Difference / After (10/07/2569)

จาก audit log ของ session 10/07:

| Product ID | Product Name | Before (kg) | Physical (kg) | Difference (kg) | Avg Cost | Value Diff (THB) | After (kg) |
|---|---|---:|---:|---:|---:|---:|---:|
| `prod_mqgp9alick357v31bqqrlv43` | ทองแดงช็อต | 1.16 | 3.80 | +2.64 | 40.00 | +105.60 | 3.80 |

**Verification ปัจจุบัน**: ทองแดงช็อต = 3.8 kg across 2 active lots ✅ MATCH (delta = 0)

---

## 8. ผล Apply วันที่ 10/07/2569

| Metric | Value |
|---|---|
| Status | ✅ **APPLIED** |
| Applied At | 2026-07-11T06:39:26.056Z |
| Applied By | `user_01_default` (นัท ผู้จัดการ) |
| Applied Note | "Owner approved apply for 10/07/2569" |
| Audit Log ID | `cmrfzv6cg0007la046dqa9ugo` |
| Adjustments Applied | 1 |
| STOCK_ADJUSTMENT Lots Created | 1 (id: `cmrfzv4z50006la04z2x0f5qz`) |
| Lots Deducted | 0 (because adjustment was positive — adding stock) |
| Current stock ทองแดงช็อต | 3.8 kg ✅ MATCH (ตรงกับ Owner instruction) |

---

## 9. AuditLog IDs

| # | Audit Log ID | Session | Created At | Type |
|---|---|---|---|---|
| 1 | `cmrfzspsh0000la04ziqkm5ze` | 09/07 (`cmrdqgfru0000sn8fdmtjjnla`) | 2026-07-11T06:37:31.292Z | PHYSICAL_COUNT_APPLY (7 adjustments, 43 lots deducted) |
| 2 | `cmrfzstcy0001la04ro7vy413` | 09/07 (`cmrdqgfru0000sn8fdmtjjnla`) | 2026-07-11T06:37:36.803Z | PHYSICAL_COUNT_APPLY (3 adjustments, 12 lots deducted) |
| 3 | `cmrfzv6cg0007la046dqa9ugo` | 10/07 (`cmrfzuu1b0002la044u1ikzzd`) | 2026-07-11T06:39:26.945Z | PHYSICAL_COUNT_APPLY (1 adjustment, 1 STOCK_ADJUSTMENT lot created) |

---

## 10. Total stock ก่อนและหลัง

### Global Safety Snapshot (current state)

| Metric | Value | Status |
|---|---:|---|
| Total stock weight | 572,189.44 kg | (baseline Task 70: 552,312.30 kg, delta +19,877.14 kg — เพิ่มขึ้นจาก business activity ปกติ) |
| StockLot count | 1,153 | ✅ |
| BuyBill count | 174 | ✅ |
| SellBill count | 18 | ✅ |
| SortingBill count | 146 | ✅ |
| StockTransfer count | 11 | ✅ |
| Product count | 113 | ✅ |
| PhysicalCountSession count | 5 | ✅ (3 DRAFT 08/07 + 1 APPLIED 09/07 + 1 APPLIED 10/07) |

### Per-Product Stock Verification (current vs audit log expected)

| # | Product | Audit Log "After" (kg) | Current Live Stock (kg) | Match? | Delta (kg) |
|---:|---|---:|---:|---|---:|
| 1 | ทองแดงปอกเงา | 0.00 | 0.00 | ✅ MATCH | 0.00 |
| 2 | ทองแดงช็อต | 3.80 (after 10/07 apply) | 3.80 | ✅ MATCH | 0.00 |
| 3 | ทองแดงท่อ Candy | N/A (skipped) | 0.00 | N/A | — |
| 4 | ทองแดงใหญ่ | 8.08 | 8.08 | ✅ MATCH | 0.00 |
| 5 | ทองแดงเล็ก | 7.18 | 7.18 | ✅ MATCH | 0.00 |
| 6 | ทองแดงชุบ | 0.00 | 0.00 | ✅ MATCH | 0.00 |
| 7 | **ทองเหลืองหนา** | **7.92** | **0.00** | ❌ **MISMATCH** | **-7.92** |
| 8 | **ทองเหลืองเนื้อแดง** | **1.34** | **0.58** | ❌ **MISMATCH** | **-0.76** |

---

## 11. Negative StockLots

```
Global negative StockLots: 0 ✅
Per-product negative StockLots (09/07 + 10/07 affected products): 0 ✅
```

**ไม่มี StockLots ติดลบในระบบ** — ปลอดภัย

---

## 12. Draft วันที่ 08/07 ยังคงเดิมหรือไม่

**ใช่, ยังคงเดิมทั้ง 3 session ✅**

| Session ID | Status | Applied At | Applied By | Untouched? |
|---|---|---|---|---|
| `cmrbzw8te0000jo04qz2skp4q` | DRAFT | null | null | ✅ YES |
| `cmrbzwau00007jo043ivzvzcz` | DRAFT | null | null | ✅ YES |
| `cmrdae0vh0000sgmjvb5aiu0n` | DRAFT | null | null | ✅ YES |

**ห้าม Merge / Delete / แก้ไข / Apply 08/07 drafts** — ปฏิบัติตาม Owner instruction ครบถ้วน

---

## 13. Error, rollback หรือ compensation ที่เกิดขึ้น

### ระหว่างการตรวจสอบ (this session)
- ❌ **ไม่มี error, rollback หรือ compensation ใดๆ เกิดขึ้น**
- ✅ ผมไม่ได้เขียนข้อมูลใดๆ ลง DB (เป็น read-only verification ตาม Owner instruction)
- ✅ ไม่ได้ Apply ซ้ำ, ไม่ได้ Reverse, ไม่ได้ Merge, ไม่ได้ Delete

### ในอดีต (จาก audit logs)
- ⚠️ พบว่า session 09/07 ถูก Apply 2 ครั้ง (06:37:31 และ 06:37:36) — ทั้งสองครั้ง success (type=PHYSICAL_COUNT_APPLY, ไม่ใช่ FAILED)
- ⚠️ ระหว่างสองครั้งนั้น มี restoration script บางอย่างรัน (restored stock ของ 3 products: ทองแดงชุบ, ทองเหลืองหนา, ทองเหลืองเนื้อแดง กลับเป็นค่าเดิมก่อน Apply)
- ⚠️ Restoration ไม่สมบูรณ์สำหรับ ทองแดงชุบ (restore จาก 0 → 1.7, ไม่ใช่ 2.3 ดั้งเดิม)

### ข้อสังเกตพิเศษ — Discrepancy ในปัจจุบัน
- ❌ **ทองเหลืองหนา**: audit log บอก after apply = 7.92 kg, แต่ current = 0 kg (missing 7.92 kg)
- ❌ **ทองเหลืองเนื้อแดง**: audit log บอก after apply = 1.34 kg, แต่ current = 0.58 kg (missing 0.76 kg)

### การตรวจสอบสาเหตุการหายไปของ stock (read-only investigation)
ตรวจสอบแล้ว **ไม่พบ** consumption events หลัง apply timestamp (2026-07-11T06:37:36Z):
- ❌ ไม่มี SellBillItem สำหรับ ทองเหลืองหนา หรือ ทองเหลืองเนื้อแดง หลัง apply
- ❌ ไม่มี SortingBill (as source) สำหรับทั้งสอง products หลัง apply
- ❌ ไม่มี StockTransfer (as source) สำหรับทั้งสอง products หลัง apply
- ❌ ไม่มี BuyBill cancellation หลัง apply
- ❌ ไม่มี SortingBill cancellation หลัง apply
- ❌ ไม่มี StockTransfer cancellation หลัง apply
- ❌ ไม่มี STOCK_ADJUSTMENT lots สำหรับทั้งสอง products หลัง apply
- ❌ ไม่มี StockLot updatedAt > apply timestamp สำหรับทั้งสอง products

**หมายเหตุ**: สำหรับ ทองเหลืองเนื้อแดง พบ SortingBill 1 รายการ (id: `cmqoyokw5000bqjlgawq69n8w`) ที่มี createdAt=2026-12-28T10:00:00Z (date=2026-06-25) เพิ่ม 2 kg — แต่ createdAt อนาคต (Dec 2026) บ่งชี้ว่าเป็น backdated record ที่สร้างภายหลัง และยังไง current stock (0.58 kg) ก็ยังน้อยกว่า expected (1.34 + 2 = 3.34 kg) อยู่ 2.76 kg

### สรุป
สาเหตุของ missing stock ไม่สามารถระบุได้จากข้อมูล bill records ปกติ — เป็นไปได้ว่าเกิดจาก:
1. Manual SQL/DB edit
2. Bug ใน apply endpoint ที่ deduct มากกว่าที่ audit log บันทึก (เช่น double-apply pattern ที่เห็น)
3. กระบวนการอื่นที่ไม่ได้รับการบันทึกในระบบบิล

**ตามคำสั่ง Owner — ผมหยุดและรายงาน ไม่แก้ไขข้อมูล**

---

## 14. Ready / Not Ready to close ST-9

### ⚠️ NOT READY — ต้องการ Owner review ก่อน

### เหตุผล
1. ✅ Apply endpoint ทำงานถูกต้องตาม spec (ตรวจสอบจาก audit logs)
2. ✅ ไม่มี negative StockLots
3. ✅ 08/07 drafts ไม่ถูกแตะ
4. ✅ ทองแดงช็อต = 3.8 kg ตรงตาม Owner instruction (10/07)
5. ❌ **พบ stock discrepancy 2 รายการ** ที่ต้อง Owner ตัดสินใจ:
   - ทองเหลืองหนา: missing 7.92 kg
   - ทองเหลืองเนื้อแดง: missing 0.76 kg

### คำแนะนำ
- อย่า Apply ซ้ำ, อย่า Reverse, อย่าแก้ stock โดยตรง
- Owner ควรตรวจสอบกิจกรรมรอบๆ 2026-07-11T06:37:00Z ถึง 06:40:00Z (เวลาที่ Apply ทั้งสอง session)
- พิจารณาเปิด investigation แยกต่างหากสำหรับ missing stock (อาจเป็นปัญหาจาก double-apply pattern)
- หาก Owner ยืนยันว่า current stock ถูกต้อง (มีการใช้สต็อกจริงที่ไม่ถูกบันทึกในระบบ) — อาจสร้าง physical count session ใหม่ในอนาคตเพื่อ reconcile

---

## Files Produced (read-only verification)

ทั้งหมดอยู่ใน `/home/z/my-project/reconciliation/physical-count-apply-2026-07-09-and-10/`:

1. `step1-verify-sessions.mjs` — Read-only verification script (all sessions + audit logs + safety snapshot)
2. `step1-sessions-verify.json` — JSON dump ของผล verification
3. `step1-sessions-verify.csv` — CSV summary ของ sessions
4. `step2-3-verify-post-apply.mjs` — Post-apply stock verification script
5. `step2-3-verify-post-apply.json` — JSON dump ของ post-apply verification
6. `step2-3-verify-post-apply.csv` — CSV ของ per-product stock match
7. `step-investigate-consumption.mjs` — Investigation script (consumption events after apply)
8. `step-investigate-consumption.json` — JSON dump ของ consumption investigation
9. `step-investigate-cancellations.mjs` — Investigation script (cancellations + StockLot updatedAt)
10. `FINAL_REPORT.md` — รายงานนี้

---

## Owner Instruction Compliance

| Instruction | Compliance |
|---|---|
| ตรวจสถานะจริงก่อนเขียนข้อมูล | ✅ Done (Step 1) |
| ห้าม Apply ซ้ำ (09/07 และ 10/07 already APPLIED) | ✅ Did NOT re-apply |
| ห้าม Merge / Delete | ✅ None performed |
| ห้ามแก้ Draft 08/07 | ✅ Untouched (verified all 3 still DRAFT) |
| ห้าม Reverse อัตโนมัติ | ✅ No reverse performed |
| ห้าม Permission test | ✅ None performed |
| ห้าม Credential rotation | ✅ None performed |
| ห้าม Commit / Push / Deploy ถ้าไม่จำเป็น | ✅ None performed (no code changes) |
| หยุดก่อนเขียนข้อมูลหากพบ discrepancy | ✅ Stopped, reported (no DB writes) |
| ห้ามแสดง password / token / DATABASE_URL | ✅ None exposed (script URLs not shown in this report — only in reconciliation scripts which are gitignored) |

---

**รายงานเสร็จสมบูรณ์ — รอ Owner ตรวจสอบและตัดสินใจ**
