# Project Operating Context — ยงเฮง มหาชัย รีไซเคิล

> เอกสารหลักสำหรับ ChatGPT และ owner — ใช้พาโปรเจกต์ต่อได้อย่างปลอดภัยโดยไม่ต้องเดาจากความจำ
> วันที่รวบรวม: 27/06/2569
> ผู้รวบรวม: Z.AI (จาก codebase state ปัจจุบัน + worklog)

---

## 1. Project Identity

| รายการ | ค่า |
|--------|-----|
| **ชื่อโปรเจกต์** | ยงเฮง มหาชัย รีไซเคิล (Yongheng Mahachai Recycle) |
| **จุดประสงค์** | ระบบบันทึกสต็อกสำหรับร้านรับซื้อเหล็กและโลหะ — รองรับการรับซื้อ/ขาย/คัดแยก พร้อม FIFO stock tracking |
| **สถานะปัจจุบัน** | ⚠️ ระบบหลักใช้งานได้ (login/buy/sell/sort/stock/history/dashboard) — แต่ features ขั้นสูงบางตัวหายไปจาก codebase (ดู CURRENT_OPEN_ISSUES.md) |
| **Production URL** | https://st-yongheng-recycle.vercel.app |
| **GitHub repo** | https://github.com/NUT2550/--ST-yongheng-recycle |
| **Vercel project** | (ผูกกับ GitHub repo ข้างบน, auto-deploy จาก main branch) |
| **Supabase dashboard** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx |
| **Supabase SQL Editor** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/sql/new |

---

## 2. Tech Stack

| ชั้น | เทคโนโลยี |
|------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| Runtime | Bun (dev) + Node.js (production บน Vercel) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York style) |
| Database | Supabase Postgres (production) + SQLite (local dev ชั่วคราว) |
| ORM | Prisma 6 |
| Auth | JWT (jose) + bcryptjs + localStorage token + Authorization header |
| State | Zustand (client) |
| Hosting | Vercel (Next.js) + Supabase (Postgres) |
| Icons | lucide-react |

---

## 3. Project Status Summary

### ✅ ใช้งานได้ใน production ปัจจุบัน
- Login + logout (JWT token ใน localStorage + Authorization header)
- บัญชี 2 ตัว: `01` (admin — นัท ผู้จัดการ) + `admin` (deactivated)
- Buy bill (รับซื้อ) — สร้างได้, stock เพิ่มอัตโนมัติ
- Sell bill (ขาย) — สร้างได้, FIFO stock deduction + cost tracking
- Sorting bill (คัดแยก) — สร้างได้, source stock หักด้วย FIFO, output stock เพิ่มใหม่
- Stock page — ดูสต็อกคงเหลือแยกตามหมวด
- History page — ดูประวัติบิล 3 ประเภท
- Dashboard — สรุปยอด
- User management — ดู/เพิ่ม/แก้/deactivate ผู้ใช้
- Product management — ดู/เพิ่ม/แก้/ลบสินค้า
- Customer management
- Credit tracking (ค้างรับ/ค้างจ่าย)
- Employee + Sorting bonus
- Weight formula parsing (`860-3` → 857) — ใช้ในหน้า buy/sell/sort แต่ **ไม่ได้เก็บ expression ใน DB**

### ❌ หายไปจาก codebase (เคยทำแล้วใน Task 20/21/22 แต่ถูก reset)
- `billNumber` (BUY-2569-XXXXX format)
- `isCancelled` (soft delete)
- `AuditLog` table + writeAuditLog helper
- `bill-helpers.ts` (generateBillNumber + writeAuditLog)
- Cancel bill (DELETE /api/{type}-bills/{id})
- Excel import (parse + dialog)
- `weightExpression` DB field (เก็บสูตรใน DB)
- Product alias mapping files
- Migration proposal docs

### ⏳ รอ owner อนุมัติ
- Weight Formula Tracking production migration (SQL script พร้อมที่ `prisma/migrations/add_weight_expression.sql`)
- Product alias mapping proposal (หายไปจาก codebase ต้อง recreate)

---

## 4. โครงสร้างไฟล์สำคัญ

```
prisma/
├── schema.prisma           # Prisma schema (provider = postgresql)
├── seed.ts                 # Initial seed (admin/staff users, 7 categories, 56 products)
├── create-user-01.ts       # สร้าง user 01 (รับ password จาก CLI arg)
└── migrations/
    └── add_weight_expression.sql  # Migration script สำหรับ weightExpression (รอ run)

src/
├── app/
│   ├── api/                # API routes (App Router)
│   │   ├── auth/           # /login, /me, /logout
│   │   ├── buy-bills/      # POST (create) + GET (list)
│   │   ├── sell-bills/     # POST + GET (มี FIFO deduction)
│   │   ├── sorting-bills/  # POST + GET (มี FIFO + output stock)
│   │   ├── products/       # CRUD + [id]/route.ts
│   │   ├── stock/          # GET
│   │   ├── users/          # CRUD + [id]/route.ts
│   │   ├── customers/      # CRUD
│   │   ├── employees/      # CRUD
│   │   ├── bonuses/        # CRUD + [id]/route.ts
│   │   ├── bonus-calculation/
│   │   ├── credit/         # GET + POST pay
│   │   └── dashboard/      # GET
│   └── page.tsx            # Main entry (login/dashboard shell)
├── components/
│   ├── login-page.tsx
│   ├── dashboard-page.tsx
│   ├── buy-page.tsx        # ใช้ parseWeightExpression จาก safe-math
│   ├── sell-page.tsx       # ใช้ parseWeightExpression
│   ├── sort-page.tsx       # ใช้ parseWeightExpression (3 ช่อง)
│   ├── stock-page.tsx
│   ├── history-page.tsx    # list + collapsible bill cards
│   ├── users-page.tsx
│   ├── products-page.tsx
│   ├── credit-page.tsx
│   ├── bonus-page.tsx
│   └── ui/                 # shadcn/ui components
└── lib/
    ├── auth.ts             # JWT (ใช้ JWT_SECRET env var)
    ├── auth-constants.ts   # TOKEN_STORAGE_KEY
    ├── api.ts              # fetchJSON + auth header
    ├── db.ts               # Prisma client
    ├── helpers.ts          # formatBaht, formatWeight, formatDate
    ├── safe-math.ts        # parseWeightExpression (no eval)
    ├── store.ts            # Zustand (cart state)
    └── types.ts            # TypeScript interfaces
```

---

## 5. Owner / ผู้ใช้งาน

| Username | Role | Name | สถานะ |
|----------|------|------|-------|
| `01` | admin | นัท ผู้จัดการ | ✅ active (เจ้าของร้าน) |
| `admin` | admin | ผู้ดูแลระบบ | ❌ deactivated (default account — ไม่ใช้) |
| `04` | staff | พนักงาน ยงเฮง | ✅ active (ต้องสร้างด้วย create-user-01.ts pattern หรือผ่านหน้า Users) |

> **หมายเหตุ**: ใน codebase ปัจจุบัน, `prisma/seed.ts` สร้างเพียง `admin` + `01` (staff) — role ของ `01` ใน DB production อาจเป็น admin (เคยถูก promote ใน Task 18) หรือ staff (ถ้า reset) — ต้องตรวจสอบใน DB

---

## 6. Environment Variables (ชื่อเท่านั้น — ห้ามใส่ค่า)

| ตัวแปร | ใช้ที่ไหน | หมายเหตุ |
|--------|---------|---------|
| `DATABASE_URL` | prisma/schema.prisma | Supabase Postgres connection string (production) |
| `JWT_SECRET` | src/lib/auth.ts | ถ้าไม่มี → auth ทุก route จะ throw error |

> ⚠️ ห้ามใส่ค่า secret ในเอกสารนี้ — ดูเฉพาะใน Vercel env vars หรือ Supabase dashboard

---

## 7. Documents ที่เกี่ยวข้อง (ในโฟลเดอร์ `process/` นี้)

- `PRODUCTION_LINKS.md` — URL ทั้งหมดที่ใช้
- `DEPLOYMENT_RUNBOOK.md` — ขั้นตอน deploy
- `DATABASE_CONTEXT.md` — schema + stock flow
- `BUSINESS_RULES.md` — กฎธุรกิจ
- `CURRENT_OPEN_ISSUES.md` — pending work แยก P0/P1/P2
- `SAFETY_CHECKLIST.md` — migration + deploy checklist

---

## 8. Documents เดิมใน repo

- `docs/FIRST_USE_CHECKLIST.md` — checklist พนักงาน
- `docs/STAFF_TRAINING_SCRIPT.md` — สคริปต์ฝึกงาน

> ⚠️ เอกสารเดิมเขียนตอนที่ codebase มี billNumber + cancel feature — บางส่วนอาจอ้างถึง feature ที่หายไปแล้ว

---

## 9. Critical Warnings

1. **อย่า deploy code โดยไม่ได้ดู diff** — codebase ถูก reset หลายครั้ง
2. **schema.prisma provider ต้องเป็น `postgresql`** ก่อน push/deploy
3. **`db/custom.db` (SQLite binary) ถูก track ใน git** — เป็น pre-existing issue ไม่ควร commit การเปลี่ยนแปลง
4. **ถ้าจะใช้ feature ที่หายไป** (billNumber, cancel, Excel import, weightExpression DB storage) — ต้อง recreate ใหม่ทั้งหมด
5. **migration SQL `add_weight_expression.sql` พร้อม run แต่ถ้า run โดยที่ code ยังไม่ได้ deploy ที่ใช้ weightExpression** — columns จะว่างเปล่า (ไม่เป็นไร เพราะ additive only)
