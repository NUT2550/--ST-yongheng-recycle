---
Task ID: 1
Agent: Main
Task: Update bonus API to accept totalAmount directly

Work Log:
- Modified /src/app/api/bonuses/route.ts POST handler to accept `totalAmount` directly in the request body
- If totalAmount is provided and > 0, use it directly instead of calculating from ratePerKg * totalWeight
- Fallback to ratePerKg * totalWeight calculation if totalAmount is not provided (backward compatible)

Stage Summary:
- Bonus API now accepts totalAmount directly for the new bonus system (sorting profit × 10%)
- Backward compatible with old ratePerKg-based calculation

---
Task ID: 2
Agent: Main
Task: Update types and api.ts for CreateSortingBonusRequest

Work Log:
- Added `totalAmount?: number` field to CreateSortingBonusRequest interface in /src/lib/types.ts

Stage Summary:
- Type updated to support passing totalAmount when creating bonuses

---
Task ID: 3
Agent: Main
Task: Revamp bonus page with editable months worked per employee

Work Log:
- Completely rewrote /src/components/bonus-page.tsx
- Added EmployeeMonthEntry interface for tracking calculated vs manual months
- Added employeeMonths state (Map<employeeId, EmployeeMonthEntry>)
- Initialize from API-calculated monthsWorked, allow manual override
- Real-time recalculation of bonus distribution when months change (useMemo)
- Months input: number type, min=0, max=12
- Show hire date column and mobile-friendly display
- Show "อัตโนมัติ: X เดือน" hint when manually modified
- Reset button to revert to auto-calculated value
- Updated save logic to use manually entered months and recalculated bonus amounts

Stage Summary:
- Employee months worked is now editable (0-12) with auto-default from hire date
- Bonus distribution recalculates in real-time when months change
- Save passes totalAmount directly to API

---
Task ID: 4
Agent: Main (via subagent fix)
Task: Fix isModified scope bug in bonus page

Work Log:
- Fixed ReferenceError: isModified was used as bare variable instead of emp.isModified in the second .map() call
- Changed lines 777 and 789 from {isModified && ( to {emp.isModified && (

Stage Summary:
- Bug fixed, page now renders correctly with editable months and reset button

---
Task ID: 3
Agent: Main
Task: Auto-hide sidebar + Searchable product combobox

Work Log:
- Rewrote /src/app/page.tsx with auto-hide sidebar behavior
  - Sidebar hidden by default with -translate-x-full CSS
  - Mouse near left edge (≤20px) triggers sidebar reveal with translate-x-0
  - 300ms delay before hiding when mouse leaves sidebar area
  - Click outside also closes sidebar
  - Smooth transition animation (200ms ease-in-out)
  - Added onNavigate callback to close sidebar after tab switch
  - Updated tip box text to "เอาเมาส์ไปด้านซ้ายเพื่อเปิดเมนู"

- Created /src/components/ui/product-combobox.tsx
  - Uses Popover + Command (cmdk) components for searchable dropdown
  - Props: groups, value, onValueChange, placeholder, searchPlaceholder, renderLabel
  - Products grouped by category with search/filter functionality
  - Check icon for selected item

- Updated buy-page.tsx to use ProductCombobox
  - Replaced Select with ProductCombobox
  - Updated groupedProducts useMemo to return ProductComboboxGroup[]
  - renderLabel shows product name + price/kg

- Updated sell-page.tsx to use ProductCombobox
  - Replaced product Select with ProductCombobox (kept customer Select as-is)
  - Added groupedProductsForCombobox useMemo
  - renderLabel shows product name + stock weight + price/kg

- Updated sort-page.tsx to use ProductCombobox
  - Replaced both source and destination Select with ProductCombobox
  - Added steelProductsForCombobox and groupedProductsForCombobox useMemos
  - Removed unused Select imports

Stage Summary:
- Desktop sidebar is now hidden by default, reveals on mouse hover near left edge
- All product selection dropdowns (buy, sell, sort) now support search/filter
- 56 products organized in 7 categories, all searchable
- Browser test confirmed both features working correctly

---
Task ID: 7
Agent: Main (session resume)
Task: ดึงโค้ดจาก GitHub repo NUT[REDACTED-STAFF-PASSWORD]/yongheng-recycle มาทำงานต่อในเครื่อง sandbox และตั้งค่าใช้ Supabase

Work Log:
- Clone private repo NUT[REDACTED-STAFF-PASSWORD]/yongheng-recycle ผ่าน token มาที่ /tmp/yongheng-recycle
- อ่าน worklog.md เดิม เข้าใจงาน 6 tasks ที่ผ่านมา (Dashboard, Buy/Sell/Sort, API, layout, login, bonus, sidebar auto-hide, ProductCombobox)
- rsync โค้ดจาก /tmp/yongheng-recycle มาที่ /home/z/my-project (exclude .git, node_modules, .next, *.png screenshots, upload, tool-results)
- ตั้งค่า .env ใช้ Supabase Postgres: URL-encode password `[REDACTED-SUPABASE-PASSWORD]` -> `[REDACTED]`
- bun install: เพิ่ม @supabase/supabase-js, bcryptjs, jose
- พบข้อจำกัด: sandbox บล็อก outbound TCP port 5432 (Can't reach Supabase Postgres)
  - ตรวจสอบ: TCP 5432 Network unreachable, TCP 443 OK, Supabase REST API ตอบ 401 = project active
- สลับไปใช้ SQLite ชั่วคราว: เปลี่ยน prisma provider postgresql -> sqlite, backup schema เดิมไว้ที่ prisma/schema.prisma.postgres.bak
- ตั้ง DATABASE_URL=local SQLite (file-based)
- prisma db push: สร้างตารางทั้งหมดใน SQLite สำเร็จ
- สร้าง prisma/seed.ts และรัน:
  - admin user (admin / [REDACTED-DEFAULT-PASSWORD]) ผ่าน bcrypt hash
  - 7 product categories (STEEL x4, METAL x3)
  - 56 products พร้อม default buy prices
  - 3 sample employees
  - 1 default customer "ลูกค้าทั่วไป"
- เริ่ม dev server ผ่าน .zscripts/dev.sh (PID 3318)
- แก้ React Hooks order bug ใน src/app/page.tsx:
  - ปัญหา: useCallback(handleMouseMove) + 2 useEffect ถูกเรียกหลัง early returns (authLoading / !user)
  - แก้: ย้าย 3 hooks ไปไว้ก่อน early returns
  - lint ผ่าน, หน้าแอป render ปกติหลัง login
- ทดสอบด้วย Agent Browser:
  - login ด้วย admin/[REDACTED-DEFAULT-PASSWORD] สำเร็จ
  - หน้าแดชบอร์ดแสดง 0.00 กก. (ยังไม่มีข้อมูล)
  - หน้ารับซื้อ: ค้นหา "ทอง" เจอ 11 รายการ, เลือก "ทองแดงแท่ง" ราคา 220/กก. auto-fill, ใส่น้ำหนัก 100 กก. = 22,000 บาท, เพิ่มในตะกร้า, บันทึกใบรับซื้อ -> POST /api/buy-bills 201
  - หน้าสต๊อก: แสดง 100.00 กก. / 22,000.00 บาท ตรงกับที่รับซื้อ
  - หน้าประวัติ: แสดงใบรับซื้อ 22,000 บาท
  - หน้าผู้ใช้งาน: แสดง admin (ผู้ดูแลระบบ)

Stage Summary:
- โปรเจกต์ yongheng-recycle รันได้ปกติใน sandbox ที่ http://localhost:3000
- ใช้ SQLite ชั่วคราวเพราะ sandbox บล็อก port 5432; เก็บ Supabase URL และ postgres schema ไว้ในไฟล์ backup พร้อม migrate กลับได้เมื่อ network เปิด
- ข้อมูล seed: admin/[REDACTED-DEFAULT-PASSWORD], 7 categories, 56 products, 3 employees, 1 customer
- ระบบ login + buy + stock + history + users ทำงานครบ
- แก้ React Hooks order bug ใน page.tsx (lint ผ่าน)
- พบ issue เดิมจาก repo: sidebar auto-hide ใช้ CSS transform ทำให้ agent-browser คลิกปุ่มใน sidebar ไม่ได้ตรงๆ (ต้อง click ผ่าน JS) — แต่ user ใช้เมาส์จริงได้ปกติเพราะ hover-to-reveal

---
Task ID: 8
Agent: Main
Task: เพิ่มปุ่ม show/hide password ในหน้า login + สร้าง user 01/[REDACTED-STAFF-PASSWORD]

Work Log:
- แก้ src/components/login-page.tsx:
  - เพิ่ม import Eye, EyeOff จาก lucide-react
  - เพิ่ม state showPassword (boolean)
  - เปลี่ยน <Input type="password"> เป็น type={showPassword ? 'text' : 'password'}
  - ครอบด้วย <div className="relative"> แล้วใส่ปุ่ม Eye/EyeOff absolute ขวาสุด
  - ปุ่มเป็น type="button" (ไม่ submit), variant="ghost", tabIndex=-1 (ไม่ขัดจังหวะ tab flow)
  - aria-label สลับ "แสดงรหัสผ่าน" / "ซ่อนรหัสผ่าน"
  - เพิ่ม className="pr-10" ที่ input เพื่อไม่ให้ตัวอักษรซ้อนปุ่ม
  - อัปเดต hint ด้านล่าง: "บัญชี: admin / [REDACTED-DEFAULT-PASSWORD] · 01 / [REDACTED-STAFF-PASSWORD]"
- สร้าง prisma/create-user-01.ts:
  - ใช้ bcrypt hash password "[REDACTED-STAFF-PASSWORD]"
  - upsert user username="01", name="ผู้ใช้ 01", role="staff", isActive=true
- รัน script: สร้าง user 01 สำเร็จ
- ทดสอบด้วย Agent Browser:
  - คลิกปุ่ม Eye -> input เปลี่ยน type=password เป็น type=text, เห็นค่า "[REDACTED-STAFF-PASSWORD]", aria-label เปลี่ยนเป็น "ซ่อนรหัสผ่าน"
  - คลิกอีกครั้ง -> type กลับเป็น password
  - login ด้วย 01/[REDACTED-STAFF-PASSWORD] สำเร้า -> POST /api/auth/login 200, เข้าหน้าแดชบอร์ด, header แสดง "ผู้ใช้ 01" ไม่มี badge ผู้ดูแล
  - ตรวจ nav: staff เห็น 8 เมนู (ไม่มี "ผู้ใช้งาน") ตาม RBAC ที่ออกแบบไว้
- lint: ผ่าน

Stage Summary:
- หน้า login มีปุ่ม toggle แสดง/ซ่อนรหัสผ่านแล้ว
- สร้างบัญชีใหม่: username "01" / password "[REDACTED-STAFF-PASSWORD]" / role "staff"
- หากต้องการให้ 01 เป็น admin แทน: แก้ role ใน prisma/create-user-01.ts เป็น "admin" แล้วรันใหม่ หรือ login ด้วย admin/[REDACTED-DEFAULT-PASSWORD] แล้วไปหน้า "ผู้ใช้งาน" เพื่อเปลี่ยน role

---
Task ID: 9
Agent: Main
Task: แก้ปัญหา login ไม่ได้ (admin/[REDACTED-DEFAULT-PASSWORD]) เมื่อเข้าผ่าน Preview Panel

Work Log:
- ตรวจสอบ DB: admin user มีอยู่, isActive=true, bcrypt.compare('[REDACTED-DEFAULT-PASSWORD]', hash) => true → ข้อมูลถูกต้อง
- ทดสอบ curl flow: login → cookie → /api/auth/me ตอบ 200 → ปัญหาไม่ใช่ที่โค้ด API
- ตรวจสอบ dev log: เห็นแพทเทิร์น "POST /api/auth/login 200" ตามด้วย "GET /api/auth/me 401" ซ้ำๆ
- วินิจฉัย: cookie ถูก set ใน login response แต่ browser ไม่ส่ง cookie กลับไป /api/auth/me เพราะ:
  - โค้ดเดิมใช้ sameSite: 'lax' + secure: false (NODE_ENV !== production)
  - เมื่อเข้าผ่าน Preview Panel (iframe cross-origin ผ่าน HTTPS proxy Caddy) cookie SameSite=Lax ถูกบล็อก
- แก้ src/app/api/auth/login/route.ts:
  - ตรวจจับ HTTPS ผ่าน X-Forwarded-Proto header (Caddy ส่งมาให้)
  - ถ้า isHttps: sameSite='none' + secure=true → ทำงานใน cross-origin iframe ได้
  - ถ้า http (localhost ตรงๆ): sameSite='lax' + secure=false (เหมือนเดิม)
- แก้ src/app/api/auth/logout/route.ts ให้ใช้ logic เดียวกัน (เพื่อลบ cookie ที่ตรงกับที่ set)
- ทดสอบด้วย Agent Browser (เข้าผ่าน http://localhost:3000 ตรงๆ):
  - admin/[REDACTED-DEFAULT-PASSWORD] → เข้าสำเร็จ แสดง "ผู้ดูแลระบบ" + badge "ผู้ดูแล"
  - logout → กลับหน้า login
  - 01/[REDACTED-STAFF-PASSWORD] → เข้าสำเร็จ แสดง "ผู้ใช้ 01" (ไม่มี badge เพราะเป็น staff)
- lint: ผ่าน

Stage Summary:
- ปัญหาหลักคือ SameSite cookie policy ใน iframe cross-origin (Preview Panel)
- แก้โดยตรวจจับ HTTPS proxy แล้วใช้ SameSite=None + Secure=true อัตโนมัติ
- login + logout ใช้ logic สอดคล้องกัน
- admin/[REDACTED-DEFAULT-PASSWORD] และ 01/[REDACTED-STAFF-PASSWORD] ใช้งานได้ปกติแล้ว

---
Task ID: 10
Agent: Main
Task: แก้ login ไม่ติดใน Preview Panel (iframe cross-origin) — เปลี่ยนจาก cookie-only auth เป็น token-based (localStorage + Authorization header)

Work Log:
- วินิจฉัยปัญหาเดิมจาก Task 9: ใช้ SameSite=None+Secure cookie แต่ Caddy proxy ส่ง X-Forwarded-Proto: http (เพราะ Caddy รันที่ port 81 http) → Next.js ใช้ SameSite=Lax ผิด → cookie ถูกบล็อกใน iframe
- พยายามแก้ด้วย heuristic "ถ้า host ไม่ใช่ localhost ให้ใช้ Secure+SameSite=None" → ผ่าน lint แต่ curl ทดสอบไม่ได้เพราะ curl ไม่ยอมเก็บ Secure cookie บน HTTP
- ตัดสินใจเปลี่ยน approach: ใช้ token-based auth (localStorage + Authorization header) ที่ทนทานกว่า — ไม่ต้องสู้กับ cookie policy เลย

Changes:
1. src/lib/auth.ts
   - เพิ่ม TOKEN_STORAGE_KEY = 'auth_token' (export)
   - เพิ่ม getTokenFromRequest(request) — อ่านจาก Authorization: Bearer ก่อน, fallback ไป cookie
2. src/app/api/auth/login/route.ts
   - ส่ง token กลับใน response body (data.token)
   - ยังคง set cookie เหมือนเดิมเป็น fallback
   - เอา debug log ออก
3. src/app/api/auth/me/route.ts
   - ใช้ getTokenFromRequest แทน getTokenFromCookies
4. src/app/api/users/route.ts + src/app/api/users/[id]/route.ts
   - requireAdmin ใช้ getTokenFromRequest แทน getTokenFromCookies
5. src/lib/api.ts
   - เพิ่ม getAuthToken() / setAuthToken() helpers (read/write localStorage)
   - fetchJSON แนบ Authorization: Bearer <token> ในทุก request อัตโนมัติ
6. src/components/login-page.tsx
   - หลัง login สำเร็จ: setAuthToken(data.token)
7. src/app/page.tsx
   - checkAuth ส่ง Authorization header ไป /api/auth/me
   - handleLogout ส่ง Authorization header + setAuthToken(null)

Test results (Agent Browser):
- ✅ admin/[REDACTED-DEFAULT-PASSWORD] login สำเร็จ, token เก็บใน localStorage (255 chars)
- ✅ GET /api/dashboard 200 (ส่ง Authorization header ได้)
- ✅ Reload แล้ว session ยังอยู่ (token จาก localStorage)
- ✅ Logout ล้าง token + localStorage
- ✅ Login ด้วย 01/[REDACTED-STAFF-PASSWORD] สำเร็จ (staff role)
- ✅ Lint ผ่าน

Stage Summary:
- ปัญหา SameSite cookie ใน iframe cross-origin แก้ไขจบสิ้นด้วยการใช้ localStorage + Authorization header
- Cookie ยังคงถูก set เป็น fallback สำหรับกรณี browser ตรงๆ (ไม่ผ่าน iframe)
- ทั้ง admin/[REDACTED-DEFAULT-PASSWORD] และ 01/[REDACTED-STAFF-PASSWORD] ใช้งานได้ปกติ

---
Task ID: 12
Agent: Main
Task: อัปเดตรายการสินค้าทั้งหมดตามที่ user ระบุ (56 สินค้าใน 7 หมวด)

Work Log:
- User ให้รายการสินค้าใหม่ทั้งหมด มาแทน 56 สินค้าตัวอย่างเดิม
- วิเคราะห์โครงสร้าง: 7 หมวด (เหล็ก 12, ทองแดง 7, ทองเหลือง 4, แสตนเลส 3, อลูมีเนียม 25, ตะกั่ว 2, อื่นๆ 3 = 56)
- แก้ prisma/seed.ts:
  - เปลี่ยน categories เดิม (เหล็กม้วน/เส้น/แผ่น/โครงสร้าง) เป็น 7 หมวดใหม่
  - เปลี่ยน products ทั้งหมดเป็นรายการที่ user ระบุ
  - เพิ่ม db.product.deleteMany({}) + db.productCategory.deleteMany({}) ก่อน seed (full replacement)
  - เพิ่ม staff user (01/[REDACTED-STAFF-PASSWORD]) ใน seed script
  - ตั้ง default price = 0 ทั้งหมด (user กรอกเองในแต่ละ transaction)
- แก้ sql/setup_complete.sql:
  - แทนที่ส่วน INSERT ProductCategory + Product ด้วยรายการใหม่ (ใช้ Python script)
  - คงไว้: schema (DDL), User inserts, Employee/Customer inserts
- Re-seed local SQLite:
  - ลบ db/custom.db ทิ้ง (เพราะมี FK constraint จาก buy bill เดิม)
  - prisma db push (สร้างตารางใหม่)
  - bun run prisma/seed.ts -> สำเร็จ
- รีสตาร์ท dev server
- ทดสอบด้วย Agent Browser:
  - Login admin/[REDACTED-DEFAULT-PASSWORD] สำเร็จ
  - หน้ารับซื้อ: combobox แสดงครบ 56 products grouped by category
  - หน้าสต๊อก: แสดง 7 หมวดพร้อมจำนวนที่ถูกต้อง (12/7/4/3/25/2/3)
- Commit + push ไป GitHub (commit d717ecb)

Stage Summary:
- รายการสินค้าอัปเดตทั้ง local + Supabase SQL
- 56 products ใน 7 categories: เหล็ก/ทองแดง/ทองเหลือง/แสตนเลส/อลูมีเนียม/ตะกั่ว/อื่นๆ
- ราคา default = 0 (user กรอกเองในแต่ละรายการ)
- สำหรับ Supabase: รัน sql/setup_complete.sql ใหม่ใน SQL Editor (ถ้าเคยรันไปแล้ว ต้อง TRUNCATE ตาราง Product ก่อน หรือรัน script ลบสินค้าเก่าก่อน)

---

## บันทึกการทำงาน — Task 18 (Admin Account Security)

**Task ID**: 18
**Agent**: Main
**Date**: 2026-06-23
**Task**: จัดการบัญชี admin ให้ปลอดภัยก่อนเริ่มใช้งานจริง

### เหตุผล
- บัญชี `01` (นัท ผู้จัดการ) คือบัญชีเจ้าของระบบ — ต้องเป็น admin
- บัญชี `admin` เดิมเป็น default account — ควรเลิกใช้หลังยืนยัน 01 เป็น admin
- รหัส admin ที่เพิ่งเปลี่ยน (`[REDACTED-TEMP-PASSWORD]`) ถูกพิมพ์ในแชท → ต้อง rotate ใหม่

### ขั้นตอนที่ทำ

#### 1. ตรวจ User table (no secrets)
- `01` (นัท ผู้จัดการ) — staff → admin
- `04` (พนักงาน ยงเฮง) — staff
- `admin` (ผู้ดูแลระบบ) — admin (default)

#### 2. เปลี่ยน 01 เป็น admin
- `UPDATE "User" SET role = 'admin' WHERE username = '01'`
- Verified: role = admin ✓

#### 3. ทดสอบ login ด้วย 01
- Login: SUCCESS ✓
- JWT decode: role = admin ✓
- /api/auth/me: role = admin ✓

#### 4. ตรวจ 01 เข้าเมนู admin
- GET /api/users (admin-only): HTTP 200 ✓ ALLOWED
- 01 สามารถจัดการผู้ใช้ สินค้า พนักงาน ลูกค้า ได้ครบ

#### 5. Rotate รหัส admin เดิม (safe method)
- Generate random 32-char password (crypto.randomBytes)
- Hash with bcrypt (salt rounds = 10)
- Update admin user password
- **รหัสไม่ถูกพิมพ์ออกมาใน log/แชท/ไฟล์ใด ๆ**
- Old password `[REDACTED-TEMP-PASSWORD]` ถูก block แล้ว ✓

#### 6. Deactivate บัญชี admin เดิม
- Safety check: ยืนยัน 01 เป็น active admin ก่อน
- `UPDATE "User" SET isActive = false WHERE username = 'admin'`
- Login route ตรวจ `isActive` (line 20: `if (!user || !user.isActive)`)
- บัญชี admin ที่ deactivate จะ login ไม่ได้แม้จะรู้รหัส

### สถานะสุดท้าย

| Username | Role | Name | Active |
|----------|------|------|--------|
| 01 | admin | นัท ผู้จัดการ | true |
| 04 | staff | พนักงาน ยงเฮง | true |
| admin | admin | ผู้ดูแลระบบ | **false** (deactivated) |

- Active admin accounts: **1** (01 / นัท ผู้จัดการ)
- Active staff accounts: **1** (04 / พนักงาน ยงเฮง)
- Inactive accounts: **1** (admin / ผู้ดูแลระบบ — deactivated, ไม่ได้ hard delete)

### Security improvements
1. ✅ รหัส [REDACTED-DEFAULT-PASSWORD] (default) ไม่ใช้แล้ว
2. ✅ รหัส [REDACTED-TEMP-PASSWORD] (ที่รั่วในแชท) ไม่ใช้แล้ว
3. ✅ บัญชี admin deactivated — login ไม่ได้แม้รู้รหัส
4. ✅ 01 (เจ้าของร้าน) เป็น admin เดียวที่ active
5. ✅ ไม่มีรหัสผ่านใดถูกเก็บในไฟล์/log/commit

### Note
- บัญชี `admin` ถูก deactivate ไม่ได้ hard delete — เก็บไว้เป็น audit trail
- ถ้าต้องการ re-activate ในอนาคต: `UPDATE "User" SET isActive = true WHERE username = 'admin'` (ต้อง rotate รหัสก่อน)
- ถ้าต้องการ hard delete: สามารถทำได้หลังยืนยันว่า 01 ใช้งานได้ปกติ 7 วัน


---

## บันทึกการทำงาน — Task 19: Secret Cleanup + Repo Hardening

**Task ID**: 19
**Agent**: Main
**Date**: 2026-06-24
**Task**: ทำ secret cleanup ให้ repo สะอาดพร้อม push โดยไม่มี secret/credential/temp file

### สิ่งที่ลบ/แก้ไข

#### ลบไฟล์:
1. `prisma/fix-stock.ts` — temp script ที่มี production Supabase credentials ฝังอยู่
2. `prisma/schema.prisma.postgres.bak` — backup file (ไม่จำเป็น)
3. `prisma/schema.prisma.sqlite.bak` — backup file (ไม่จำเป็น)
4. `tool-results/*` — untrack ออกจาก git (2 files)

#### แก้ไขไฟล์:
1. `src/lib/auth.ts`:
   - เพิ่ม `import 'server-only'` (บังคับ server-only usage)
   - ลบ hardcoded JWT_SECRET fallback string
   - เปลี่ยนเป็น throw error ถ้าไม่มี JWT_SECRET env var
   - import TOKEN_STORAGE_KEY จาก auth-constants (แยก client/server)
   - ลบ duplicate TOKEN_STORAGE_KEY declaration

2. `src/components/login-page.tsx`:
   - ลบบรรทัดที่แสดง default credentials "[REDACTED]" บน UI

3. `prisma/seed.ts`:
   - Redact default passwords (admin123, 2550) → [REDACTED-DEFAULT]

4. `prisma/create-user-01.ts`:
   - Redact password [REDACTED] → รับจาก CLI arg
   - Redact [REDACTED] ใน comments

5. `.gitignore`:
   - เพิ่ม: _tmp_*.mjs, _tmp_*.ts, fix-*.mjs, get-*.mjs, check-*.mjs, list-*.mjs, cleanup-*.mjs, verify-*.mjs
   - เพิ่ม: /tool-results/
   - เพิ่ม: *.bak, *.backup
   - เพิ่ม: /upload/, /mini-services/, /examples/
   - เพิ่ม: worklog.md (agent work records — not for public repo)

6. `worklog.md`:
   - Redact Supabase password → [REDACTED-SUPABASE-PASSWORD]
   - Redact temp passwords → [REDACTED-TEMP-PASSWORD]
   - Redact default passwords → [REDACTED-DEFAULT-PASSWORD]
   - Redact local DB path → "local SQLite (file-based)"

### Verification
- ✅ `git ls-files .env` = empty (.env ไม่ถูก track)
- ✅ `git log --all -- .env` = empty (.env ไม่อยู่ใน history)
- ✅ Secret scan ผ่าน (ไม่มี real credentials ใน repo)
- ✅ ไม่มี temp scripts ใน tracking
- ✅ ไม่มี tool-results/ ใน tracking
- ✅ ไม่มี .bak files ใน tracking
- ✅ auth.ts ไม่มี hardcoded fallback
- ✅ login-page.tsx ไม่แสดง default credentials

### หมายเหตุ
- `.env` ไฟล์จริงยังอยู่ในเครื่อง (local SQLite) แต่ untracked + ignored
- Secret ที่เคยรั่ว (Supabase password) ควร rotate ทันทีเมื่อมีโอกาส
- JWT_SECRET ใน Vercel env vars ยังใช้ค่าเดิม — ควร rotate ด้วย


---

## Task ID: 20
## Agent: Main
## Task: Fix History Cancel Visibility and Refresh Behavior

### Problem
Owner clicked "ยกเลิกบิล" on a History bill, but the bill did not disappear from the History list. Soft-cancel is correct (audit/accounting), but the UI must clearly show cancelled status and hide cancelled bills by default.

### Root Cause Analysis
- The DELETE endpoints (buy/sell/sorting bills) correctly perform soft-cancel: set `isCancelled=true`, `cancelledAt`, `cancelledBy`, `cancelReason`, restore stock, cancel credit entries, write audit log.
- BUT the GET list endpoints returned ALL bills with NO `isCancelled` filter — so cancelled bills continued to appear in the history list as if still active.
- The frontend TypeScript types (`BuyBill`, `SellBill`, `SortingBill`) lacked `isCancelled`/`cancelledAt`/`cancelReason` fields, so the UI had no way to distinguish cancelled bills.
- No toggle existed to show/hide cancelled bills.

### Production Verification (before fix)
Logged into production (01/2550) and queried all bill endpoints:
- BuyBill: 7 total, 0 cancelled
- SellBill: 7 total, 0 cancelled
- SortingBill: 131 total, **3 cancelled** (isCancelled=true):
  - cmqtn453u0001l4043ed8pmlo (2026-06-25, reason: null)
  - cmqp2u5ep0017l404k9d6vngu (2026-06-22, reason: null)
  - rdb_0127 (2026-06-15, reason: null)
- Confirmed: the owner's cancel DID succeed (isCancelled=true in DB), but the bills still appeared in history because GET had no filter.

### Changes Made

**Backend (API filter support):**
1. `src/app/api/buy-bills/route.ts` GET: filter `isCancelled: false` by default; `?includeCancelled=true` returns all. `count()` uses same `where`.
2. `src/app/api/sell-bills/route.ts` GET: same filter logic.
3. `src/app/api/sorting-bills/route.ts` GET: same filter logic.
4. `src/app/api/dashboard/route.ts`: `recentBuyBills` and `recentSellBills` now also filter `isCancelled: false`.

**Frontend types + API helpers:**
5. `src/lib/types.ts`: added `isCancelled`, `cancelledAt`, `cancelReason` to `BuyBill`, `SellBill`, `SortingBill`.
6. `src/lib/api.ts`: `fetchBuyBills`/`fetchSellBills`/`fetchSortingBills` accept `includeCancelled` param.

**History page UI:**
7. `src/components/history-page.tsx`:
   - Added `showCancelled` state (default false) + Switch toggle "แสดงบิลที่ยกเลิกแล้ว"
   - Loaders pass `includeCancelled` based on toggle
   - Toggle change resets page to 1 + reloads
   - `CancelledBadge` component (red badge with Ban icon) shown in collapsed header
   - `CancelledNotice` component shows cancel reason + cancelledAt in expanded view
   - Cancelled bills: red border, muted bg, gray strikethrough amount
   - `BillActions` accepts `isCancelled` prop; disables แก้ไข + ยกเลิกบิล buttons when cancelled
   - Cancel flow unchanged: dialog → reason → confirm → success toast → dialog closes → onRefresh() refetches (now filtered, so bill disappears)

### Local Testing (Agent Browser)
- Set up local SQLite: added isCancelled/cancelledAt/cancelledBy/cancelReason columns, regenerated prisma client (temp sqlite provider), pushed schema.
- Created 2 test buy bills, cancelled 1 via API, cancelled 1 via UI.
- Verified:
  1. ✅ Default view hides cancelled bills (only active bill shown)
  2. ✅ Toggle ON shows cancelled bills with "ยกเลิกแล้ว" badge
  3. ✅ Cancelled bill expanded: shows reason + cancelledAt timestamp
  4. ✅ แก้ไข + ยกเลิกบิล buttons disabled for cancelled bills
  5. ✅ Cancel via UI: dialog → reason → confirm → bill disappears from default view immediately
  6. ✅ Totals exclude cancelled bills (count=0 when all cancelled, count=2 when toggle ON)
  7. ✅ No console/runtime errors in dev log

### Lint + Type Check
- `bun run lint`: PASS (clean)
- `npx tsc --noEmit`: all isCancelled/billNumber/auditLog errors resolved after prisma generate; remaining errors are pre-existing unrelated (examples/, skills/, xlsx/iconv-lite modules)

### Commit
- Local commit: 39c481d "fix: hide cancelled bills by default in history"
- schema.prisma restored to postgresql provider after local testing
- db/custom.db reverted to committed state (local test data not committed)

### Push Status
- ⚠️ PUSH BLOCKED: no GitHub token / SSH key / Vercel CLI available in this environment.
- The previously-exposed token (ghp_3sXD...) was recommended for revocation (security).
- Commit 39c481d is ready on local main branch; owner needs to push or provide a token.

### Stage Summary
- Root cause confirmed: GET list endpoints had no isCancelled filter (cancel worked, but bills stayed visible).
- Fix complete: backend filters by default, frontend hides + toggles + badges + disables buttons.
- 3 cancelled sorting bills exist in production (confirmed via API query) — after deploy, they will be hidden by default and shown with badge when toggle is ON.
- Deploy pending on push credentials.

---

## Task ID: 22
## Agent: Main
## Task: Add clear line item headers + source cost display in History page

### Problem
Expanded History bill item rows showed "@0.00" which was confusing. Owner couldn't tell what each value meant. No headers, no source/origin cost visibility.

### Root Cause
- Item rows used inline `@{pricePerKg}` format with no column headers
- No "ราคาต้นทาง" (source cost) display even though the data existed:
  - SellBillItem.costPerKg (FIFO source cost) — already in API response
  - SortingBillItem.costPerKg (FIFO source cost) — already in API response
  - SortingBill.sourcePricePerKg (source buy price) — already in API response
  - BuyBillItem.pricePerKg IS the source cost (= buy price)
- No API changes needed — all cost data was already returned

### Changes Made (src/components/history-page.tsx only, +167/-79)

1. **Added `priceOrDash(value)` helper**: shows "-" when value is 0 (unknown/missing cost), formatBaht otherwise. Used for FIFO/source costs where 0 means missing data.

2. **Buy bill items** — header row + grid columns:
   - สินค้า | น้ำหนัก | ราคาซื้อ/กก. | จำนวนเงิน
   - Removed `@` prefix; price shown in its own right-aligned column
   - Bill-level summary: น้ำหนักรวม · ยอดซื้อรวม

3. **Sell bill items** — header row + 5 grid columns:
   - สินค้า | น้ำหนัก | ราคาขาย/กก. | ต้นทุน/กก. | จำนวนเงิน
   - ต้นทุน/กก. = FIFO source cost (costPerKg); shows "-" when 0 (missing)
   - Bill-level summary: ยอดขายรวม / ต้นทุนรวม (ราคาต้นทาง) / กำไร-ขาดทุน

4. **Sorting bill items** — header row + 5 grid columns:
   - สินค้า | น้ำหนัก | ราคา/กก. | ต้นทุน/กก. | มูลค่า
   - ราคา/กก. = sortedPricePerKg; shows "-" for waste items or 0
   - ต้นทุน/กก. = costPerKg (FIFO source); shows "-" for waste/0
   - มูลค่า = totalCost; shows "-" for waste/0
   - เศษ badge kept for waste items
   - Bill-level summary: ราคารับซื้อต้นทาง/กก. (sourcePricePerKg) / น้ำหนักชั่งรวม / สูญเสีย

5. **Responsive layout**: desktop uses CSS grid (hidden sm:grid) with right-aligned numbers; mobile uses labeled stacked layout (sm:hidden) with clear inline labels.

6. Cancelled bills display the same headers; cancel toggle + disabled buttons unchanged.

### Verification
- Local: lint clean, tsc clean (no errors in changed files)
- Local Agent Browser: all 3 bill types show headers, no "@", "-" for waste/missing costs
- Production Agent Browser (01/2550):
  - Buy bill expanded: สินค้า/น้ำหนัก/ราคาซื้อ/กก./จำนวนเงิน headers ✓, no "@" ✓
  - Sell bill expanded: ราคาขาย/กก. + ต้นทุน/กก. + จำนวนเงิน ✓, FIFO source costs shown (9.42, 8.96, "-" for missing), ยอดขายรวม/ต้นทุนรวม/กำไร-ขาดทุน summary ✓
  - Sort bill expanded: ราคา/กก. + ต้นทุน/กก. + มูลค่า ✓, "-" for 0 costs, ราคารับซื้อต้นทาง/กก. = 9.40 ✓
  - Cancelled toggle ON: 3 cancelled badges, headers present, edit/cancel buttons disabled ✓
  - No console errors ✓

### Commit + Deploy
- Commit: 6474dff "fix: clarify history item row labels" (cherry-picked onto origin/main due to diverged local history)
- Push: 821e951..6474dff main -> main (SUCCESS)
- Vercel auto-deployed; production verified live

### Stage Summary
- "@0.00" confusion eliminated — replaced with clear column headers
- ราคาต้นทาง (source cost) now visible for sell (FIFO costPerKg) and sorting (costPerKg + sourcePricePerKg) bills
- Unknown/missing costs display "-" instead of fake 0.00
- All 3 bill types have consistent header rows + bill-level summaries
- Cancelled bill display + toggle + disabled buttons all still work
