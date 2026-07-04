# Deployment Runbook — ยงเฮง มหาชัย รีไซเคิล

> ขั้นตอน deployment ทั้งหมด — ทำตามได้ทีละขั้น
> วันที่: 27/06/2569

---

## 1. Branch & Deploy Flow

```
Local main  ──push──>  GitHub origin/main  ──auto-deploy──>  Vercel production
```

- **Branch ที่ deploy**: `main` (branch เดียว — ไม่มี staging)
- **Auto-deploy**: ทุก push ไป `main` → Vercel จะ build อัตโนมัติ
- **Build time**: ~1-3 นาที
- **Production URL**: https://st-yongheng-recycle.vercel.app

---

## 2. Commands

### Development (Local sandbox)
```bash
bun run dev          # Start dev server on port 3000
bun run lint         # ESLint check
npx tsc --noEmit     # TypeScript type check (มี error ใน examples/ ที่เป็น pre-existing)
bun run db:push      # Apply Prisma schema → DB (ใช้กับ local SQLite เท่านั้น)
bun run db:generate  # Regenerate Prisma client
```

### Build (Production — Vercel ทำเอง)
```bash
bun run build        # next build + copy standalone files
bun run start        # รัน standalone server (production)
```

> ⚠️ ห้าม run `bun run build` ใน sandbox — ใช้ `bun run dev` เท่านั้น

### Database (Production — Supabase)
- ใช้ Supabase SQL Editor สำหรับ migration ที่ additive (ADD COLUMN, CREATE TABLE)
- ใช้ `prisma db push` เฉพาะ local dev เท่านั้น
- **ห้าม** `prisma migrate dev` หรือ `prisma migrate reset` บน production

---

## 3. Environment Variables

### Required (production)
| ชื่อ | ใช้ที่ไหน | ห้ามขาด? |
|-----|---------|---------|
| `DATABASE_URL` | prisma/schema.prisma + src/lib/db.ts | ✅ ขาดไม่ได้ — Prisma จะ connect ไม่ได้ |
| `JWT_SECRET` | src/lib/auth.ts | ✅ ขาดไม่ได้ — auth.ts จะ throw error ทุก request |

### ตั้งค่าใน Vercel
- https://vercel.com/dashboard → project → Settings → Environment Variables
- ตั้งค่าทั้ง 2 ตัวสำหรับ environment: `Production`, `Preview`, `Development`

### ตั้งค่าใน local sandbox (.env)
```
DATABASE_URL=<local SQLite path หรือ Supabase connection string>
JWT_SECRET=<random string อย่างน้อย 32 chars>
```

> ⚠️ ห้าม commit `.env` — .gitignore บล็อก `.env*` อยู่แล้ว

---

## 4. Pre-deploy Verification

ก่อน push ไป GitHub main ให้ตรวจ:

### 4.1 Schema provider
```bash
grep "provider" prisma/schema.prisma
```
**Expected**: `provider = "postgresql"` (ไม่ใช่ sqlite)

### 4.2 Lint
```bash
bun run lint
```
**Expected**: exit code 0

### 4.3 No secrets in diff
```bash
git diff origin/main..HEAD | grep -iE "password|secret|token|key" | grep -v "REDACTED\|process\.\|env\.\|require\|import"
```
**Expected**: empty output

### 4.4 Git status check
```bash
git status
```
**Expected**: มีเฉพาะไฟล์ที่ตั้งใจเปลี่ยน — ไม่มี `.env`, `db/custom.db`, หรือ temp files

---

## 5. Deploy Steps (Standard)

### Step 1: Commit changes
```bash
git add <files>
git commit -m "feat: <description>"
```

### Step 2: Push
```bash
git push origin main
```

### Step 3: รอ Vercel build
- ไปที่ https://vercel.com/dashboard
- ดู deployment status — รอจนเห็น "Ready" (ปกติ 1-3 นาที)

### Step 4: Smoke test
- เปิด https://st-yongheng-recycle.vercel.app/
- ตรวจ login page แสดง
- Login ด้วย `01` / <password>
- ตรวจ dashboard โหลดสำเร็จ

---

## 6. Deploy with Database Migration

ใช้เมื่อมีการเปลี่ยนแปลง Prisma schema:

### Step 1: Backup Supabase DB
- ไปที่ https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups
- กด "Create backup" ตั้งชื่อ `pre-<feature-name>-migration`

### Step 2: บันทึก row counts ก่อน migration
```sql
-- รันใน Supabase SQL Editor
SELECT 'BuyBill' AS t, COUNT(*) FROM "BuyBill"
UNION ALL SELECT 'SellBill', COUNT(*) FROM "SellBill"
UNION ALL SELECT 'SortingBill', COUNT(*) FROM "SortingBill"
UNION ALL SELECT 'BuyBillItem', COUNT(*) FROM "BuyBillItem"
UNION ALL SELECT 'SellBillItem', COUNT(*) FROM "SellBillItem"
UNION ALL SELECT 'SortingBillItem', COUNT(*) FROM "SortingBillItem"
UNION ALL SELECT 'Product', COUNT(*) FROM "Product"
UNION ALL SELECT 'User', COUNT(*) FROM "User";
```
บันทึกผลลัพธ์ไว้

### Step 3: Run migration SQL ใน Supabase SQL Editor
- วาง SQL จากไฟล์ `prisma/migrations/*.sql`
- กด Run
- ตรวจผลลัพธ์ — ต้องไม่มี error

### Step 4: Verify migration สำเร็จ
- รัน verification queries (มีในไฟล์ migration SQL)
- ตรวจ row counts ต้องเท่ากับ Step 2

### Step 5: Push code ไป GitHub
```bash
git push origin main
```

### Step 6: รอ Vercel deploy แล้ว smoke test
- รอจน Vercel status = Ready
- ทดสอบ feature ใหม่ใน production

---

## 7. Rollback

### 7.1 Rollback code
```bash
git revert <commit-hash>
git push origin main
```

### 7.2 Rollback database migration
```sql
-- ตัวอย่าง rollback สำหรับ weight expression migration:
ALTER TABLE "BuyBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SellBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "sourceWeightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "weighedTotalExpression";
```

### 7.3 Rollback จาก Supabase backup
- ไปที่ https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups
- เลือก backup ก่อน migration
- กด Restore

---

## 8. ข้อห้ามเด็ดขาด

- ❌ ห้าม `prisma migrate reset` บน production
- ❌ ห้าม `prisma db push` บน production (ใช้ SQL Editor แทน)
- ❌ ห้าม seed production DB (`bun run prisma/seed.ts` ใช้ local เท่านั้น)
- ❌ ห้าม hard delete bill ใน DB (ใช้ soft delete ถ้ามี)
- ❌ ห้ามแก้ stock ตรงๆ ใน DB (ใช้ cancel bill เพื่อ restore)
- ❌ ห้าม push โดยไม่ตรวจ schema.prisma provider
- ❌ ห้าม push โดยมี `db/custom.db` ใน diff
- ❌ ห้าม deploy โดย DB ยังไม่ได้ migrate (ถ้ามี schema changes)

---

## 9. การเตรียม Local Dev Environment (ถ้าเริ่มใหม่)

```bash
# 1. Clone repo
git clone https://github.com/NUT2550/--ST-yongheng-recycle.git
cd --ST-yongheng-recycle

# 2. Install dependencies
bun install

# 3. สร้าง .env
echo "DATABASE_URL=file:./dev.db" > .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# 4. สร้าง local DB schema
bun run db:push

# 5. Seed data
bun run prisma/seed.ts

# 6. (Optional) สร้าง user 01
bun run prisma/create-user-01.ts <password>

# 7. Start dev server
bun run dev
```
