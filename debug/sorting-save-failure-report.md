# Debug Report: แกะของ / ย้ายสต็อก Save Failure

**Task 49**: Debug Save Failure on แกะของ / ย้ายสต็อก Page
**Status**: DEBUGGING ONLY — No production data modified.

---

## 1. Frontend File/Component Path

- **Component**: `src/components/transfer-page.tsx`
- **Save handler**: `handleSubmit()` at line 189
- **Save button**: line 607, `onClick={handleSubmit}`
- **Button disabled condition** (line 608):
  ```js
  disabled={submitting || lossWeight < 0 || transferSourceWeight <= 0 || transferCartItems.length === 0}
  ```

## 2. API Route Path

- **Route**: `POST /api/stock-transfers`
- **File**: `src/app/api/stock-transfers/route.ts`
- **FIFO deduction function**: `deductStockFIFO()` at line 9
- **Pre-validation**: line 118-134 (source stock availability check)

## 3. Exact Save Payload Expected

```json
{
  "date": "2026-07-07T...",
  "sourceProductId": "cmr7up02q000hmzw7wkn7huiq",
  "sourceWeight": 13.7,
  "sourceWeightExpression": "15.8-1.8-0.3",
  "roomNumber": "24",
  "sourcePricePerKg": 50,
  "laborCost": 559.5,
  "weighedTotal": ...,
  "items": [
    { "productId": "...", "weight": 1.5, "outputPricePerKg": 422, "isWaste": false },
    { "productId": "...", "weight": 1.2, "outputPricePerKg": 368, "isWaste": false },
    { "productId": "...", "weight": 4.5, "outputPricePerKg": 412, "isWaste": false },
    ... (7 items total)
  ]
}
```

## 4. Actual Likely Payload from Screenshot

Same as above — the user filled in all fields correctly:
- Source product: สายไฟทองแดง (stock shows 0.00 kg in UI)
- Source weight: 13.7 kg (from formula 15.8-1.8-0.3)
- 7 output items totaling 13.6 kg
- Loss: 0.1 kg
- Room: 24
- Source price: 50 baht/kg
- Labor: 559.5 baht

## 5. Validation Rules

### Frontend validation (transfer-page.tsx handleSubmit):
1. ✅ Source product selected → passes
2. ✅ Cart items > 0 → passes (7 items)
3. ✅ Source weight > 0 → passes (13.7 kg)
4. ✅ Output total ≤ source weight + 0.01 → passes (13.6 ≤ 13.71)
5. ⚠️ `sourceAvailableWeight > 0 && transferSourceWeight > sourceAvailableWeight` → **SKIPPED** because `sourceAvailableWeight = 0`, so `0 > 0` is false

### Backend validation (stock-transfers/route.ts):
1. ✅ Items not empty → passes
2. ✅ Source weight > 0 → passes
3. ✅ All item weights > 0 → passes
4. ✅ Items total ≤ source weight + 0.01 → passes
5. ❌ **Source stock availability** (line 123): `totalAvailable (0) < sourceWeight (13.7)` → **FAILS**

**The API returns HTTP 400 with error:**
```
สต็อกไม่เพียงพอสำหรับ "สายไฟทองแดง". มี: 0 kg, ต้องการ: 13.7 kg
```

## 6. Product Stock Status for สายไฟทองแดง

| Field | Value |
|---|---|
| Product ID | cmr7up02q000hmzw7wkn7huiq |
| Product name | สายไฟทองแดง |
| Category | ทองแดง |
| Current stock | **0.00 kg** |
| Total StockLots | 0 |
| Active StockLots (remainingWeight > 0) | 0 |

**The UI correctly shows stock: 0.00 kg. The product exists but has no stock at all.**

## 7. StockLot/FIFO Status

- **0 StockLots exist** for สายไฟทองแดง
- FIFO deduction cannot proceed — there are no lots to deduct from
- The `deductStockFIFO()` function (line 9) would find 0 lots, `totalAvailable = 0`, and throw "Insufficient stock"

## 8. Exact Failure Reason

**The save fails because the API rejects the request with HTTP 400:**

```
สต็อกไม่เพียงพอสำหรับ "สายไฟทองแดง". มี: 0 kg, ต้องการ: 13.7 kg
```

The source product `สายไฟทองแดง` has **0 kg stock and 0 StockLots**. The API's FIFO deduction logic requires actual stock to exist before it can deduct.

The frontend does NOT block this because of a logic gap: the stock check at line 208 is:
```js
if (sourceAvailableWeight > 0 && transferSourceWeight > sourceAvailableWeight)
```
When stock = 0, `sourceAvailableWeight = 0`, so `0 > 0` is `false`, and the check is **skipped**. The frontend allows the submit, but the backend correctly rejects it.

## 9. Expected Behavior or Bug?

**This is expected behavior (strict FIFO validation).** The API correctly prevents stock from going negative. The only issue is a **minor frontend UX bug**: the frontend should warn the user BEFORE they click save that the source product has 0 stock, rather than letting them submit and get an error.

## 10. Recommended Fix Options

### Option A: Keep strict FIFO (RECOMMENDED for now)
- **No code change needed** — the API correctly rejects the request
- **Frontend UX improvement**: Change line 208 to also warn when stock = 0:
  ```js
  if (sourceAvailableWeight <= 0) {
    toast.error(`สินค้าต้นทาง "${sourceProductName}" มีสต็อก 0 กก. — ไม่สามารถบันทึกได้`);
    return;
  }
  ```
- **Owner action**: Add stock to สายไฟทองแดง first (via BuyBill or physical count adjustment), then retry the transfer

### Option B: Allow negative source stock (NOT RECOMMENDED)
- Would require API change to skip FIFO deduction when stock = 0
- **Risk**: Stock can become wrong; negative stock is mathematically invalid
- Do NOT implement unless owner explicitly approves

### Option C: Manual sorting from physical count mode (PROPOSED DESIGN)
- New feature: "manual sorting mode" that creates a stock adjustment first, then a sorting/transfer
- Would require new API endpoint or mode flag
- Do NOT implement yet; only propose design

### Option D: Copper/brass reset override (RECOMMENDED for this specific case)
- Since copper/brass restart date is 04/07/2569 and physical count will override, this transfer could be recorded as a physical adjustment instead of normal sorting
- **Recommendation**: Owner should record this as a physical count adjustment, not a sorting/transfer, since the source product has no stock to sort from

## 11. Safest Recommended Next Step

1. **Do NOT patch the code** — the API is working correctly
2. **Inform owner**: The save fails because สายไฟทองแดง has 0 kg stock. The system correctly prevents negative stock.
3. **Owner options**:
   - (a) Add stock to สายไฟทองแดง first (via BuyBill or physical count adjustment), then retry the transfer
   - (b) Record this as a physical count adjustment instead of a sorting/transfer
   - (c) If this is a copper/brass reset scenario, wait until after the physical count is done, then record sorting movements normally

## 12. Whether Code Patch Is Needed

**No code patch is needed for the core issue.** The API correctly validates stock availability.

**Optional UX improvement** (not required): Add a frontend check to warn the user BEFORE submit when source stock = 0, instead of letting the API reject. This would improve user experience but does not change the outcome.

**Patch plan if owner wants the UX fix:**
- File: `src/components/transfer-page.tsx`
- Location: `handleSubmit()` function, after line 207
- Add:
  ```js
  if (sourceAvailableWeight <= 0) {
    toast.error(`สินค้าต้นทางมีสต็อก 0 กก. — กรุณาเพิ่มสต็อกก่อนบันทึกการย้าย`);
    return;
  }
  ```
- Do NOT apply until owner confirms.

---

**No production data was modified.**
