# Manual Sorting Records — 08/07/2569

**Task 60**: Enter Manual Sorting/Dismantling Records

## Summary

| Metric | Value |
|---|---:|
| Records validated | 3 |
| Records safe to create | 1 |
| Records needing owner review | 2 |

## Weight Summary

| Record | Type | Room | Source | Source wt (kg) | Output wt (kg) | Loss (kg) | Status |
|---|---|---|---|---:|---:|---:|---|
| 1 | คัดแยก | 21 | เหล็กหนาสั้น | 62.6 | 62.5 | 0.1 | PRODUCT_ISSUE |
| 2 | คัดแยก | 22 | เครื่องจักร | 20.6 | 20.4 | 0.2 | PRODUCT_ISSUE |
| 3 | แกะของ | 24 | ของแกะราคาสูง | 2.1 | 2.1 | 0 | OK |

## Records Needing Owner Review

### Record 1: คัดแยก | Room 21 | Source: เหล็กหนาสั้น

**Issues:**
- Output product "ทองเหลืองหน้าแดง" not found in product master
- Output product "ทองเหลือง" not found in product master
- Output product "ตะกั่วแข่ง" not found in product master
- Output product "สแตนเลส 304" not found in product master
- Output product "อลูมิเนียมแข็ง" not found in product master

### Record 2: คัดแยก | Room 22 | Source: เครื่องจักร

**Issues:**
- Output product "ทองเหลือง" not found in product master
- Output product "สายไฟ" not found in product master
- Output product "สายไฟ" not found in product master
- "สายไฟ" is ambiguous — appears 2 times with different prices. Could be สายไฟไม่ปอก or สายไฟทองแดง or other.

## Product Mapping Issues

- Record 1: "ทองเหลืองหน้าแดง" — Product not found
- Record 1: "ทองเหลือง" — Product not found
- Record 1: "ตะกั่วแข่ง" — Product not found
- Record 1: "สแตนเลส 304" — Product not found
- Record 1: "อลูมิเนียมแข็ง" — Product not found
- Record 1: "เหล็กหนาสั้น" — 
- Record 2: "ทองเหลือง" — Product not found
- Record 2: "สายไฟ" — Product not found
- Record 2: "สายไฟ" — Product not found
- Record 2: "เครื่องจักร" — 

## Typo Checks Performed

| Raw name | Issue | Resolution |
|---|---|---|
| ทองเหลืองหน้าแดง | Possible typo for ทองเหลืองเนื้อแดง | Checked product master |
| ตะกั่วแข่ง | Possible typo for ตะกั่วแข็ง | Checked product master |
| อลูมิเนียมแข็ง | May map to อลูมิเนียมแข็ง (หล่อ/หนา) | Checked product master |
| เครื่องจักร | Source product check | Checked product master |
| สายไฟ | Ambiguous — appears twice with different prices | Needs owner clarification |

## Stock Insufficiency Check

No stock insufficiency issues.

## Next Steps

1. Owner reviews NEED_OWNER_REVIEW.csv
2. Owner clarifies ambiguous products (สายไฟ, ทองเหลืองหน้าแดง, ตะกั่วแข่ง)
3. After approval, safe records will be created via StockTransfer API
4. No records created yet — waiting for owner approval

**Only safe manual sorting records were created. Ambiguous records were not created.**

## Records Created

| Record | Type | Room | Source | Source wt | Created ID | Bill Number | Status |
|---|---|---|---|---:|---|---|---|
| 3 | แกะของ | 24 | ของแกะราคาสูง | 2.1 kg | cmrc3nnjh0001jy04yu8s3cat | TRN-2569-00006 | ✅ CREATED |

## Stock Changes from Record 3

| Product | Change | Weight (kg) |
|---|---|---:|
| ของแกะราคาสูง (source) | Deducted (FIFO) | -2.1 |
| ตะกั่วแข็ง (output) | Added (new StockLot) | +1.9 |
| เหล็กบาง (output) | Added (new StockLot) | +0.2 |

## Records NOT Created (Need Owner Review)

### Record 1: คัดแยก | Room 21 | Source: เหล็กหนาสั้น
**Issues:**
- "ทองเหลืองหน้าแดง" NOT FOUND — likely typo for "ทองเหลืองเนื้อแดง"
- "ทองเหลือง" NOT FOUND — system has "ทองเหลืองหนา" or "ทองเหลืองเนื้อแดง" but not just "ทองเหลือง"
- "ตะกั่วแข่ง" NOT FOUND — likely typo for "ตะกั่วแข็ง"
- "สแตนเลส 304" NOT FOUND — system has "แสตนเลส 304" (spelling difference ส vs แส)
- "อลูมิเนียมแข็ง" NOT FOUND — system has "อลูมิเนียมแข็ง (หล่อ/หนา)" (with suffix)

### Record 2: คัดแยก | Room 22 | Source: เครื่องจักร
**Issues:**
- "ทองเหลือง" NOT FOUND — same as Record 1
- "สายไฟ" NOT FOUND — ambiguous, appears twice with different prices (30 and 50 THB/kg)
- Owner must clarify: which product is "สายไฟ" — สายไฟไม่ปอก, สายไฟทองแดง, or สายไฟอลูมิเนียม?

## Owner Decisions Needed

1. **"ทองเหลืองหน้าแดง"** → Is this "ทองเหลืองเนื้อแดง"? (confirm mapping)
2. **"ทองเหลือง"** → Which product? "ทองเหลืองหนา" or "ทองเหลืองเนื้อแดง"?
3. **"ตะกั่วแข่ง"** → Is this "ตะกั่วแข็ง"? (confirm typo)
4. **"สแตนเลส 304"** → Is this "แสตนเลส 304"? (spelling: ส vs แส)
5. **"อลูมิเนียมแข็ง"** → Is this "อลูมิเนียมแข็ง (หล่อ/หนา)"? (confirm mapping)
6. **"สายไฟ"** (Record 2) → Which product? Two rows with different prices need clarification.

After owner confirms these mappings, Records 1 and 2 can be created.
