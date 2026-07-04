# Product Name Mapping Report — ยงเฮง มหาชัย รีไซเคิล

> วิเคราะห์ไฟล์ Excel ระบบเดิม (รายการสิ้นต้า.xls) เทียบกับสินค้าในระบบสต็อกใหม่
> วันที่วิเคราะห์: 27/06/2569
> อัปเดตล่าสุด: 27/06/2569 (เพิ่ม Owner Business Rules + Cross-category Prohibition)

---

## สรุปผล (หลัง Reclassify)

| รายการ | จำนวน | ไฟล์ |
|--------|-------|------|
| สินค้าใน Excel ระบบเดิม | 122 | — |
| สินค้าในระบบสต็อกใหม่ | 62 | — |
| **Approved Candidates (≥75%, same category)** | **48** | `data/product-alias-approved-candidates.csv` |
| **Need Review (กำกวม/cross-category)** | **14** | `data/product-alias-need-review.csv` |
| **No Match (ไม่มีในระบบใหม่)** | **60** | `data/product-no-match.csv` |

> **หมายเหตุ:** จำนวน Approved ยังคง 48 รายการ เพราะรายการที่ owner ชี้แจง (0201, 0205, 0804, 0711) อยู่ใน NEED_REVIEW อยู่แล้ว แต่ตอนนี้มีการระบุ `ownerRuleApplied = CROSS_CATEGORY_MISMATCH` ชัดเจน

---

## Owner Business Rules (เพิ่มใหม่)

กฎที่ owner ชี้แจงเพื่อป้องกันการ map ผิดหมวดวัสดุ:

### Rule 1: กระป๋องเหล็ก vs อลูมิเนียมกระป๋อง
- **"กระป๋อง, ปี๊บ"** = กระป๋องเหล็ก / ปี๊บเหล็ก → หมวด **เหล็ก**
- **"อลูมิเนียมกระป๋อง"** = สินค้าอลูมิเนียม → หมวด **อลูมีเนียม**
- ห้าม map สองตัวนี้เข้าด้วยกัน

### Rule 2: อลูมิเนียมหล่อ vs เหล็กหล่อ
- **"อลูมิเนียมหล่อ"** = ร้านเรียก "เนียมแข็ง" → หมวด **อลูมีเนียม**
- **"เหล็กหล่อ 40/80"** → หมวด **เหล็ก**
- ห้าม map "อลูมิเนียมหล่อ" ไป "เหล็กหล่อ"

### Rule 3: สายไฟทองแดง vs สายไฟอลูมิเนียม
- **"สายไฟไม่ปอก"** = สายไฟทองแดงที่ยังไม่ปอก → หมวด **ทองแดง**
- **"สายไฟอลูมิเนียมไม่ปอก"** = สายไฟอลูมิเนียม → หมวด **อลูมีเนียม**
- ห้าม map สองตัวนี้เข้าด้วยกัน

### Rule 4: แผงวงจร
- **"แผงวงจร/พวงแผงวงจร"** = PCB → หมวด **อิเล็กทรอนิกส์**
- ห้าม map ไป "อลูมีเนียมสายไฟ" หรือสินค้าอื่นที่ไม่เกี่ยวข้อง

### Rule ทั่วไป
- ถ้าคนละหมวดวัสดุ → ถือว่าเป็นคนละสินค้า
- ห้าม auto-match ข้ามหมวดวัสดุ
- ห้ามใช้ fuzzy match ข้ามหมวด
- ถ้าไม่แน่ใจ → status = NEED_REVIEW
- ห้ามสร้าง alias ที่อาจทำให้ stock ผิดหมวด

---

## Cross-Category Auto-match Prohibited

### Policy
**Material category mismatch = reject auto-match**

ระบบต้องแยกหมวดวัสดุออกจากกันอย่างชัดเจน:
- เหล็ก (Steel)
- อลูมิเนียม (Aluminum)
- ทองแดง (Copper)
- ทองเหลือง (Brass)
- สแตนเลส (Stainless)
- ตะกั่ว (Lead)
- อิเล็กทรอนิกส์/แบตเตอรี่ (Electronics/Battery)
- อื่นๆ (Other)

**Owner approval required for every cross-category suggestion.**

### Implementation Logic (สำหรับ Excel import ในอนาคต)
```
1. กำหนด oldCategory จาก oldCode prefix (01=เหล็ก, 02=อลูมิเนียม, ...)
2. กำหนด newCategory จาก product ในระบบใหม่
3. ถ้า oldCategory != newCategory:
   - ห้าม auto-approve
   - ตั้ง status = NEED_REVIEW
   - ระบุ reason = "CROSS_CATEGORY_MISMATCH"
4. อนุญาต auto-approve เฉพาะ same category + confidence ≥ 75%
```

---

## รายการที่ถูกแก้สถานะเพราะ Cross-Category Mismatch

รายการเหล่านี้อยู่ใน NEED_REVIEW พร้อม `ownerRuleApplied = CROSS_CATEGORY_MISMATCH`:

| oldCode | oldName | oldCategory | suggestedProduct | newCategory | ownerRule | risk |
|---------|---------|-------------|------------------|-------------|-----------|------|
| 0201 | อลูมิเนียมกระป๋อง | อลูมิเนียม | กระป๋อง , ปี๊บ | เหล็ก | Rule 1 | HIGH |
| 0205 | อลูมิเนียมหล่อ | อลูมิเนียม | เหล็กหล่อ 40 | เหล็ก | Rule 2 | HIGH |
| 0804 | สายไฟไม่ปอก | ทองแดง (per owner) | อลูมีเนียมสายไฟ | อลูมีเนียม | Rule 3 | HIGH |
| 0711 | พวงแผงวงจรติดสายไฟ | อิเล็กทรอนิกส์ | อลูมีเนียมสายไฟ | อลูมีเนียม | Rule 4 | HIGH |
| 0200 | เหล็กสลิง,สแตน | อลูมิเนียม (code 02) | สลิง,สแตน 1.5 ม. | เหล็ก | Cross-category | MEDIUM |
| 0806 | เปลือกสายไฟ | อื่นๆ (code 08) | อลูมีเนียมสายไฟ | อลูมีเนียม | Cross-category | HIGH |

---

## ตัวอย่าง Approved Mapping (48 รายการ — same category only)

| oldCode | oldName | → suggestedProductName | oldCategory | newCategory | matchType | confidence |
|---------|---------|----------------------|-------------|-------------|-----------|------------|
| 0101 | เหล็กหนาพิเศษ | เหล็กหนาพิเศษ | เหล็ก | เหล็ก | EXACT | 100% |
| 0107 | กระป๋อง,ปี๊บ | กระป๋อง , ปี๊บ | เหล็ก | เหล็ก | EXACT | 100% |
| 0203 | อลูมิเนียมสายไฟ | อลูมีเนียมสายไฟ | อลูมิเนียม | อลูมีเนียม | PREFIX_MATCH | 75% |
| 0303 | ทองแดงใหญ่ | ทองแดงใหญ่ | ทองแดง | ทองแดง | EXACT | 100% |
| 0504 | แสตนเลส 304 (ยาว) | แสตนเลส 304 ยาวเกิน1เมตร | สแตนเลส | สแตนเลส | CONTAINS | 85% |
| 0801 | มอเตอร์ | มอเตอร์(ตัวเล็ก) | อื่นๆ | อื่นๆ | CONTAINS | 85% |

> ไฟล์เต็ม: `data/product-alias-approved-candidates.csv`

---

## รายการ Need Review (14 รายการ)

### Cross-Category Mismatch (6 รายการ — HIGH risk)

| oldCode | oldName | reason | recommendation |
|---------|---------|--------|----------------|
| 0201 | อลูมิเนียมกระป๋อง | alum→steel | CREATE_NEW_PRODUCT |
| 0205 | อลูมิเนียมหล่อ | alum→steel | MAP_TO ""เนียมแข็ง"" or CREATE_NEW |
| 0804 | สายไฟไม่ปอก | copper→alum | CREATE_NEW_PRODUCT |
| 0711 | พวงแผงวงจร | electronics→alum | CREATE_NEW_PRODUCT |
| 0200 | เหล็กสลิง,สแตน | code 02→steel | REVIEW material |
| 0806 | เปลือกสายไฟ | shell→wire | CREATE_NEW or IGNORE |

### Same-Category but Ambiguous (8 รายการ — LOW-MEDIUM risk)

| oldCode | oldName | reason | risk |
|---------|---------|--------|------|
| 0114 | เหล็กหล่อชิ้นเล็ก | size: ""ชิ้นเล็ก"" vs ""40"" | MEDIUM |
| 0115 | เหล็กหล่อ (ชิ้นใหญ่) | size: ""ชิ้นใหญ่"" vs ""80"" | MEDIUM |
| 0207 | อลูมิเนียมกะทะไฟฟ้า | type: ""กะทะไฟฟ้า"" vs ""ตูดกะทะไฟฟ้าล้วน"" | MEDIUM |
| 0208 | กระทะดำ | material uncertain | MEDIUM |
| 0209 | อลูมิเนียมกะทะ | type: ""กะทะ"" vs ""ตูดกะทะ"" | MEDIUM |
| 0221 | อลูมิเนียมอัลลอยด์ | spelling: ""อัลลอยด์"" vs ""อัลลอย"" | LOW |
| 0228 | สายไฟอลูมิเนียม(ไม่ปอก) | type: ""ไม่ปอก"" vs ""สายไฟ"" | LOW-MEDIUM |
| 0233 | กระป๋องสเปรย์ | spelling: ""กระป๋อง"" vs ""ป๋อง"" | LOW |

> ไฟล์เต็ม: `data/product-alias-need-review.csv`

---

## ไม่มีสินค้าตรง (NO_MATCH — 60 รายการ)

### จำแนกตามคำแนะนำ:

| คำแนะนำ | จำนวน | ตัวอย่าง |
|---------|-------|---------|
| CREATE_NEW_PRODUCT | 44 | เหล็กเส้น 5/6/3-4 หุน, ขี้กลึงเหล็ก, แบตเตอรี่ขาว/ดำ, แผงวงจรเขียว, พลาสติกรวม |
| MAP_TO_EXISTING | 7 | อลูมิเนียมล้อแม็ค→ล้อแม๊กซ์, อลูมิเนียมบาง→เนียมบาง, อลูมิเนียมฉาก→ฉาก |
| IGNORE (ไม่ใช่สินค้า) | 9 | ขยะ, สูญเสีย, เบิกใช้งาน, ค่าตัดเหล็ก, ชั่งรถ, กระสอบขาด |

### สินค้าใหม่ที่ควรสร้าง (เรียงตามความสำคัญ):

1. **แบตเตอรี่** (ขาว/ดำ/เล็ก/มอไซต์) — 4 รายการ ต้องสร้างหมวดใหม่
2. **แผงวงจร/PCB** (เขียว, ติดสายไฟ) — 2 รายการ ต้องสร้างหมวดใหม่
3. **เหล็กเส้น** (5/6/3-4 หุน, 1 นิ้ว) — 4 รายการ หมวดเหล็ก
4. **ขี้กลึง** (เหล็ก, อลูมิเนียม, สแตนเลส304) — 3 รายการ
5. **อลูมิเนียมหล่อ (เนียมแข็ง)** — อาจมีอยู่แล้วในระบบใหม่ ต้องตรวจ
6. **สินค้า contaminated** (ติดเหล็ก) — ทองแดง/ทองเหลือง/สแตนเลส/อลูมิเนียม — 4 รายการ
7. **พลาสติกรวม** — 1 รายการ ต้องสร้างหมวดใหม่
8. **น้ำมันเก่า** — 1 รายการ ต้องสร้างหมวดใหม่

> ไฟล์เต็ม: `data/product-no-match.csv`

---

## ข้อเสนอ Implementation (ไม่เปลี่ยนแปลงจากเดิม)

### Option A: เพิ่ม `ProductAlias` ใน database
```prisma
model ProductAlias {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  alias     String   @unique  // ชื่อเก่าจากระบบเดิม
  source    String   @default("excel") // excel, manual, etc.
  createdAt DateTime @default(now())
}
```

**แนะนำ Option A** — แต่ต้องอนุมัติ migration ก่อน

### Excel Import Logic (อัปเดตด้วย Cross-Category Check)
```
function matchProduct(oldName, oldCode):
  1. หา candidate จาก alias table (exact/contains/prefix)
  2. กำหนด oldCategory จาก oldCode prefix
  3. กำหนด newCategory จาก matched product
  4. ถ้า oldCategory != newCategory:
     → return NEED_REVIEW (cross-category mismatch)
  5. ถ้า confidence < 75%:
     → return NEED_REVIEW
  6. ถ้า same category + confidence >= 75%:
     → return MATCHED (auto-approve candidate)
  7. ถ้าไม่มี candidate:
     → return NO_MATCH
```

---

## คำแนะนำขั้นต่อไป

1. **Owner ตรวจ 3 ไฟล์ CSV:**
   - `data/product-alias-approved-candidates.csv` — 48 รายการ ตั้ง ownerDecision = APPROVE/REJECT
   - `data/product-alias-need-review.csv` — 14 รายการ ตั้ง ownerDecision + ระบุ correctProductName
   - `data/product-no-match.csv` — 60 รายการ ตั้ง ownerDecision + createNewProduct/mapToExistingProduct

2. **ยืนยัน Cross-Category 6 รายการ** — โดยเฉพาะ 0201, 0205, 0804, 0711 ที่ owner ชี้แจงชัด

3. **ตัดสินใจสินค้าใหม่ 44 รายการ** — สร้างสินค้าใหม่หรือไม่? โดยเฉพาะแบตเตอรี่/แผงวงจร ที่ต้องสร้างหมวดใหม่

4. **อนุมัติ migration** — หลัง owner ตรวจ mapping แล้ว จึงสร้าง ProductAlias table

5. **อัปเดต Excel import** — เพิ่ม alias lookup + cross-category check ใน matchProduct()

---

*ไฟล์ที่เกี่ยวข้อง:*
- `data/product-alias-proposal.csv` — ไฟล์ต้นฉบับ (122 รายการ)
- `data/product-alias-approved-candidates.csv` — 48 รายการที่มั่นใจ
- `data/product-alias-need-review.csv` — 14 รายการกำกวม
- `data/product-no-match.csv` — 60 รายการไม่มีสินค้าตรง
