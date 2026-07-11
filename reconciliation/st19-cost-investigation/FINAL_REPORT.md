# ST-19 Phase 3 — Cost Investigation Report

**Task ID**: ST-19 Phase 3 (Cost investigation before Apply)
**Agent**: Main
**Date**: 2026-07-11 (CE) / 11/07/2569 (Thai)
**Session ID**: `cmrgli52j0000oslknzwk9gah`
**Mode**: READ-ONLY — no DB writes performed

---

## Executive Summary

ตรวจพบว่า Draft ปัจจุบันมีต้นทุนที่ **ไม่สมเหตุสมผล** สำหรับ 6 ใน 8 รายการที่ต้องเพิ่มสต็อก:
- 5 รายการมี `averageCost = 0` (จะสร้าง zero-cost lot ถ้า Apply)
- 1 รายการ (ทองแดงช็อต) มี `averageCost = 40` ซึ่งผิดปกติมาก (ราคาจริงประมาณ 399-415 THB/kg)
- 1 รายการ (ทองแดงท่อ Candy) **ไม่มีข้อมูลต้นทุนใดๆ ในระบบ** — Owner ต้องกำหนดเอง

**Apply endpoint behavior (verified from code)**:
- ใช้ `averageCost` ที่ stored บน `PhysicalCountItem` (snapshot ตอนสร้าง Draft)
- ไม่ recompute ตอน Apply
- ถ้า `averageCost = 0` → จะสร้าง StockLot ที่มี `costPerKg = 0` (zero-cost lot) จริงๆ
- **ไม่มี PATCH/PUT endpoint** สำหรับแก้ Draft → ต้อง delete และ recreate Draft ใหม่ด้วย cost ที่ถูกต้อง

**มูลค่าผลกระทบ**:
- Draft ปัจจุบัน: 34,362.97 THB (understated)
- Revised (recommended): **189,706.10 THB**
- Delta: **+155,343.13 THB** (เพิ่มขึ้น 4.5x)

**สถานะ**: ⚠️ NOT READY for Apply — ต้องแก้ Draft ก่อน (delete + recreate ด้วย cost ที่ถูกต้อง)

---

## 1. ต้นทุนย้อนหลังของแต่ละสินค้า

### ทองเหลืองหนา (id=`prod_mqgp9bspglewfbgukggj7wdy`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 0.00 | ⚠️ zero |
| Current active lots | 0 lots | all depleted |
| Current active lot avgCost | 0.00 | (no active lots) |
| Latest valid BuyBill price | 253 THB/kg | 2026-07-08, BUY-2569-00155 |
| Weighted avg 30d | 260.73 THB/kg | across 14 bills, 174.6 kg total |
| Weighted avg 90d | 260.73 THB/kg | (same as 30d — all recent) |
| Latest historical lot cost | 0.00 | (latest is zero-cost) |
| Pre-09/07 audit log avgCost | **196.05 THB/kg** | (was 41.2 kg before apply) |
| Cancelled bills | 1 (BUY-2569-00001, reason: ใส่วันที่ผิด) | excluded from averages |
| Zero-cost lots | YES ⚠️ | (multiple) |
| STOCK_ADJUSTMENT lots | no | |

### ทองเหลืองเนื้อแดง (id=`prod_mqgp9bmg24ygg55yytz9jphl`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 0.00 | ⚠️ zero |
| Current active lots | 1 lot | remaining 0.58 kg |
| Current active lot avgCost | 0.00 | (active lot has costPerKg=0) |
| Latest valid BuyBill price | — | ❌ no buy records |
| Weighted avg 30d | — | ❌ no buy records |
| Weighted avg 90d | — | ❌ no buy records |
| Latest historical lot cost | 9.00 | (SORTING lot, date 2026-12-28 — future) |
| Pre-09/07 audit log avgCost | **3.59 THB/kg** | (was 2.1 kg before apply) |
| Cancelled bills | 0 | |
| Zero-cost lots | YES ⚠️ | (multiple) |
| STOCK_ADJUSTMENT lots | no | |

### ทองแดงปอกเงา (id=`prod_mqgp9aevp2yb18adpkyr3qtr`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 0.00 | ⚠️ zero |
| Current active lots | 0 lots | all depleted |
| Latest valid BuyBill price | 422 THB/kg | 2026-07-07, BUY-2569-00139 |
| Weighted avg 30d | 425.22 THB/kg | across 16 bills, 81 kg |
| Weighted avg 90d | 425.22 THB/kg | |
| Latest historical lot cost | 40.00 | (TRANSFER lot, 2026-07-08) |
| Pre-09/07 audit log avgCost | **418.37 THB/kg** | (was 93.7 kg before apply) |
| Cancelled bills | 1 | excluded |
| Zero-cost lots | YES ⚠️ | |
| STOCK_ADJUSTMENT lots | no | |

### ทองแดงช็อต (id=`prod_mqgp9alick357v31bqqrlv43`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 40.00 | ⚠️ very low (likely wrong) |
| Current active lots | 2 lots | remaining 3.8 kg total |
| Current active lot avgCost | 40.00 | (both lots have costPerKg=40) |
| Latest valid BuyBill price | 412 THB/kg | 2026-07-07 |
| Weighted avg 30d | 415.22 THB/kg | across 18 bills, 116 kg |
| Weighted avg 90d | 415.22 THB/kg | |
| Latest historical lot cost | 40.00 | (TRANSFER lot, 2026-07-08) |
| Pre-09/07 audit log avgCost | **399.09 THB/kg** | (was 120.2 kg before apply) |
| Cancelled bills | 1 | excluded |
| Zero-cost lots | YES ⚠️ | |
| STOCK_ADJUSTMENT lots | YES (1, from 10/07 apply) | |

**⚠️ ANOMALY**: costPerKg=40 ที่ active มาจาก TRANSFER lot (cmrbj73bo000fjp04lo5esj6v) — เป็น transfer จาก source อื่นที่ inherit cost ต่ำ ไม่ใช่ cost ซื้อจริง

### ทองแดงท่อ Candy (id=`cmr09vcvi001cl105spng6d2h`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 0.00 | ⚠️ zero |
| Current active lots | 0 lots | all depleted |
| Latest valid BuyBill price | — | ❌ no buy records |
| Weighted avg 30d | — | ❌ no buy records |
| Weighted avg 90d | — | ❌ no buy records |
| Latest historical lot cost | 0.00 | |
| Pre-09/07 audit log avgCost | — | (not in 09/07 session — diff was 0) |
| Cancelled bills | 0 | |
| Zero-cost lots | YES ⚠️ | |
| STOCK_ADJUSTMENT lots | YES | |

**❌ NO COST DATA AVAILABLE** — Owner must define

### ทองแดงใหญ่ (id=`prod_mqgp9arb37xlm6b54b0xa44v`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 275.86 | (computed from 6 active lots — see below) |
| Current active lots | 6 lots | remaining 8.08 kg total |
| Current active lot avgCost | 275.86 THB/kg | (weighted avg) |
| Latest valid BuyBill price | 396 THB/kg | 2026-07-08 |
| Weighted avg 30d | 400.10 THB/kg | across 21 bills, 423.7 kg |
| Weighted avg 90d | 400.10 THB/kg | |
| Latest historical lot cost | 9.00 | (SORTING lot, future date) |
| Pre-09/07 audit log avgCost | **377.24 THB/kg** | (was 56.3 kg before apply) |
| Cancelled bills | 1 | excluded |
| Zero-cost lots | YES | |
| STOCK_ADJUSTMENT lots | no | |

**Active lots detail** (ที่ทำให้ current avgCost = 275.86 ต่ำกว่าปกติ):
| Lot ID | Remaining | costPerKg | Source | DateAdded |
|---|---:|---:|---|---|
| cmrbj75hb000ljp04kcvuiu5f | 1.78 | **40** ⚠️ | TRANSFER | 2026-07-08 |
| cmrd408ys000mi8041naci680 | 0.40 | **9.42** ⚠️ | TRANSFER | 2026-07-08 |
| cmrd7m3e400d5sgm67tungfy6 | 0.90 | 396 | BUY | 2026-07-08 |
| cmrd7mfvf00frsgm65wbd3w32 | 4.00 | 386 | BUY | 2026-07-08 |
| cmrd7mhdu00g2sgm6eg6aie2z | 0.60 | 396 | BUY | 2026-07-08 |
| cmrd81we60006ji04re4bj415 | 0.40 | **40** ⚠️ | TRANSFER | 2026-07-09 |

→ 3 lots มี cost ต่ำผิดปกติ (TRANSFER lots ที่ inherit cost ต่ำจากการแยกสินค้า) → ทำให้ avgCost ลดลงจาก 377.24 (pre-09/07) เหลือ 275.86

### ทองแดงเล็ก (id=`prod_mqgp9axign3hnk45ex03l4aw`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 383.58 | (computed from 4 active lots) |
| Current active lots | 4 lots | remaining 7.18 kg total |
| Current active lot avgCost | 383.58 THB/kg | (weighted avg) |
| Latest valid BuyBill price | 390 THB/kg | 2026-07-06 |
| Weighted avg 30d | 397.45 THB/kg | across 9 bills, 166.5 kg |
| Weighted avg 90d | 397.45 THB/kg | |
| Latest historical lot cost | 9.00 | (SORTING lot, future) |
| Pre-09/07 audit log avgCost | **392.78 THB/kg** | (was 17.9 kg before apply) |
| Cancelled bills | 1 | excluded |
| Zero-cost lots | YES | |
| STOCK_ADJUSTMENT lots | no | |

**Active lots detail** (avgCost = 383.58 ใกล้เคียงปกติ แต่มี lot แปลก):
| Lot ID | Remaining | costPerKg | Source | DateAdded |
|---|---:|---:|---|---|
| cmrd7lcx2007gsgm6dlllx7xw | 0.80 | 390 | BUY | 2026-07-06 |
| cmrd7lape006xsgm6wwx1vadx | 6.08 | 401 | BUY | 2026-07-06 |
| cmrbj741k000hjp04bbh5q6uf | 0.10 | **40** ⚠️ | TRANSFER | 2026-07-08 |
| cmrdpxpjo000ml104u9pbe51l | 0.20 | **0** ⚠️ | SORTING | 2026-07-09 |

### ทองแดงชุบ (id=`prod_mqgp9bgavns7vxc8rzrlsn65`)

| Source | Value | Notes |
|---|---:|---|
| Draft avgCost (current) | 0.00 | ⚠️ zero |
| Current active lots | 0 lots | all depleted |
| Latest valid BuyBill price | 373 THB/kg | 2026-07-06, BUY-2569-00102 |
| Weighted avg 30d | 373.83 THB/kg | across 5 bills, 3.5 kg |
| Weighted avg 90d | 373.83 THB/kg | |
| Latest historical lot cost | 40.00 | (TRANSFER lot) |
| Pre-09/07 audit log avgCost | **185.17 THB/kg** | (was 2.3 kg before apply) |
| Cancelled bills | 1 | excluded |
| Zero-cost lots | YES ⚠️ | |
| STOCK_ADJUSTMENT lots | no | |

**⚠️ ANOMALY**: Pre-09/07 avgCost = 185.17 แต่ weighted avg 30d = 373.83 → ต้นทุนเดิมต่ำกว่าราคาตลาดล่าสุดมาก อาจเป็นเพราะ lot เดิมมาจาก SORTING (cost 8.85) ผสม BUY (cost 373)

---

## 2. Recommended Cost Basis

| # | Product | Recommended Cost (THB/kg) | Source | Confidence | Reason |
|---:|---|---:|---|---|---|
| 1 | ทองเหลืองหนา | **196.05** | 09/07 audit log "before" avgCost | **High** | weighted avg of lots that existed before error (41.2 kg @ 196.05) |
| 2 | ทองเหลืองเนื้อแดง | **3.59** | 09/07 audit log "before" avgCost | Medium | only data source (no buy records) — small weight so low impact |
| 3 | ทองแดงปอกเงา | **418.37** | 09/07 audit log "before" avgCost | **High** | weighted avg of 93.7 kg that existed before error |
| 4 | ทองแดงช็อต | **399.09** | 09/07 audit log "before" avgCost | **High** | weighted avg of 120.2 kg that existed before error |
| 5 | ทองแดงท่อ Candy | **OWNER MUST DEFINE** | — | N/A | no buy records, no historical cost, no audit log entry |
| 6 | ทองแดงใหญ่ | **377.24** | 09/07 audit log "before" avgCost | **High** | weighted avg of 56.3 kg that existed before error |
| 7 | ทองแดงเล็ก | **392.78** | 09/07 audit log "before" avgCost | **High** | weighted avg of 17.9 kg that existed before error |
| 8 | ทองแดงชุบ | **185.17** | 09/07 audit log "before" avgCost | Medium | only 2.3 kg existed before, but consistent with mix of BUY+SORTING |

---

## 3. แหล่งอ้างอิงต้นทุน

### Primary source (used for 7/8 products): **09/07 audit log "before" avgCost**
- เป็น weighted average ของ StockLots ทั้งหมดที่มีอยู่ก่อนเกิดความผิดพลาดจาก 09/07 apply
- บันทึกใน `AuditLog.details.adjustments[].avgCost` ของ session `cmrdqgfru0000sn8fdmtjjnla`
- Audit log ID ที่ใช้: `cmrfzspsh0000la04ziqkm5ze` (06:37:31.292Z, 7 adjustments)
- **เหตุผล**: เป็นต้นทุนที่ถูกต้องที่สุดของ stock ที่ควรจะเหลืออยู่ก่อนถูก deduct ผิด

### Alternatives (per product, in priority order)

| Priority | Source | When to use |
|---|---|---|
| 1 | Pre-09/07 audit log avgCost | Default — best represents the stock we are restoring |
| 2 | Current active lot weighted avg | If pre-09/07 unavailable, and active lots have non-zero cost |
| 3 | Weighted avg purchase last 30 days | If no active lots, use recent market price |
| 4 | Weighted avg purchase last 90 days | If 30d insufficient |
| 5 | Latest valid purchase price | Last resort |
| 6 | Latest historical depleted lot | Reference only |
| 7 | Owner-defined | When no data exists |

---

## 4. รายการที่ยังตัดสินใจต้นทุนไม่ได้

### ❌ ทองแดงท่อ Candy — Owner ต้องกำหนดเอง

**เหตุผล**:
- ไม่มี BuyBill record (ไม่เคยซื้อผ่าน BuyBill)
- ไม่มี active StockLot
- มีเฉพาะ STOCK_ADJUSTMENT lot ที่ costPerKg=0
- ไม่อยู่ใน 09/07 audit log (เพราะ diff=0 ใน session นั้น)

**คำแนะนำ**: Owner ระบุต้นทุนที่เหมาะสมสำหรับ 0.90 kg ของ ทองแดงท่อ Candy (อาจอ้างอิงจากราคาทองแดงทั่วไป เช่น 400 THB/kg หรือตามที่ Owner ทราบ)

---

## 5. Revised Value Impact

| # | Product | Diff (kg) | Draft Cost | Rec Cost | Draft ValDiff | Revised ValDiff | Delta |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | ทองเหลืองหนา | +89.40 | 0 | 196.05 | 0 | **17,526.87** | +17,526.87 |
| 2 | ทองเหลืองเนื้อแดง | +3.08 | 0 | 3.59 | 0 | **11.06** | +11.06 |
| 3 | ทองแดงปอกเงา | +182.75 | 0 | 418.37 | 0 | **76,457.12** | +76,457.12 |
| 4 | ทองแดงช็อต | +149.94 | 40 | 399.09 | 5,997.60 | **59,839.55** | +53,841.95 |
| 5 | ทองแดงท่อ Candy | +0.90 | 0 | (TBD) | 0 | (TBD) | (TBD) |
| 6 | ทองแดงใหญ่ | +67.34 | 275.86 | 377.24 | 18,576.41 | **25,403.34** | +6,826.93 |
| 7 | ทองแดงเล็ก | +25.52 | 383.58 | 392.78 | 9,788.96 | **10,023.75** | +234.79 |
| 8 | ทองแดงชุบ | +2.40 | 0 | 185.17 | 0 | **444.41** | +444.41 |
| **TOTAL (excl. Candy)** | | **+521.33** | | | **34,362.97** | **189,706.10** | **+155,343.13** |

### เปรียบเทียบมูลค่า
- **Draft ปัจจุบัน**: 34,362.97 THB (understated)
- **Revised (recommended)**: 189,706.10 THB
- **Delta**: +155,343.13 THB (เพิ่มขึ้น ~4.5x)
- **+ ทองแดงท่อ Candy**: รอ Owner กำหนด cost

---

## 6. พฤติกรรม Apply Endpoint

### ตรวจ code: `/api/physical-counts/[id]/apply/route.ts`

| Question | Answer | Code Reference |
|---|---|---|
| Apply ใช้ averageCost จาก PhysicalCountItem หรือคำนวณใหม่? | **ใช้จาก PhysicalCountItem** (snapshot ตอนสร้าง Draft) | line 94: `avgCost: item.averageCost` |
| Positive adjustment สร้าง StockLot แบบใด? | สร้าง `STOCK_ADJUSTMENT` lot ใหม่ with `costPerKg = adj.avgCost` | line 149-158 |
| หาก averageCost = 0 จะสร้าง zero-cost lot จริงหรือไม่? | **ใช่ จริง** — `costPerKg: 0` จะถูกบันทึก | (no validation in code) |
| สามารถแก้ averageCost ใน Draft ก่อน Apply ผ่าน UI/API ได้หรือไม่? | **❌ ไม่ได้** — ไม่มี PATCH/PUT endpoint สำหรับ PhysicalCountItem หรือ session | verified in `[id]/route.ts` (มีเฉพาะ GET) |
| หากแก้ไม่ได้ ต้องใช้แนวทางใด? | **Delete + Recreate Draft** (ผ่าน API `DELETE /api/physical-counts/{id}` ถ้ามี, หรือต้องเพิ่ม endpoint ใหม่) | (see Section 7) |

### โค้ดสำคัญ (apply endpoint)

```typescript
// /api/physical-counts/[id]/apply/route.ts line 70-96
for (const item of session.items) {
  // Re-read current stock
  const lots = await db.stockLot.findMany({
    where: { productId: item.productId, remainingWeight: { gt: 0 } },
    select: { id: true, remainingWeight: true, costPerKg: true },
  });
  const currentStock = ...
  const adjustmentWeight = ...
  ...
  adjustments.push({
    item,
    currentStock,
    adjustmentWeight,
    avgCost: item.averageCost,  // ⚠️ USES SNAPSHOT, not recomputed
    afterWeight,
  });
}

// line 149-158
const lot = await db.stockLot.create({
  data: {
    productId: adj.item.productId,
    remainingWeight: adj.adjustmentWeight,
    costPerKg: adj.avgCost,  // ⚠️ IF ZERO, LOT WILL HAVE ZERO COST
    dateAdded: new Date(),
    source: 'STOCK_ADJUSTMENT',
    sourceId: sessionId,
  },
});
```

### สรุปพฤติกรรม
1. Apply จะใช้ `averageCost` ที่ stored ใน `PhysicalCountItem` (snapshot ตอนสร้าง Draft)
2. ถ้า `averageCost = 0` → Apply จะสร้าง STOCK_ADJUSTMENT lot with `costPerKg = 0` (zero-cost lot)
3. ไม่มี validation ใน code เพื่อบล็อก zero-cost
4. ไม่มี PATCH/PUT endpoint สำหรับแก้ Draft → **ต้อง delete + recreate**

---

## 7. วิธีใส่ต้นทุนที่ถูกต้องก่อน Apply

### ข้อจำกัด
- ❌ ไม่มี PATCH/PUT endpoint สำหรับ PhysicalCountSession หรือ PhysicalCountItem
- ❌ ไม่สามารถแก้ field `averageCost` ของ item ที่สร้างแล้วได้ผ่าน API
- ❌ Owner ห้ามใช้ direct SQL

### แนวทางที่เป็นไปได้ (ตามลำดับความปลอดภัย)

#### แนวทาง A: Delete + Recreate Draft (RECOMMENDED — ปลอดภัยที่สุด)

**ขั้นตอน**:
1. ตรวจว่ามี `DELETE /api/physical-counts/{id}` endpoint หรือไม่ — **ถ้าไม่มี ต้องเพิ่มก่อน**
2. Delete Draft `cmrgli52j0000oslknzwk9gah` (status ต้องเป็น DRAFT)
3. สร้าง Draft ใหม่ด้วย `POST /api/physical-counts` โดยใส่ `averageCost` ที่ถูกต้องในแต่ละ item
4. ตรวจ Preview อีกครั้ง
5. รอ Owner อนุมัติ Apply

**ข้อดี**: ใช้ existing API, มี audit log ของการ delete (ถ้า implement)
**ข้อเสีย**: ต้องเพิ่ม DELETE endpoint ถ้ายังไม่มี

#### แนวทาง B: เพิ่ม PATCH endpoint สำหรับแก้ item averageCost

**ขั้วตอน**:
1. เพิ่ม `PATCH /api/physical-counts/[id]/items/[itemId]` endpoint สำหรับแก้ `averageCost` (เฉพาะเมื่อ status=DRAFT)
2. แก้แต่ละ item ผ่าน API
3. ตรวจ Preview
4. รอ Owner อนุมัติ Apply

**ข้อดี**: ไม่ต้อง delete/recreate
**ข้อเสีย**: ต้องเขียน endpoint ใหม่ + Commit/Push/Deploy (Owner อาจห้ามในรอบนี้)

#### แนวทาง C: Apply Draft ปัจจุบัน แล้ว convert cost ภายหลัง

**ขั้นตอน**:
1. Apply Draft ปัจจุบัน (จะได้ zero-cost lots 5 รายการ + ทองแดงช็อต cost 40)
2. หลัง Apply ใช้ STOCK_ADJUSTMENT mechanism อื่นเพื่อปรับ cost (แต่ยังไม่มี API สำหรับเปลี่ยน costPerKg ของ lot)

**❌ ไม่แนะนำ**: สร้าง zero-cost lots ก่อนแล้วแก้ทีหลังยากกว่า และอาจมี side effects

### คำแนะนำ
**ใช้แนวทาง A** (Delete + Recreate):
1. ตรวจ `/api/physical-counts/[id]/route.ts` ว่ามี DELETE handler หรือไม่
2. ถ้าไม่มี → ขอ Owner อนุมัติเพิ่ม DELETE endpoint (small change)
3. Delete Draft `cmrgli52j0000oslknzwk9gah`
4. สร้าง Draft ใหม่ด้วย cost ที่แนะนำใน Section 2

---

## 8. Draft ยังเป็น DRAFT หรือไม่

**✅ YES — Draft ยังเป็น DRAFT**

| Field | Value |
|---|---|
| Session ID | `cmrgli52j0000oslknzwk9gah` |
| status | **DRAFT** ✅ |
| countDate | 2026-07-11T10:00:00.000Z |
| appliedAt | null ✅ |
| appliedById | null ✅ |
| createdAt | 2026-07-11T16:45:10.315Z |
| items | 10 |

---

## 9. ยืนยันไม่มี Production write

### DB writes performed in this phase
**❌ NONE — fully read-only**

| Action | Performed? |
|---|---|
| Apply | ❌ NOT performed |
| Reverse | ❌ NOT performed |
| Adjustment (direct) | ❌ NOT performed |
| Delete Draft | ❌ NOT performed |
| Modify Draft items | ❌ NOT performed |
| Direct StockLot write | ❌ NOT performed |
| Restoration script | ❌ NOT performed |
| Direct SQL edit | ❌ NOT performed |
| Commit / Push / Deploy | ❌ NOT performed |
| Add DELETE endpoint | ❌ NOT performed (only suggested) |

### Operations performed (all read-only)
- `db.physicalCountSession.findUnique()` — read session
- `db.stockLot.findMany()` — read lots
- `db.buyBillItem.findMany()` — read buy history
- `db.auditLog.findMany()` — read audit logs
- `db.product.findUnique()` / `findMany()` — read products

**Safety**: ✅ ALL READS — zero DB writes

---

## 10. Ready / Not Ready for Owner cost approval

### ⚠️ NOT READY for Apply — ต้องแก้ Draft ก่อน

### เหตุผล
1. ❌ Draft ปัจจุบันมี `averageCost = 0` สำหรับ 5 รายการ → Apply จะสร้าง zero-cost lots
2. ❌ Draft ปัจจุบันมี `averageCost = 40` สำหรับ ทองแดงช็อต → ผิดปกติ (ควรเป็น ~399)
3. ❌ ไม่มี PATCH endpoint สำหรับแก้ Draft items
4. ⚠️ ทองแดงท่อ Candy ไม่มีข้อมูลต้นทุนใดๆ → Owner ต้องกำหนดเอง
5. ✅ มูลค่า revised (189,706 THB) สมเหตุสมผลกว่า Draft ปัจจุบัน (34,363 THB)

### Owner ต้องตัดสินใจ
1. **อนุมัติ cost recommendations** ใน Section 2 (7 รายการที่มีข้อมูล)?
2. **กำหนด cost สำหรับ ทองแดงท่อ Candy** (0.90 kg)?
3. **เลือกแนวทางแก้ Draft**:
   - (ก) Delete + Recreate Draft (RECOMMENDED — ต้องเพิ่ม DELETE endpoint ถ้ายังไม่มี)
   - (ข) เพิ่ม PATCH endpoint (ต้อง Commit/Push/Deploy)
   - (ค) อื่นๆ ตามที่ Owner เห็นสมควร

### ข้อแนะนำ
1. Owner อนุมัติ cost recommendations ทั้ง 7 รายการ
2. Owner กำหนด cost สำหรับ ทองแดงท่อ Candy (เช่น 400 THB/kg ตามราคาทองแดงทั่วไป หรือตามที่ Owner ทราบ)
3. Owner อนุมัติแนวทาง A (Delete + Recreate Draft)
4. หลังได้รับอนุมัติ:
   a. ตรวจ/เพิ่ม DELETE endpoint สำหรับ PhysicalCountSession (status=DRAFT เท่านั้น)
   b. Delete Draft `cmrgli52j0000oslknzwk9gah`
   c. สร้าง Draft ใหม่ด้วย cost ที่ถูกต้อง
   d. Live Preview อีกครั้ง
   e. รอ Owner อนุมัติ Apply

---

## Files Produced

ทั้งหมดอยู่ใน `/home/z/my-project/reconciliation/st19-cost-investigation/`:

1. `st19-cost-investigate.mjs` — Read-only investigation script
2. `st19-cost-investigation.json` — JSON dump ของผล investigation ทั้งหมด
3. `st19-revised-preview.csv` — CSV ของ revised preview (Draft vs Recommended)
4. `FINAL_REPORT.md` — รายงานนี้ (10 ส่วน)

---

## Owner Instruction Compliance

| Instruction | Compliance |
|---|---|
| ทำแบบ Read-only เท่านั้น | ✅ Done (no DB writes) |
| Session ID cmrgli52j0000oslknzwk9gah | ✅ Investigated |
| ห้าม Apply | ✅ NOT performed |
| ห้ามแก้ Draft | ✅ NOT performed |
| ห้ามเขียน StockLot | ✅ NOT performed |
| ดึงต้นทุนจากทุกแหล่ง | ✅ Done (active lots, BuyBills, StockLots, audit log) |
| ไม่ใช้ข้อมูลจาก canceled/reversed/test/invalid | ✅ Done (excluded cancelled bills, only valid records) |
| ตรวจ AvgCost=40 ทองแดงช็อต | ✅ Done (anomaly found — comes from TRANSFER lot) |
| ตรวจ AvgCost=275.86 ทองแดงใหญ่ | ✅ Done (anomaly found — 3 low-cost TRANSFER lots) |
| ตรวจ AvgCost=383.58 ทองแดงเล็ก | ✅ Done (mostly normal — 1 zero-cost SORTING lot) |
| ตรวจสินค้า AvgCost=0 เคยมีประวัติซื้อจริงหรือไม่ | ✅ Done (5/5 had buy history except ทองเหลืองเนื้อแดง + ทองแดงท่อ Candy) |
| ตรวจ lot เก่าที่ depleted ใช้เป็น reference ได้ | ✅ Done (top 3 depleted lots with non-zero cost per product) |
| เสนอ Cost Basis (recommended + source + reason + confidence + alternative) | ✅ Done (Section 2) |
| ห้ามใช้ 0 บาทเป็นต้นทุนโดยอัตโนมัติ | ✅ Done (zero-cost flagged, recommended values non-zero) |
| Revised Preview | ✅ Done (Section 5) |
| เปรียบเทียบ 34,362.97 บาท | ✅ Done (revised = 189,706.10, delta +155,343.13) |
| ตรวจ Apply behavior | ✅ Done (Section 6) |
| ตรวจว่าแก้ averageCost ได้ไหม | ✅ Done (❌ ไม่ได้ — ไม่มี PATCH endpoint) |
| ห้ามแสดง password/token/DATABASE_URL | ✅ None exposed |

---

**รายงานเสร็จสมบูรณ์ — รอ Owner อนุมัติ cost recommendations และแนวทางแก้ Draft**
