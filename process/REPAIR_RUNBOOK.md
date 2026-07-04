# Repair Runbook — ยงเฮง มหาชัย รีไซเคิล

> คู่มือซ่อมเมื่อเกิดปัญหา — ใช้ตามลำดับ ห้ามข้ามขั้น
> วันที่: 27/06/2569

---

## 1. วิธีตรวจสถานะเบื้องต้นก่อนซ่อม

### 1.1 ตรวจ Production
```bash
# Production app ยังใช้ได้ไหม
curl -sS -o /dev/null -w "%{http_code}\n" https://st-yongheng-recycle.vercel.app/
# Expected: 200

# API auth ทำงานไหม
curl -sS -o /dev/null -w "%{http_code}\n" https://st-yongheng-recycle.vercel.app/api/products
# Expected: 401 (needs token)
```

### 1.2 ตรวจ Codebase State
```bash
cd /home/z/my-project

# Schema provider ถูกต้องไหม
grep "provider" prisma/schema.prisma
# Expected: provider = "postgresql"

# มี features ที่จำเป็นไหม
grep -c "billNumber" prisma/schema.prisma
# Expected: 3+ (BuyBill, SellBill, SortingBill)
# ถ้า 0 → cancel feature หายไป ดู Section 11

# Lint ผ่านไหม
bun run lint
# Expected: exit 0

# TypeScript errors
npx tsc --noEmit 2>&1 | grep "^src/" | head -10
# ถ้ามี error ใน src/ → ดู Section 13
```

### 1.3 ตรวจ Local Dev
```bash
# มี JWT_SECRET ไหม
grep JWT_SECRET .env
# ถ้าไม่มี → ดู Section 14

# Dev server รันได้ไหม
bun run dev
# ถ้า error → ดู Section 14
```

---

## 2. Login ไม่ได้

### อาการ
- หน้า login ขาว
- กด login แล้ว error 500
- กด login แล้วไม่เกิดอะไรขึ้น

### วิธีตรวจ
```bash
# 1. ดู Vercel logs
# https://vercel.com/dashboard → project → Logs
# หา error ใน /api/auth/login

# 2. ตรวจ JWT_SECRET env var
# Vercel: Settings → Environment Variables
# ต้องมี JWT_SECRET ใน Production environment

# 3. ตรวจใน DB ว่า user มีอยู่
# Supabase SQL Editor:
SELECT username, role, "isActive" FROM "User";
```

### วิธีแก้

#### Case A: ไม่มี JWT_SECRET
```bash
# Vercel: Settings → Environment Variables → Add
# Name: JWT_SECRET
# Value: <random string อย่างน้อย 32 chars>
# Environments: Production, Preview, Development
# แล้ว Redeploy
```

#### Case B: User ไม่ active
```sql
-- Supabase SQL Editor
UPDATE "User" SET "isActive" = true WHERE username = '01';
```

#### Case C: Password ผิด
```bash
# Reset password ผ่าน script
cd /home/z/my-project
bun run prisma/create-user-01.ts <new_password>
# (ใช้กับ local DB เท่านั้น — สำหรับ production ต้องแก้ใน DB ตรงๆ หรือสร้าง reset script)
```

#### Case D: หน้า login ขาว (hydration error)
```bash
# ดู browser console (F12)
# ถ้าเจอ hydration mismatch → ตรวจ page.tsx ว่ามี early return ก่อน hooks
# Hooks ต้องอยู่ก่อน early returns เสมอ
```

---

## 3. Buy สร้างบิลไม่ได้

### อาการ
- กด "บันทึกใบรับซื้อ" แล้ว error
- Cart ไม่ add รายการ
- ไม่มี toast อะไรเลย

### วิธีตรวจ
```bash
# 1. ดู Vercel logs ตอนกด submit
# หา POST /api/buy-bills → status code

# 2. ทดสอบ API ตรงๆ
TOKEN=<login token จาก /api/auth/login>
curl -sS -X POST https://st-yongheng-recycle.vercel.app/api/buy-bills \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-27T10:00:00.000Z","isCredit":false,"items":[{"productId":"<valid_id>","weight":10,"pricePerKg":5}]}'

# 3. ตรวจ DB ว่าสินค้ามีอยู่จริง
SELECT id, name FROM "Product" LIMIT 5;
```

### วิธีแก้

#### Case A: weight validation fail
- ตรวจว่า weight > 0 (API บังคับ)
- ถ้าใส่ formula เช่น `860-` → จะ error "สูตรไม่สมบูรณ์"

#### Case B: สินค้าไม่มีใน DB
```sql
-- ตรวจ products count
SELECT COUNT(*) FROM "Product";
-- Expected: 56
-- ถ้า 0 → ต้อง seed ใหม่ (เฉพาะ local — ห้าม seed production)
```

#### Case C: DB connection fail
- ตรวจ DATABASE_URL ใน Vercel env vars
- ตรวจ Supabase project ยัง active ไหม

#### Case D: Cart state หาย
- ลอง refresh page
- ตรวจว่า Zustand store ทำงาน (ดู `src/lib/store.ts`)

---

## 4. Sell ตัด stock ผิด

### อาการ
- ขายแล้ว stock ไม่ลด
- ขายแล้ว stock ติดลบ
- costPerKg ผิดปกติ

### วิธีตรวจ
```sql
-- ดู StockLot ทั้งหมดของสินค้า
SELECT id, "remainingWeight", "costPerKg", "dateAdded", source
FROM "StockLot"
WHERE "productId" = '<product_id>' AND "remainingWeight" > 0
ORDER BY "dateAdded" ASC;
```

### วิธีแก้

#### Case A: stock ไม่ลด
- ตรวจว่า FIFO deduction ทำงาน
- ดู `/api/sell-bills/route.ts` บรรทัด `deductStockFIFO()`
- ตรวจ transaction commit สำเร็จ

#### Case B: stock ติดลบ
- 🚨 **อย่าแก้โดยตรง** ใน DB
- ใช้ cancel bill (ถ้ามี) เพื่อ restore
- ถ้าไม่มี cancel → ต้อง recreate cancel feature (Section 11)

#### Case C: costPerKg ผิด
- ตรวจว่า FIFO ใช้ lot เก่าก่อน (orderBy `dateAdded ASC`)
- ตรวจ weighted average calc: `totalCost / weight`

---

## 5. Sorting stock เพี้ยน

### อาการ
- source stock ไม่ลด
- output stock ไม่เพิ่ม
- lossWeight ผิด

### วิธีตรวจ
```sql
-- ดู SortingBill
SELECT id, "sourceProductId", "sourceWeight", "weighedTotal", "lossWeight", "lossCost"
FROM "SortingBill"
ORDER BY "createdAt" DESC LIMIT 5;

-- ดู source stock
SELECT * FROM "StockLot"
WHERE "productId" = '<source_product_id>'
ORDER BY "dateAdded" ASC;
```

### วิธีแก้

#### Case A: source stock ไม่ลด
- ตรวจ `/api/sorting-bills/route.ts`
- ตรวจว่า `deductStockFIFO(sourceProductId, sourceWeight, tx)` ถูกเรียก

#### Case B: output stock ไม่เพิ่ม
- ตรวจว่ามี `tx.stockLot.create()` สำหรับแต่ละ non-waste item
- ตรวจ `source = "SORTING"` และ `sourceId = bill.id`

#### Case C: lossWeight ผิด
- lossWeight = sourceWeight - SUM(item.weight)
- ตรวจว่า items weight ถูก sum ถูกต้อง

### หมายเหตุสำคัญ
🚨 SortingBill cancel ไม่ restore output stock **by design**
- ถ้า cancel แล้ว output stock ยังอยู่ → ไม่ใช่ bug
- ดู BUSINESS_RULES.md Section 2

---

## 6. Excel import หายหรือใช้ไม่ได้

### อาการ
- ไม่มีปุ่ม "Import จาก Excel" ในหน้า Buy
- กดปุ่มแล้ว error
- Import แล้วภาษาไทยเพี้ยน

### วิธีตรวจ
```bash
# 1. ตรวจว่ามี Excel route ไหม
ls src/app/api/excel/ 2>&1
# ถ้าไม่มี → Excel import feature หายไป

# 2. ตรวจว่ามี dialog component ไหม
ls src/components/excel-import-dialog.tsx 2>&1
# ถ้าไม่มี → ต้อง recreate

# 3. ตรวจ buy-page มี import button ไหม
grep -n "Excel\|excel" src/components/buy-page.tsx
```

### วิธีแก้

#### Case A: Feature หายไปทั้งหมด
- ต้อง recreate Excel import feature
- ดู REBUILD_SPEC.md Section 10

#### Case B: TIS-620 encoding ผิด
- ใช้ `iconv-lite` หรือ `Buffer` แปลง encoding
- ตรวจว่าใช้ `windows-874` หรือ `tis-620` ที่ถูกต้อง

#### Case C: Auto-match ผิดหมวด
- 🚨 ห้าม auto-match ข้ามหมวดวัสดุ
- ดู BUSINESS_RULES.md Section 3

---

## 7. Product combobox ใช้ไม่ได้

### อาการ
- กด dropdown แล้วไม่เปิด
- พิมพ์ค้นหาแล้วไม่ filter
- เลือกแล้วค่าไม่เปลี่ยน

### วิธีตรวจ
```bash
# 1. ตรวจ component
ls src/components/ui/product-combobox.tsx
# ถ้าไม่มี → ต้อง recreate

# 2. ตรวจการใช้งาน
grep -n "ProductCombobox" src/components/buy-page.tsx
```

### วิธีแก้

#### Case A: Component หาย
- Recreate `src/components/ui/product-combobox.tsx`
- ใช้ Popover + Command (cmdk) components

#### Case B: props ผิด
- ตรวจ props: `groups`, `value`, `onValueChange`, `placeholder`, `searchPlaceholder`, `renderLabel`
- ตรวจ type `ProductComboboxGroup`

#### Case C: ไม่ filter
- ตรวจ Command component filter logic
- ตรวจว่า `renderLabel` ส่งค่าที่ค้นหาได้

---

## 8. Formula น้ำหนักผิด

### อาการ
- พิมพ์ `860-3` → ผลลัพธ์ไม่ใช่ 857
- พิมพ์ `860-3` → error ทั้งที่ควรผ่าน
- Live preview ไม่แสดง

### วิธีตรวจ
```bash
# ทดสอบ parser ตรงๆ
cd /home/z/my-project
bun -e "
const { parseWeightExpression, previewWeightValue } = require('./src/lib/safe-math');
console.log('860-3:', parseWeightExpression('860-3'));
console.log('preview 860-3:', previewWeightValue('860-3'));
console.log('1000-15-2:', parseWeightExpression('1000-15-2'));
console.log('(1000-10)/2:', parseWeightExpression('(1000-10)/2'));
"
```

### ผลลัพธ์ที่คาดหวัง
```
860-3: { expression: '860-3', value: 857, isFormula: true }
preview 860-3: 857
1000-15-2: { expression: '1000-15-2', value: 983, isFormula: true }
(1000-10)/2: { expression: '(1000-10)/2', value: 495, isFormula: true }
```

### วิธีแก้

#### Case A: parser error
- ตรวจ `src/lib/safe-math.ts`
- ตรวจ recursive descent parser logic
- ห้ามใช้ `eval()`

#### Case B: live preview ไม่แสดง
- ตรวจ buy/sell/sort page ว่ามี `previewWeightValue()` call
- ตรวจ conditional render

#### Case C: input เปลี่ยนเป็นค่าตัวเลขหลัง Enter
- 🚨 ผิด — input ต้องยังเป็น expression
- ตรวจ onKeyDown handler — ห้าม `setWeight(result.value)`

---

## 9. History ไม่แสดง

### อาการ
- หน้า history ว่าง
- คลิก bill แล้วไม่ขยาย
- ข้อมูล bill หาย

### วิธีตรวจ
```bash
# 1. ตรวจ API
TOKEN=<token>
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://st-yongheng-recycle.vercel.app/api/buy-bills?page=1&limit=10

# 2. ตรวจ DB
SELECT COUNT(*) FROM "BuyBill";
SELECT COUNT(*) FROM "SellBill";
SELECT COUNT(*) FROM "SortingBill";
```

### วิธีแก้

#### Case A: ไม่มี bills ใน DB
- ปกติถ้าระบบใหม่ — ต้องสร้าง bill ก่อน

#### Case B: API return 401
- token หมดอายุ → login ใหม่

#### Case C: Collapsible ไม่ทำงาน
- ตรวจ `src/components/history-page.tsx`
- ตรวจ `expandedIds` state
- ตรวจ `Collapsible` component

---

## 10. Dashboard ตัวเลขผิด

### อาการ
- ยอดวันนี้ = 0 ทั้งที่มี transaction
- recent bills ไม่แสดง
- category summary ผิด

### วิธีตรวจ
```sql
-- ตรวจยอดวันนี้
SELECT
  COUNT(*) FILTER (WHERE date::date = NOW()::date) AS bills_today,
  COALESCE(SUM("totalAmount") FILTER (WHERE date::date = NOW()::date), 0) AS amount_today
FROM "BuyBill";
```

### วิธีแก้

#### Case A: Timezone ผิด
- ตรวจ `src/app/api/dashboard/route.ts`
- ตรวจว่าใช้ `NOW()` ของ Postgres (อาจเป็น UTC) หรือเปลี่ยนเป็น Asia/Bangkok

#### Case B: stock summary ผิด
- ตรวจ SUM query ใน dashboard route
- ตรวจว่ากรอง `remainingWeight > 0`

---

## 11. Deploy พัง

### อาการ
- Vercel build fail
- Build success แต่ runtime error
- หน้าเว็บขาว

### วิธีตรวจ
```bash
# 1. ดู Vercel build logs
# https://vercel.com/dashboard → project → latest deployment → Build Logs

# 2. ตรวจ local build
cd /home/z/my-project
bun run lint
npx tsc --noEmit 2>&1 | grep "^src/" | head -20

# 3. ตรวจ next.config
cat next.config.ts
# ถ้ามี typescript.ignoreBuildErrors: true → อันตราย (Section 12)
```

### วิธีแก้

#### Case A: TypeScript errors
- แก้ type errors ทั้งหมด
- ห้ามตั้ง `ignoreBuildErrors: true`

#### Case B: Missing env vars
- ตรวจ Vercel env vars: `DATABASE_URL`, `JWT_SECRET`

#### Case C: Prisma client ไม่ generate
- ตรวจ `postinstall` script ใน package.json
- ควรมี `prisma generate`

#### Case D: Rollback
```bash
git revert <commit-hash>
git push origin main
# รอ Vercel redeploy
```

---

## 12. Database Migration พัง

### อาการ
- ALTER TABLE fail
- Column ไม่ปรากฏหลัง migration
- Existing data หาย

### วิธีตรวจ
```sql
-- ตรวจ columns ที่คาดว่าจะเพิ่ม
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = '<table_name>'
ORDER BY ordinal_position;

-- ตรวจ row counts (เทียบกับก่อน migration)
SELECT COUNT(*) FROM "<table_name>";
```

### วิธีแก้

#### Case A: Column ไม่เพิ่ม
```sql
-- รัน ALTER อีกครั้ง
ALTER TABLE "<table_name>"
  ADD COLUMN IF NOT EXISTS "<column_name>" TEXT;
```

#### Case B: Data หาย
- 🚨 **หยุดทันที**
- Restore จาก Supabase backup
- https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups

#### Case C: Rollback migration
```sql
-- ตัวอย่าง rollback weightExpression
ALTER TABLE "BuyBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SellBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBillItem" DROP COLUMN IF EXISTS "weightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "sourceWeightExpression";
ALTER TABLE "SortingBill" DROP COLUMN IF EXISTS "weighedTotalExpression";
```

---

## 13. Prisma client / type error

### อาการ
- `Property 'X' does not exist on type 'Y'`
- `prisma generate` ไม่ update types

### วิธีตรวจ
```bash
# 1. ตรวจ schema
cat prisma/schema.prisma | grep -A 10 "model BuyBillItem"

# 2. ตรวจ generated client
ls node_modules/@prisma/client/index.d.ts 2>&1
# ถ้าไม่มี → run prisma generate

# 3. Run generate
bun run db:generate
```

### วิธีแก้

#### Case A: Schema ไม่ match DB
- Production DB อาจมี column ที่ schema ไม่มี (หรือกลับกัน)
- รัน migration ให้ตรงกัน

#### Case B: Client stale
```bash
bun run db:generate
# หรือ
bun x prisma generate
```

#### Case C: Vercel build ไม่ generate
- ตรวจ `postinstall` script
- ควรมี: `"postinstall": "prisma generate"`

---

## 14. Vercel build ผ่านทั้งที่ type error (เพราะ ignoreBuildErrors)

### อาการ
- Local `npx tsc --noEmit` มี error
- แต่ Vercel build success
- Runtime พัง

### วิธีตรวจ
```bash
cat next.config.ts | grep ignoreBuildErrors
# ถ้าเจอ true → นี่คือสาเหตุ
```

### วิธีแก้
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  // ลบบรรทัดนี้ออก:
  // typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
};
```

จากนั้นแก้ type errors ทั้งหมดจน `npx tsc --noEmit` ผ่าน

---

## 15. Local dev fail เพราะขาด JWT_SECRET

### อาการ
```
Error: JWT_SECRET environment variable is required. Set it in .env or Vercel env vars.
```

### วิธีแก้
```bash
cd /home/z/my-project

# ตรวจ .env
cat .env
# ถ้าไม่มี JWT_SECRET → เพิ่ม

# เพิ่ม JWT_SECRET (random string)
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# รีสตาร์ท dev server
# (Ctrl+C แล้ว bun run dev ใหม่)
```

> ⚠️ อย่า commit `.env` (มันถูก gitignore อยู่แล้ว แต่ระวัง)

---

## 16. วิธีตรวจ stock ก่อน/หลัง

### ก่อนแก้/ก่อน cancel
```sql
-- บันทึก stock ปัจจุบัน
SELECT
  p.id,
  p.name,
  COALESCE(SUM(sl."remainingWeight"), 0) AS total_weight,
  COALESCE(SUM(sl."remainingWeight" * sl."costPerKg"), 0) AS total_cost
FROM "Product" p
LEFT JOIN "StockLot" sl ON sl."productId" = p.id AND sl."remainingWeight" > 0
GROUP BY p.id, p.name
ORDER BY p.name;
```

### หลังแก้/หลัง cancel
- รัน query เดิมอีกครั้ง
- เปรียบเทียบ — ต้องเท่าเดิม (ถ้า cancel สำเร็จ)

### ตรวจเฉพาะ product
```sql
SELECT
  sl.id,
  sl."remainingWeight",
  sl."costPerKg",
  sl.source,
  sl."sourceId",
  sl."dateAdded"
FROM "StockLot" sl
WHERE sl."productId" = '<product_id>'
  AND sl."remainingWeight" > 0
ORDER BY sl."dateAdded" ASC;
```

---

## 17. วิธี rollback ที่ปลอดภัย

### Code rollback
```bash
# 1. ดู commit history
git log --oneline -10

# 2. Revert commit (สร้าง commit ใหม่ที่กลับการเปลี่ยนแปลง)
git revert <commit-hash>
git push origin main

# 3. ห้าม git reset --hard บน main (จะทำลาย history)
```

### Database rollback
```sql
-- 1. ตรวจ backup ล่าสุด
-- https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups

-- 2. Restore จาก backup (ใช้เมื่อข้อมูลพังรุนแรง)

-- 3. สำหรับ column rollback:
ALTER TABLE "<table>" DROP COLUMN IF EXISTS "<column>";

-- 4. สำหรับ table rollback:
DROP TABLE IF EXISTS "<table>";  -- ระวัง! จะลบข้อมูลทั้งหมด
```

### Vercel rollback
- https://vercel.com/dashboard → project → Deployments
- เลือก deployment ก่อนหน้า → "Instant Rollback"

---

## 18. สิ่งที่ห้ามทำเด็ดขาด

### Database
- 🚫 ห้าม `prisma migrate reset` บน production
- 🚫 ห้าม `bun run prisma/seed.ts` บน production
- 🚫 ห้าม `TRUNCATE TABLE` ใดๆ
- 🚫 ห้าม `DELETE FROM "Product"` (จะ break FK)
- 🚫 ห้าม `DROP TABLE` ใดๆ
- 🚫 ห้ามแก้ stock ตรงๆ ใน DB (ใช้ bill/cancel)
- 🚫 ห้าม hard delete bill (ใช้ soft delete `isCancelled = true`)
- 🚫 ห้ามลบ AuditLog entries

### Code
- 🚫 ห้ามใช้ `eval()` หรือ `new Function()`
- 🚫 ห้าม hardcode password หรือ secret
- 🚫 ห้าม commit `.env`
- 🚫 ห้าม commit `db/custom.db`
- 🚫 ห้ามตั้ง `typescript.ignoreBuildErrors: true`
- 🚫 ห้ามเปลี่ยน schema.prisma provider เป็น sqlite แล้ว commit

### Operations
- 🚫 ห้าม deploy โดย DB ยังไม่ได้ migrate
- 🚫 ห้าม push โดยไม่ตรวจ lint
- 🚫 ห้าม push โดยมี secret ใน diff
- 🚫 ห้าม auto-match สินค้าข้ามหมวดวัสดุ
- 🚫 ห้าม ignore error ใน Vercel/Supabase logs

---

## 19. Decision Tree สำหรับปัญหาทั่วไป

```
Production ใช้ไม่ได้?
├── หน้าขาว → ดู Section 11 (Deploy พัง)
├── Login ไม่ได้ → ดู Section 2
├── สร้าง bill ไม่ได้ → ดู Section 3/4/5
├── ข้อมูลเพี้ยน → ดู Section 9/10
└── Feature หาย → ดู Section 6/7/8

Local dev ใช้ไม่ได้?
├── JWT_SECRET error → ดู Section 15
├── DB connection → ดู Section 13
├── Type error → ดู Section 13
└── Lint error → แก้ตาม lint output

ต้อง rollback?
├── Code → ดู Section 17 (git revert)
├── Database → ดู Section 17 (Supabase backup)
└── Vercel → ดู Section 17 (Instant Rollback)
```
