# Feature Inventory — ยงเฮง มหาชัย รีไซเคิล

> ตารางรวมทุก feature ของระบบ — สถานะปัจจุบัน + การประเมิน rebuild
> วันที่: 27/06/2569
> Source: codebase ปัจจุบัน + worklog

---

## Status Legend

| Status | ความหมาย |
|--------|---------|
| `EXISTS_NOW` | มีใน codebase ปัจจุบัน + ใช้งานได้ |
| `MISSING_NOW` | ไม่มีใน codebase ปัจจุบัน (เคยมีแต่หายไป หรือยังไม่เคยทำ) |
| `PARTIAL` | มีบางส่วน แต่ใช้งานไม่ครบ |
| `PLANNED` | วางแผนไว้ แต่ยังไม่เริ่มทำ |

## Rebuild Priority

| Priority | ความหมาย |
|----------|---------|
| `P0` | ต้องทำก่อนใช้งานจริง |
| `P1` | ควรทำต่อ |
| `P2` | ทำทีหลังได้ |

---

## 1. Authentication & User Management

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Login (JWT) | ✅ EXISTS_NOW | `src/app/api/auth/login/route.ts`, `src/lib/auth.ts` (jose + bcrypt) | POST /api/auth/login | สำคัญมาก | — | Login ด้วย 01 ได้, password ผิด error |
| Logout | ✅ EXISTS_NOW | `src/app/api/auth/logout/route.ts` | POST /api/auth/logout | สำคัญมาก | — | Token หายจาก localStorage |
| Token verification | ✅ EXISTS_NOW | `src/lib/auth.ts` `verifyToken()` | GET /api/auth/me | สำคัญมาก | — | /me คืน user info |
| Token in localStorage | ✅ EXISTS_NOW | `src/lib/auth-constants.ts` `TOKEN_STORAGE_KEY` | client-side | สำคัญมาก | — | Reload page แล้ว session ยังอยู่ |
| Authorization header | ✅ EXISTS_NOW | `src/lib/api.ts` `fetchJSON()` | ทุก API call | สำคัญมาก | — | ทุก API ต้องได้ 401 ถ้าไม่มี token |
| User 01 (admin) | ⚠️ PARTIAL | `prisma/create-user-01.ts` creates as `staff` | seed.ts | สำคัญมาก | P1 | ต้อง promote เป็น admin ใน production DB |
| User 04 (staff) | ❌ MISSING_NOW | ไม่มี script สร้าง user 04 | — | สำคัญมาก | P1 | สร้างผ่านหน้า Users หรือ script ใหม่ |
| User admin (deactivated) | ⚠️ PARTIAL | seed.ts สร้าง admin active, worklog Task 18 บอกว่า deactivate แล้วใน production | — | ปานกลาง | P2 | ตรวจใน DB ว่า isActive=false |
| Show/hide password | ✅ EXISTS_NOW | `src/components/login-page.tsx` (Eye/EyeOff icons) | login page | ปานกลาง | — | คลิก Eye → แสดงรหัส |
| RBAC (admin vs staff) | ✅ EXISTS_NOW | `src/lib/auth.ts` role check, `src/components/users-page.tsx` admin only | ทุก route | สำคัญมาก | — | staff หน้า Users ไม่ได้ |

---

## 2. Buy Bill

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Create BuyBill | ✅ EXISTS_NOW | `src/app/api/buy-bills/route.ts` POST | POST /api/buy-bills | สำคัญมาก | — | สร้าง bill สำเร็จ |
| Add StockLot (BUY) | ✅ EXISTS_NOW | `src/app/api/buy-bills/route.ts` line ~53 | POST /api/buy-bills | สำคัญมาก | — | Stock เพิ่มถูกต้อง |
| Buy cart (Zustand) | ✅ EXISTS_NOW | `src/lib/store.ts` `buyCartItems` | buy-page.tsx | สำคัญมาก | — | หลายรายการใน cart |
| Buy billNumber | ❌ MISSING_NOW | schema.prisma ไม่มี `billNumber` field | — | สำคัญมาก | P0 | สร้าง bill แล้วได้ BUY-2569-XXXXX |
| Buy isCancelled | ❌ MISSING_NOW | schema.prisma ไม่มี `isCancelled` | — | สำคัญมาก | P0 | Cancel bill → isCancelled=true |
| Buy Cancel route | ❌ MISSING_NOW | ไม่มี `src/app/api/buy-bills/[id]/route.ts` | DELETE /api/buy-bills/{id} | สำคัญมาก | P0 | Cancel → stock restore |
| Buy AuditLog | ❌ MISSING_NOW | schema.prisma ไม่มี `AuditLog` model | — | สำคัญมาก | P0 | CREATE + CANCEL entries |
| Buy weightExpression | ❌ MISSING_NOW | schema.prisma BuyBillItem ไม่มี `weightExpression` | — | ปานกลาง | P0 (หลัง migrate) | กรอก 860-3 → เก็บ expression |
| Buy credit (PAYABLE) | ✅ EXISTS_NOW | `src/app/api/buy-bills/route.ts` isCredit block | POST /api/buy-bills | สำคัญมาก | — | ซื้อเชื่อ → สร้าง CreditEntry |
| Buy Excel import | ❌ MISSING_NOW | ไม่มี `src/app/api/excel/` route | — | สำคัญมาก | P1 | Import .xls → cart |

---

## 3. Sell Bill

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Create SellBill | ✅ EXISTS_NOW | `src/app/api/sell-bills/route.ts` POST | POST /api/sell-bills | สำคัญมาก | — | สร้าง bill สำเร็จ |
| FIFO stock deduction | ✅ EXISTS_NOW | `src/app/api/sell-bills/route.ts` `deductStockFIFO()` | POST /api/sell-bills | สำคัญมาก | — | ขาย → stock ลด FIFO |
| FIFO cost calculation | ✅ EXISTS_NOW | `deductStockFIFO()` returns `costPerKg`, `totalCost` | POST /api/sell-bills | สำคัญมาก | — | costPerKg = weighted avg |
| Stock pre-validation | ✅ EXISTS_NOW | `src/app/api/sell-bills/route.ts` line ~87 | POST /api/sell-bills | สำคัญมาก | — | ขายเกิน stock → error |
| Sell cart (Zustand) | ✅ EXISTS_NOW | `src/lib/store.ts` `sellCartItems` | sell-page.tsx | สำคัญมาก | — | หลายรายการใน cart |
| Sell billNumber | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | SELL-2569-XXXXX |
| Sell isCancelled | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | Cancel → isCancelled=true |
| Sell Cancel route | ❌ MISSING_NOW | ไม่มี [id]/route.ts | DELETE /api/sell-bills/{id} | สำคัญมาก | P0 | Cancel → stock restore + ลบ credit |
| Sell AuditLog | ❌ MISSING_NOW | schema.prisma ไม่มี AuditLog | — | สำคัญมาก | P0 | CREATE + CANCEL entries |
| Sell weightExpression | ❌ MISSING_NOW | schema.prisma SellBillItem ไม่มี | — | ปานกลาง | P0 (หลัง migrate) | กรอก 1000-15-2 → เก็บ |
| Sell credit (RECEIVABLE) | ✅ EXISTS_NOW | isCredit block | POST /api/sell-bills | สำคัญมาก | — | ขายเชื่อ → CreditEntry |
| Sell customer link | ✅ EXISTS_NOW | schema.prisma SellBill.customerId | POST /api/sell-bills | สำคัญมาก | — | ผูก customer กับ bill |
| Profit calculation | ✅ EXISTS_NOW | `totalAmount - totalCost` | sell-page, history-page | สำคัญมาก | — | กำไรแสดงถูก |

---

## 4. Sorting Bill

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Create SortingBill | ✅ EXISTS_NOW | `src/app/api/sorting-bills/route.ts` POST | POST /api/sorting-bills | สำคัญมาก | — | สร้าง bill สำเร็จ |
| FIFO source deduction | ✅ EXISTS_NOW | `deductStockFIFO(sourceProductId, ...)` | POST /api/sorting-bills | สำคัญมาก | — | Source stock ลด FIFO |
| Output stock add | ✅ EXISTS_NOW | `tx.stockLot.create()` for non-waste items | POST /api/sorting-bills | สำคัญมาก | — | Output items เพิ่ม stock |
| lossWeight calculation | ✅ EXISTS_NOW | `sourceWeight - itemsTotalWeight` | POST /api/sorting-bills | สำคัญมาก | — | lossWeight ถูกต้อง |
| lossCost calculation | ✅ EXISTS_NOW | `lossWeight × sourceCostPerKg` | POST /api/sorting-bills | สำคัญมาก | — | lossCost ถูก |
| Waste item support | ✅ EXISTS_NOW | `isWaste: true` items skipped from stock | POST /api/sorting-bills | สำคัญมาก | — | Waste item ไม่สร้าง stock |
| Bonus calculation | ✅ EXISTS_NOW | `(sortedPrice - sourcePrice) × weight × 10%` | sort-page.tsx | สำคัญมาก | — | Bonus คำนวณถูก |
| Sort cart (Zustand) | ✅ EXISTS_NOW | `src/lib/store.ts` `sortCartItems` | sort-page.tsx | สำคัญมาก | — | หลายรายการใน cart |
| Sort billNumber | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | SORT-2569-XXXXX |
| Sort isCancelled | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | Cancel → isCancelled=true |
| Sort Cancel route | ❌ MISSING_NOW | ไม่มี [id]/route.ts | DELETE /api/sorting-bills/{id} | สำคัญมาก | P0 | Cancel → source restore (output left untouched by design) |
| Sort AuditLog | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | CREATE + CANCEL entries |
| Sort sourceWeightExpression | ❌ MISSING_NOW | schema.prisma SortingBill ไม่มี | — | ปานกลาง | P0 (หลัง migrate) | กรอก 68.4-0.2 → เก็บ |
| Sort weighedTotalExpression | ❌ MISSING_NOW | schema.prisma ไม่มี | — | ปานกลาง | P0 (หลัง migrate) | กรอก 68.4-0.2 → เก็บ |
| Sort item weightExpression | ❌ MISSING_NOW | schema.prisma SortingBillItem ไม่มี | — | ปานกลาง | P0 (หลัง migrate) | กรอก 55-5 → เก็บ |
| Source product filter (STEEL only) | ⚠️ PARTIAL | `sort-page.tsx` filters `category.type === 'STEEL'` | sort-page.tsx | ปานกลาง | P2 | ถ้า owner ต้องการทุกหมวด → ลบ filter |

---

## 5. Stock Management

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| StockLot model | ✅ EXISTS_NOW | `prisma/schema.prisma` | — | สำคัญมาก | — | — |
| Stock page (group by category) | ✅ EXISTS_NOW | `src/components/stock-page.tsx` | GET /api/stock | สำคัญมาก | — | ดูสต็อกแยกหมวด |
| Stock lots detail | ✅ EXISTS_NOW | stock-page.tsx แสดง lots | GET /api/stock | สำคัญมาก | — | ดูแต่ละ lot + cost |
| Avg cost per kg | ✅ EXISTS_NOW | stock calculation | GET /api/stock | สำคัญมาก | — | avg cost ถูก |
| Stock restore on cancel Buy | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel Buy → stock คืน |
| Stock restore on cancel Sell | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel Sell → stock คืน |
| Stock restore on cancel Sort (source only) | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel Sort → source คืน, output left untouched |

---

## 6. History & Audit

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| History page (3 tabs) | ✅ EXISTS_NOW | `src/components/history-page.tsx` | GET /api/{type}-bills | สำคัญมาก | — | สลับ tab ได้ |
| History pagination | ✅ EXISTS_NOW | history-page.tsx PAGE_SIZE=10 | GET /api/{type}-bills?page=N | สำคัญมาก | — | หน้าถัดไปทำงาน |
| History expand bill | ✅ EXISTS_NOW | Collapsible component | — | สำคัญมาก | — | คลิก → แสดง items |
| History billNumber display | ❌ MISSING_NOW | ไม่มี billNumber field | — | สำคัญมาก | P0 | แสดง BUY-2569-XXXXX |
| History cancel button | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | ปุ่ม "ยกเลิก" ทำงาน |
| History formula display | ❌ MISSING_NOW | ไม่มี weightExpression | — | ปานกลาง | P0 (หลัง migrate) | แสดง "857 กก." + "จาก 860-3" |
| AuditLog model | ❌ MISSING_NOW | schema.prisma ไม่มี | — | สำคัญมาก | P0 | — |
| AuditLog CREATE entry | ❌ MISSING_NOW | ไม่มี writeAuditLog helper | — | สำคัญมาก | P0 | สร้าง bill → audit entry |
| AuditLog CANCEL entry | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel bill → audit entry |
| AuditLog itemFormulas[] | ❌ MISSING_NOW | ไม่มี weightExpression | — | ปานกลาง | P0 (หลัง migrate) | details มี itemFormulas |

---

## 7. Dashboard

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Dashboard page | ✅ EXISTS_NOW | `src/components/dashboard-page.tsx` | GET /api/dashboard | สำคัญมาก | — | หน้าโหลดสำเร็จ |
| Today buy/sell amount | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | สำคัญมาก | — | ยอดวันนี้ถูก |
| Today buy/sell weight | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | สำคัญมาก | — | น้ำหนักวันนี้ถูก |
| Total stock weight/cost | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | สำคัญมาก | — | สต็อกรวมถูก |
| Recent bills (5 each) | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | สำคัญมาก | — | แสดง 5 ล่าสุด |
| Category summary | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | สำคัญมาก | — | แยกหมวดถูก |
| Product details | ✅ EXISTS_NOW | dashboard route | GET /api/dashboard | ปานกลาง | — | แยกสินค้าถูก |

---

## 8. Product & Category Management

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Product CRUD | ✅ EXISTS_NOW | `src/app/api/products/` + `[id]/` | GET/POST/PATCH/DELETE | สำคัญมาก | — | สร้าง/แก้/ลบ ได้ |
| Product list page | ✅ EXISTS_NOW | `src/components/products-page.tsx` | — | สำคัญมาก | — | หน้าโหลด |
| 7 categories seeded | ✅ EXISTS_NOW | `prisma/seed.ts` | — | สำคัญมาก | — | มี 7 หมวด |
| 56 products seeded | ✅ EXISTS_NOW | `prisma/seed.ts` | — | สำคัญมาก | — | มี 56 สินค้า |
| Product combobox (searchable) | ✅ EXISTS_NOW | `src/components/ui/product-combobox.tsx` | buy/sell/sort pages | สำคัญมาก | — | พิมพ์ค้นหาได้ |
| Product grouped by category | ✅ EXISTS_NOW | combobox groups | buy/sell/sort pages | สำคัญมาก | — | แยกหมวดใน dropdown |
| Product Alias Mapping | ❌ MISSING_NOW | ไม่มี `data/product-alias-*.csv` | — | ปานกลาง | P1 | Map สินค้าเดิม → ใหม่ |
| ProductAlias table | ❌ MISSING_NOW | schema.prisma ไม่มี | — | ปานกลาง | P1 | (ถ้าต้องการ auto-match) |

---

## 9. Customer Management

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Customer CRUD | ✅ EXISTS_NOW | `src/app/api/customers/` + `[id]/` | GET/POST/PATCH/DELETE | สำคัญมาก | — | สร้าง/แก้/ลบ ได้ |
| Customer create dialog | ✅ EXISTS_NOW | sell-page.tsx Dialog | — | สำคัญมาก | — | ปุ่ม UserPlus → dialog |
| Customer link to SellBill | ✅ EXISTS_NOW | schema.prisma SellBill.customerId | — | สำคัญมาก | — | ผูก customer ได้ |
| Default customer "ลูกค้าทั่วไป" | ✅ EXISTS_NOW | seed.ts | — | ปานกลาง | — | มี default customer |

---

## 10. Credit Management

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| CreditEntry model | ✅ EXISTS_NOW | schema.prisma | — | สำคัญมาก | — | — |
| Credit page | ✅ EXISTS_NOW | `src/components/credit-page.tsx` | GET /api/credit | สำคัญมาก | — | ดูค้างรับ/จ่าย |
| Credit payment | ✅ EXISTS_NOW | `src/app/api/credit/[id]/pay/route.ts` | POST /api/credit/{id}/pay | สำคัญมาก | — | ชำระเครดิตได้ |
| Auto-create PAYABLE (Buy isCredit) | ✅ EXISTS_NOW | buy-bills route | POST /api/buy-bills | สำคัญมาก | — | ซื้อเชื่อ → PAYABLE |
| Auto-create RECEIVABLE (Sell isCredit) | ✅ EXISTS_NOW | sell-bills route | POST /api/sell-bills | สำคัญมาก | — | ขายเชื่อ → RECEIVABLE |
| isSettled auto-update | ✅ EXISTS_NOW | credit pay route | POST /api/credit/{id}/pay | สำคัญมาก | — | จ่ายครบ → isSettled=true |
| Credit delete on cancel | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel bill → ลบ credit |

---

## 11. Employee & Bonus

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Employee CRUD | ✅ EXISTS_NOW | `src/app/api/employees/` + `[id]/` | GET/POST/PATCH/DELETE | สำคัญมาก | — | สร้าง/แก้/ลบ ได้ |
| Employee hireDate | ✅ EXISTS_NOW | schema.prisma Employee.hireDate | — | สำคัญมาก | — | ใช้คำนวณ monthsWorked |
| SortingBonus model | ✅ EXISTS_NOW | schema.prisma | — | สำคัญมาก | — | — |
| Bonus CRUD | ✅ EXISTS_NOW | `src/app/api/bonuses/` + `[id]/` | GET/POST/PATCH/DELETE | สำคัญมาก | — | สร้าง/แก้/ลบ ได้ |
| Bonus page (editable months) | ✅ EXISTS_NOW | `src/components/bonus-page.tsx` | — | สำคัญมาก | — | แก้ monthsWorked ได้ |
| Bonus calculation API | ✅ EXISTS_NOW | `src/app/api/bonus-calculation/route.ts` | GET /api/bonus-calculation | สำคัญมาก | — | คำนวณรายปี |
| Bonus mark as paid | ✅ EXISTS_NOW | bonuses PATCH route | PATCH /api/bonuses/{id} | สำคัญมาก | — | isPaid=true + paidDate |
| Bonus delete on Sort cancel | ❌ MISSING_NOW | ไม่มี cancel route | — | สำคัญมาก | P0 | Cancel Sort → ลบ bonus |

---

## 12. Weight Formula

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Safe math parser | ✅ EXISTS_NOW | `src/lib/safe-math.ts` (recursive descent) | — | สำคัญมาก | — | ทดสอบ 860-3, (1000-10)/2 |
| parseWeightExpression | ✅ EXISTS_NOW | safe-math.ts | buy/sell/sort pages | สำคัญมาก | — | คืน {expression, value, isFormula} |
| Live preview (= 857 กก.) | ❌ MISSING_NOW | buy/sell/sort ไม่มี previewWeightValue call | — | ปานกลาง | P0 (หลัง migrate) | พิมพ์ 860-3 → แสดง = 857 |
| Keep expression in input | ✅ EXISTS_NOW | onKeyDown ไม่ setWeight(value) | buy/sell/sort | สำคัญมาก | — | Enter → input ยังเป็น 860-3 |
| weightExpression storage | ❌ MISSING_NOW | schema.prisma ไม่มี field | — | ปานกลาง | P0 (หลัง migrate) | DB เก็บ "860-3" |
| Cart formula display | ❌ MISSING_NOW | buy/sell/sort cart ไม่มี formulaHint | — | ปานกลาง | P0 (หลัง migrate) | Cart แสดง "จาก 860-3" |
| History formula display | ❌ MISSING_NOW | history-page ไม่มี formulaHint | — | ปานกลาง | P0 (หลัง migrate) | History แสดง formula |
| AuditLog itemFormulas[] | ❌ MISSING_NOW | ไม่มี AuditLog + weightExpression | — | ปานกลาง | P0 (หลัง migrate) | Audit details มี itemFormulas |
| Error handling (860-, abc, 10/0) | ✅ EXISTS_NOW | safe-math.ts | — | สำคัญมาก | — | แสดง error message |

---

## 13. Excel Import

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Excel parse API | ❌ MISSING_NOW | ไม่มี `src/app/api/excel/` | — | สำคัญมาก | P1 | POST /api/excel/parse |
| Excel import dialog | ❌ MISSING_NOW | ไม่มี `src/components/excel-import-dialog.tsx` | — | สำคัญมาก | P1 | Dialog แสดง preview |
| TIS-620 encoding | ❌ MISSING_NOW | ไม่มี code | — | สำคัญมาก | P1 | อ่านไฟล์เก่า .xls ได้ |
| Excel import button (Buy) | ❌ MISSING_NOW | buy-page ไม่มี ExcelImportDialog | — | สำคัญมาก | P1 | ปุ่ม import แสดง |
| Auto-match product | ❌ MISSING_NOW | ไม่มี code | — | ปานกลาง | P1 | Match สินค้าจากชื่อ |
| Cross-category prohibition | ❌ MISSING_NOW | ไม่มี code | — | สำคัญมาก | P1 | ห้าม match ข้ามหมวด |

---

## 14. UI/UX

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Tailwind CSS 4 | ✅ EXISTS_NOW | package.json | — | สำคัญมาก | — | — |
| shadcn/ui components | ✅ EXISTS_NOW | `src/components/ui/` | — | สำคัญมาก | — | — |
| Responsive design | ✅ EXISTS_NOW | grid responsive classes | ทุก page | สำคัญมาก | — | มือถือ + desktop |
| Auto-hide sidebar | ✅ EXISTS_NOW | `src/app/page.tsx` mouse hover | — | ปานกลาง | — | Hover left edge → sidebar |
| Toast notifications | ✅ EXISTS_NOW | sonner library | ทุก page | สำคัญมาก | — | Toast แสดง success/error |
| Loading states | ✅ EXISTS_NOW | Loader2 icon | ทุก page | สำคัญมาก | — | Spinner ขณะโหลด |
| Sticky footer | ⚠️ PARTIAL | บาง page มี บาง page ไม่มี | — | ปานกลาง | P2 | ตรวจทุก page |
| Dark mode | ❌ MISSING_NOW | ไม่มี next-themes setup | — | ต่ำ | P2 | — |

---

## 15. Deployment & DevOps

| Feature | Status | Evidence | Files/Routes | Business Importance | Rebuild Priority | Test Needed |
|---------|--------|----------|--------------|---------------------|------------------|-------------|
| Vercel auto-deploy | ✅ EXISTS_NOW | GitHub main → Vercel | — | สำคัจมาก | — | Push → deploy |
| Standalone build | ✅ EXISTS_NOW | next.config.ts `output: "standalone"` | — | สำคัญมาก | — | Build success |
| Prisma client generate | ✅ EXISTS_NOW | postinstall script | — | สำคัญมาก | — | Client อัปเดต |
| ESLint | ✅ EXISTS_NOW | `eslint.config.mjs` | — | สำคัญมาก | — | `bun run lint` ผ่าน |
| TypeScript strict | ⚠️ PARTIAL | tsconfig แต่ next.config มี ignoreBuildErrors | — | สำคัญมาก | P2 | ลบ ignoreBuildErrors |
| Supabase Postgres | ✅ EXISTS_NOW | schema.prisma provider postgresql | — | สำคัญมาก | — | — |
| Local SQLite (dev only) | ⚠️ PARTIAL | .env มี file: path แต่ schema เป็น postgresql | — | ปานกลาง | P2 | ต้องเปลี่ยนเป็น sqlite ชั่วคราวเพื่อ local test |
| db/custom.db tracked in git | ⚠️ PARTIAL | `git ls-files db/custom.db` แสดง | — | ปานกลาง | P1 | ลบออกจาก git + เพิ่ม .gitignore |
| Migration script (additive) | ✅ EXISTS_NOW | `prisma/migrations/add_weight_expression.sql` | — | สำคัญมาก | — | Owner run ใน Supabase |
| JWT_SECRET env var | ⚠️ PARTIAL | code ต้องการ แต่ .env local ไม่มี | — | สำคัญมาก | P1 | เพิ่มใน .env + Vercel |
| .env gitignored | ✅ EXISTS_NOW | `.gitignore` มี `.env*` | — | สำคัญมาก | — | ไม่ track |

---

## สรุปสถานะรวม

### By Status
| Status | Count |
|--------|-------|
| ✅ EXISTS_NOW | ~70 |
| ❌ MISSING_NOW | ~30 |
| ⚠️ PARTIAL | ~7 |
| 📋 PLANNED | 0 |

### By Rebuild Priority
| Priority | Count | รายการสำคัญ |
|----------|-------|------------|
| P0 | ~22 | billNumber, isCancelled, AuditLog, cancel routes (3), weightExpression fields (5) |
| P1 | ~8 | Excel import, Product Alias, user 04, db/custom.db, JWT_SECRET local |
| P2 | ~5 | sorting source filter, dark mode, ignoreBuildErrors, sticky footer |

### Critical Path สำหรับ Rebuild
```
1. P0: Add fields ใน schema (billNumber, isCancelled, cancelledAt, cancelledBy, cancelReason, AuditLog, weightExpression×5)
2. P0: Run migration SQL ใน Supabase
3. P0: Create src/lib/bill-helpers.ts (generateBillNumber + writeAuditLog)
4. P0: Update POST routes (buy/sell/sorting) — generate billNumber + write AuditLog
5. P0: Create [id]/route.ts DELETE handlers (cancel)
6. P0: Update history-page.tsx — show billNumber + cancel button
7. P0 (หลัง migrate): Update buy/sell/sort/history — weightExpression live preview + display
8. P0 (หลัง migrate): Update POST routes — accept + store weightExpression
9. P1: Recreate Excel import (route + dialog)
10. P1: Recreate Product Alias mapping files
```
