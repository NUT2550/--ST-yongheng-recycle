# Debug Report: Missing 08/07/2569 Sorting Records in History Page

**History display checked. No duplicate sorting records were created.**

## 1. Record Search Results

All 3 target records were found in the database. **All 3 exist in the `StockTransfer` table (แกะของ), not the `SortingBill` table (คัดแยก).**

| Bill Number | Exists | Model | Type | ID | Date | Room | Source Product | Source Weight | Output Count | Cancelled |
|---|---|---|---|---|---|---|---|---:|---:|---|
| TRN-2569-00006 | ✅ YES | StockTransfer | แกะของ (StockTransfer) | cmrc3nnjh0001jy04yu8s3cat | 2026-07-08 | 24 | ของแกะราคาสูง | 2.1 | 2 | false |
| TRN-2569-00008 | ✅ YES | StockTransfer | แกะของ (StockTransfer) | cmrd404o80001i8046f99gnjm | 2026-07-08 | 21 | เหล็กหนาสั้น | 62.6 | 12 | false |
| TRN-2569-00009 | ✅ YES | StockTransfer | แกะของ (StockTransfer) | cmrd40ti70013i804ymlbxjur | 2026-07-08 | 22 | เครื่องจักร | 20.6 | 6 | false |

## 2. History Page Tab Architecture

The History page (`src/components/history-page.tsx`) has 4 tabs:

| Tab | Label | API Endpoint | DB Table | Records Shown |
|---|---|---|---|---|
| `sort` | คัดแยก | `GET /api/sorting-bills` | `SortingBill` | Sorting bills only |
| `transfer` | แกะของ | `GET /api/stock-transfers` | `StockTransfer` | Stock transfers only |
| `buy` | รับซื้อ | `GET /api/buy-bills` | `BuyBill` | Purchase bills |
| `sell` | ขาย | `GET /api/sell-bills` | `SellBill` | Sales bills |

**Key finding:** The คัดแยก tab queries `SortingBill` ONLY. The แกะของ tab queries `StockTransfer` ONLY. These are separate tables with separate APIs.

## 3. Why Records Don't Show in คัดแยก Tab

The owner was looking at the **คัดแยก tab**, which displays `SortingBill` records. The latest SortingBills are:

| Bill Number | Date | Room | Source |
|---|---|---|---|
| SORT-2569-00152 | 2026-07-07 | 27 | เหล็กบาง |
| SORT-2569-00151 | 2026-07-06 | 22 | เหล็กบาง |
| SORT-2569-00150 | 2026-07-06 | 23 | เหล็กหนาสั้น |
| SORT-2569-00149 | 2026-07-04 | - | เครื่องจักร |
| SORT-2569-00147 | 2026-07-02 | - | เครื่องจักร |

This matches **exactly** what the owner reported: "Latest visible records show 07/07/2569, 06/07/2569, 04/07/2569, 02/07/2569."

**There are NO SortingBills for 08/07/2569.** The 08/07/2569 records (TRN-2569-00006, 00008, 00009) are all `StockTransfer` records, so they correctly do NOT appear in the คัดแยก tab.

## 4. Records DO Show in แกะของ Tab

The **แกะของ tab** displays `StockTransfer` records. All 3 target records appear on page 1:

| # | Bill Number | Date | Room | Source Product | Source Weight | Items | Status |
|---:|---|---|---|---|---:|---:|---|
| 1 | TRN-2569-00010  | 2026-07-09 | 28 | สายไฟทองแดง | 1.6 | 2 | ACTIVE |
| 2 | TRN-2569-00009 🎯 | 2026-07-08 | 22 | เครื่องจักร | 20.6 | 6 | ACTIVE |
| 3 | TRN-2569-00008 🎯 | 2026-07-08 | 21 | เหล็กหนาสั้น | 62.6 | 12 | ACTIVE |
| 4 | TRN-2569-00006 🎯 | 2026-07-08 | 24 | ของแกะราคาสูง | 2.1 | 2 | ACTIVE |
| 5 | TRN-2569-00005  | 2026-07-08 | 24 | สายไฟทองแดง | 13.7 | 7 | ACTIVE |
| 6 | TRN-2569-00002  | 2026-07-01 | - | สายไฟไม่ปอก | 3.8 | 2 | ACTIVE |

**All 3 target records (🎯) appear on page 1 of the แกะของ tab.** They are NOT missing — they are in the correct tab for their record type.

## 5. Root Cause

**No UI/API bug exists.** The History page is working correctly.

The root cause is a **data classification issue from Task 61**:

- TRN-2569-00008 and TRN-2569-00009 were created via `POST /api/stock-transfers` (StockTransfer = แกะของ)
- The Task 61 worklog incorrectly labeled them as "คัดแยก" (SortingBill)
- They are actually "แกะของ" (StockTransfer) records
- The bill number prefix "TRN-" confirms they are transfers (SortingBills use "SORT-" prefix)

**Evidence:**
- `reconciliation/create-records-1-2.mjs` line 267: `fetch('https://st-yongheng-recycle.vercel.app/api/stock-transfers', { method: 'POST', ...})`
- SortingBills use bill numbers like `SORT-2569-00152`; StockTransfers use `TRN-2569-00006`
- DB confirms: 0 SortingBills and 1 StockTransfer for each target bill number

## 6. Fix Applied (Safe, Non-Breaking)

**Added secondary sort by `createdAt desc`** to both History page APIs:

| File | Change |
|---|---|
| `src/app/api/sorting-bills/route.ts` line 313 | `orderBy: { date: 'desc' }` → `orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]` |
| `src/app/api/stock-transfers/route.ts` line 380 | `orderBy: { date: 'desc' }` → `orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]` |

**Why:** When multiple records share the same date (e.g., 4 records on 2026-07-08), the previous single-column sort produced non-deterministic ordering. The secondary sort by `createdAt desc` ensures the most recently created records appear first within the same date, making the display predictable.

**This change does NOT:**
- Create or modify any records
- Change stock quantities
- Move records between tables
- Affect which records are returned (only their order within same-date groups)

## 7. What Was NOT Done

- ❌ Did NOT recreate records (per task constraint)
- ❌ Did NOT move records from StockTransfer to SortingBill (would require reversing stock + re-applying)
- ❌ Did NOT modify stock quantities
- ❌ Did NOT create duplicate StockTransfers/SortingBills
- ❌ Did NOT modify BuyBills/SellBills

## 8. API Verification

Verified via live API calls (login → GET /api/stock-transfers → GET /api/sorting-bills):

**แกะของ tab (GET /api/stock-transfers?page=1&limit=10&includeCancelled=false):**
- Total: 6 non-cancelled records
- Page 1: 6 records
- Target records found: ✅ TRN-2569-00006, ✅ TRN-2569-00008, ✅ TRN-2569-00009

**คัดแยก tab (GET /api/sorting-bills?page=1&limit=10&includeCancelled=false):**
- Total: 135 non-cancelled records
- Page 1: 10 records
- Target records found: 0 (expected — they are StockTransfers, not SortingBills)
- Latest SortingBill: SORT-2569-00152 dated 2026-07-07

## 9. Invariant Check

| Metric | Value | Expected | Status |
|---|---:|---|---|
| SortingBill count | 144 | unchanged | ✅ PASS |
| StockTransfer count | 10 | unchanged | ✅ PASS |
| BuyBill count | 158 | unchanged | ✅ PASS |
| SellBill count | 18 | unchanged | ✅ PASS |
| Product count | 113 | unchanged | ✅ PASS |
| StockLot count | 1115 | unchanged | ✅ PASS |
| Total stock weight | 552312.3 kg | unchanged | ✅ PASS |
| TRN-2569-00006 duplicates | 1 | 1 (no duplicate) | ✅ PASS |
| TRN-2569-00008 duplicates | 1 | 1 (no duplicate) | ✅ PASS |
| TRN-2569-00009 duplicates | 1 | 1 (no duplicate) | ✅ PASS |

## 10. Confirmation

| Invariant | Status |
|---|---|
| No duplicate records created | ✅ CONFIRMED |
| No stock changed | ✅ CONFIRMED |
| BuyBills unchanged | ✅ CONFIRMED |
| SellBills unchanged | ✅ CONFIRMED |
| Product count unchanged | ✅ CONFIRMED |
| No SortingBills created or modified | ✅ CONFIRMED |
| No StockTransfers created or modified | ✅ CONFIRMED |

## 11. Recommendation for Owner

The 3 records for 08/07/2569 are **not missing** — they are in the **แกะของ tab**, not the คัดแยก tab.

| Bill Number | Tab where it appears | Tab where owner expected it | Match? |
|---|---|---|---|
| TRN-2569-00006 | แกะของ ✅ | แกะของ | ✅ YES |
| TRN-2569-00008 | แกะของ ✅ | คัดแยก | ❌ MISMATCH |
| TRN-2569-00009 | แกะของ ✅ | คัดแยก | ❌ MISMATCH |

**If the owner wants TRN-2569-00008 and TRN-2569-00009 to appear in the คัดแยก tab**, they would need to be recreated as `SortingBill` records. This requires:
1. Cancelling the existing StockTransfer records (restores source stock)
2. Creating new SortingBill records with the same data (deducts source stock via FIFO, produces output stock)
3. This is a **separate task** that modifies stock and should only be done with owner confirmation.

**For now, the owner can see all 3 records by switching to the แกะของ tab** in the History page.

## 12. Record Details

### TRN-2569-00006

- **Exists**: ✅ YES
- **Model/Table**: StockTransfer
- **Type**: แกะของ (StockTransfer)
- **ID**: `cmrc3nnjh0001jy04yu8s3cat`
- **Date**: 2026-07-08T10:00:00.000Z
- **createdAt**: 2026-07-08T13:14:29.741Z
- **Room**: 24
- **Source product**: ของแกะราคาสูง
- **Source weight**: 2.1 kg
- **Output count**: 2
- **isCancelled**: false
- **Outputs**: ตะกั่วแข็ง(1.9kg), เหล็กบาง(0.2kg)

### TRN-2569-00008

- **Exists**: ✅ YES
- **Model/Table**: StockTransfer
- **Type**: แกะของ (StockTransfer)
- **ID**: `cmrd404o80001i8046f99gnjm`
- **Date**: 2026-07-08T10:00:00.000Z
- **createdAt**: 2026-07-09T06:11:57.992Z
- **Room**: 21
- **Source product**: เหล็กหนาสั้น
- **Source weight**: 62.6 kg
- **Output count**: 12
- **isCancelled**: false
- **Outputs**: อลูมิเนียมฉาก(2.2kg), เหล็กหนาสั้น(3.9kg), อลูมิเนียมบาง(0.3kg), ทองแดงใหญ่(0.4kg), ทองเหลืองเนื้อแดง(0.8kg), ทองเหลืองหนา(4.1kg), หม้อน้ำอลูมิเนียม(1.3kg), หม้อน้ำทองแดง(1.2kg), ตะกั่วแข็ง(0.3kg), สแตนเลส 304(4.7kg), อลูมิเนียมแข็ง (หล่อ/หนา)(41.4kg), ขยะ(1.9kg)

### TRN-2569-00009

- **Exists**: ✅ YES
- **Model/Table**: StockTransfer
- **Type**: แกะของ (StockTransfer)
- **ID**: `cmrd40ti70013i804ymlbxjur`
- **Date**: 2026-07-08T10:00:00.000Z
- **createdAt**: 2026-07-09T06:12:30.175Z
- **Room**: 22
- **Source product**: เครื่องจักร
- **Source weight**: 20.6 kg
- **Output count**: 6
- **isCancelled**: false
- **Outputs**: ทองเหลืองหนา(1.9kg), ขยะ(0.6kg), เปลือกสายไฟ(1.3kg), เหล็กบาง(4.1kg), สายไฟทองแดง(3.1kg), สายไฟทองแดง(9.4kg)

---

**History display checked. No duplicate sorting records were created.**
