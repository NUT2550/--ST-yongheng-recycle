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
Task: ดึงโค้ดจาก GitHub repo NUT2550/yongheng-recycle มาทำงานต่อในเครื่อง sandbox และตั้งค่าใช้ Supabase

Work Log:
- Clone private repo NUT2550/yongheng-recycle ผ่าน token มาที่ /tmp/yongheng-recycle
- อ่าน worklog.md เดิม เข้าใจงาน 6 tasks ที่ผ่านมา (Dashboard, Buy/Sell/Sort, API, layout, login, bonus, sidebar auto-hide, ProductCombobox)
- rsync โค้ดจาก /tmp/yongheng-recycle มาที่ /home/z/my-project (exclude .git, node_modules, .next, *.png screenshots, upload, tool-results)
- ตั้งค่า .env ใช้ Supabase Postgres: URL-encode password `[8sY.#thcN$Bk5%G]` -> `%5B8sY.%23thcN%24Bk5%25G%5D`
- bun install: เพิ่ม @supabase/supabase-js, bcryptjs, jose
- พบข้อจำกัด: sandbox บล็อก outbound TCP port 5432 (Can't reach Supabase Postgres)
  - ตรวจสอบ: TCP 5432 Network unreachable, TCP 443 OK, Supabase REST API ตอบ 401 = project active
- สลับไปใช้ SQLite ชั่วคราว: เปลี่ยน prisma provider postgresql -> sqlite, backup schema เดิมไว้ที่ prisma/schema.prisma.postgres.bak
- ตั้ง DATABASE_URL=file:/home/z/my-project/db/custom.db
- prisma db push: สร้างตารางทั้งหมดใน SQLite สำเร็จ
- สร้าง prisma/seed.ts และรัน:
  - admin user (admin / admin123) ผ่าน bcrypt hash
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
  - login ด้วย admin/admin123 สำเร็จ
  - หน้าแดชบอร์ดแสดง 0.00 กก. (ยังไม่มีข้อมูล)
  - หน้ารับซื้อ: ค้นหา "ทอง" เจอ 11 รายการ, เลือก "ทองแดงแท่ง" ราคา 220/กก. auto-fill, ใส่น้ำหนัก 100 กก. = 22,000 บาท, เพิ่มในตะกร้า, บันทึกใบรับซื้อ -> POST /api/buy-bills 201
  - หน้าสต๊อก: แสดง 100.00 กก. / 22,000.00 บาท ตรงกับที่รับซื้อ
  - หน้าประวัติ: แสดงใบรับซื้อ 22,000 บาท
  - หน้าผู้ใช้งาน: แสดง admin (ผู้ดูแลระบบ)

Stage Summary:
- โปรเจกต์ yongheng-recycle รันได้ปกติใน sandbox ที่ http://localhost:3000
- ใช้ SQLite ชั่วคราวเพราะ sandbox บล็อก port 5432; เก็บ Supabase URL และ postgres schema ไว้ในไฟล์ backup พร้อม migrate กลับได้เมื่อ network เปิด
- ข้อมูล seed: admin/admin123, 7 categories, 56 products, 3 employees, 1 customer
- ระบบ login + buy + stock + history + users ทำงานครบ
- แก้ React Hooks order bug ใน page.tsx (lint ผ่าน)
- พบ issue เดิมจาก repo: sidebar auto-hide ใช้ CSS transform ทำให้ agent-browser คลิกปุ่มใน sidebar ไม่ได้ตรงๆ (ต้อง click ผ่าน JS) — แต่ user ใช้เมาส์จริงได้ปกติเพราะ hover-to-reveal

---
Task ID: 8
Agent: Main
Task: เพิ่มปุ่ม show/hide password ในหน้า login + สร้าง user 01/2550

Work Log:
- แก้ src/components/login-page.tsx:
  - เพิ่ม import Eye, EyeOff จาก lucide-react
  - เพิ่ม state showPassword (boolean)
  - เปลี่ยน <Input type="password"> เป็น type={showPassword ? 'text' : 'password'}
  - ครอบด้วย <div className="relative"> แล้วใส่ปุ่ม Eye/EyeOff absolute ขวาสุด
  - ปุ่มเป็น type="button" (ไม่ submit), variant="ghost", tabIndex=-1 (ไม่ขัดจังหวะ tab flow)
  - aria-label สลับ "แสดงรหัสผ่าน" / "ซ่อนรหัสผ่าน"
  - เพิ่ม className="pr-10" ที่ input เพื่อไม่ให้ตัวอักษรซ้อนปุ่ม
  - อัปเดต hint ด้านล่าง: "บัญชี: admin / admin123 · 01 / 2550"
- สร้าง prisma/create-user-01.ts:
  - ใช้ bcrypt hash password "2550"
  - upsert user username="01", name="ผู้ใช้ 01", role="staff", isActive=true
- รัน script: สร้าง user 01 สำเร็จ
- ทดสอบด้วย Agent Browser:
  - คลิกปุ่ม Eye -> input เปลี่ยน type=password เป็น type=text, เห็นค่า "2550", aria-label เปลี่ยนเป็น "ซ่อนรหัสผ่าน"
  - คลิกอีกครั้ง -> type กลับเป็น password
  - login ด้วย 01/2550 สำเร้า -> POST /api/auth/login 200, เข้าหน้าแดชบอร์ด, header แสดง "ผู้ใช้ 01" ไม่มี badge ผู้ดูแล
  - ตรวจ nav: staff เห็น 8 เมนู (ไม่มี "ผู้ใช้งาน") ตาม RBAC ที่ออกแบบไว้
- lint: ผ่าน

Stage Summary:
- หน้า login มีปุ่ม toggle แสดง/ซ่อนรหัสผ่านแล้ว
- สร้างบัญชีใหม่: username "01" / password "2550" / role "staff"
- หากต้องการให้ 01 เป็น admin แทน: แก้ role ใน prisma/create-user-01.ts เป็น "admin" แล้วรันใหม่ หรือ login ด้วย admin/admin123 แล้วไปหน้า "ผู้ใช้งาน" เพื่อเปลี่ยน role
