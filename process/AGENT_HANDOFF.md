# Agent Handoff — ยงเฮง มหาชัย รีไซเคิล

> เอกสารสำหรับ owner ส่งให้ AI Agent ตัวอื่นได้ทันที
> วันที่: 27/06/2569

---

## 1. Project Summary

**โปรเจกต์**: ยงเฮง มหาชัย รีไซเคิล — ระบบบันทึกสต็อกสำหรับร้านรับซื้อเหล็กและโลหะ

**เทคโนโลยี**: Next.js 16 + TypeScript + Prisma + Supabase Postgres + Vercel

**สถานะปัจจุบัน**:
- ✅ ระบบหลักใช้งานได้ (login, buy, sell, sort, stock, history, dashboard)
- ❌ Features ขั้นสูงหายไปจาก codebase (billNumber, cancel, AuditLog, Excel import, weightExpression storage)
- ⏳ รอ owner อนุมัติ migration + recreate features

**Production URL**: https://st-yongheng-recycle.vercel.app
**GitHub**: https://github.com/NUT2550/--ST-yongheng-recycle
**Supabase**: https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx

---

## 2. Current Source of Truth

### เอกสารหลัก (ในโฟลเดอร์ `process/`)
1. `PROJECT_OPERATING_CONTEXT.md` — เอกสารหลัก อ่านก่อน
2. `PRODUCTION_LINKS.md` — URL ทั้งหมด
3. `DEPLOYMENT_RUNBOOK.md` — ขั้นตอน deploy
4. `DATABASE_CONTEXT.md` — schema + stock flow
5. `BUSINESS_RULES.md` — กฎธุรกิจ
6. `CURRENT_OPEN_ISSUES.md` — pending work P0/P1/P2
7. `SAFETY_CHECKLIST.md` — migration + deploy checklist
8. `REBUILD_SPEC.md` — spec สำหรับสร้างระบบใหม่
9. `REPAIR_RUNBOOK.md` — คู่มือซ่อมปัญหา
10. `FEATURE_INVENTORY.md` — ตาราง feature ทั้งหมด
11. `AGENT_HANDOFF.md` — ไฟล์นี้

### Codebase ปัจจุบัน (verified 27/06/2569)
- **15 Prisma models** (ดู DATABASE_CONTEXT.md)
- **22 API routes** (ดู PRODUCTION_LINKS.md)
- **11 page components** (ดู PROJECT_OPERATING_CONTEXT.md)
- **9 lib files** (auth, api, db, helpers, safe-math, store, types, utils, auth-constants)

### Worklog
- `worklog.md` ใน repo — บันทึก Task 1-24 (บาง task หายไปจาก codebase แต่มีบันทึก)
- **อ่านก่อนเริ่มงาน** เพื่อเข้าใจ context

---

## 3. Safe Operating Rules

### ✅ ทำได้
- อ่าน code + docs
- รัน `bun run lint`, `npx tsc --noEmit`
- รัน `bun run dev` (local — ถ้ามี JWT_SECRET ใน .env)
- แก้ code + ทดสอบ local
- สร้าง migration SQL (additive only)
- สร้าง docs
- Commit ใน local (แต่ห้าม push โดยไม่ได้รับอนุมัติ)

### ❌ ห้าม (เด็ดขาด)
- ห้ามใส่ secret ใน code/docs (DATABASE_URL value, password, JWT_SECRET value, API key)
- ห้าม `git push` โดยไม่ได้รับอนุมัติ
- ห้าม deploy โดยไม่ได้รับอนุมัติ
- ห้าม migrate production DB โดยไม่ได้รับอนุมัติ
- ห้าม `prisma migrate reset` บน production
- ห้าม `bun run prisma/seed.ts` บน production
- ห้าม hard delete bill ใน DB
- ห้ามแก้ stock ตรงๆ ใน DB
- ห้าม `eval()` หรือ `new Function()`
- ห้าม hardcode password ใน source
- ห้าม commit `.env`
- ห้าม commit `db/custom.db`
- ห้ามตั้ง `typescript.ignoreBuildErrors: true`
- ห้ามเปลี่ยน schema.prisma provider เป็น sqlite แล้ว commit
- ห้าม auto-match สินค้าข้ามหมวดวัสดุ
- ห้ามลบ AuditLog entries

---

## 4. Current Known Risks

### 🔴 Critical
1. **Features หายไปจาก codebase** — billNumber, cancel, AuditLog, Excel import, weightExpression storage
   - ต้อง recreate ทั้งหมด (ดู FEATURE_INVENTORY.md)
2. **DB schema ไม่ match features ที่จะ rebuild**
   - ต้อง migrate ก่อน push code ใหม่
3. **`db/custom.db` ถูก track ใน git** — pre-existing issue
4. **`next.config.ts` มี `typescript.ignoreBuildErrors: true`** — Vercel build ผ่านทั้งที่มี type error

### 🟡 Warning
1. **`.env` local ไม่มี `JWT_SECRET`** — dev server จะ fail
2. **`prisma/schema.prisma` provider = postgresql แต่ .env DATABASE_URL = SQLite path** — local test ต้องเปลี่ยน provider ชั่วคราว (แล้ว revert ก่อน commit)
3. **User 01 role ใน production ไม่แน่ใจ** — worklog Task 18 บอกว่าเป็น admin แต่ seed.ts สร้างเป็น staff
4. **User 04 ยังไม่ได้สร้าง** — ไม่มี script สร้าง

### 🟢 Info
1. **docs เดิม (FIRST_USE_CHECKLIST.md, STAFF_TRAINING_SCRIPT.md)** เขียนตอนที่มี billNumber + cancel — บางส่วนอ้างถึง feature ที่หายไป
2. **Supabase project ref `wefqhunzjvsxciiwdhjx`** อยู่ใน docs — เป็น project ID ไม่ใช่ secret

---

## 5. Priority Order (สำหรับ AI Agent ทำงานต่อ)

### Phase 1: Verify Current Codebase
**เป้าหมาย**: ทำความเข้าใจสถานะปัจจุบันให้ชัดเจน

1. อ่าน `process/PROJECT_OPERATING_CONTEXT.md`
2. อ่าน `process/FEATURE_INVENTORY.md`
3. ตรวจ codebase state:
   ```bash
   cd /home/z/my-project
   grep "provider" prisma/schema.prisma  # ต้องเป็น postgresql
   grep -c "billNumber" prisma/schema.prisma  # ถ้า 0 → feature หาย
   find src/app/api -name "route.ts" | sort
   bun run lint
   ```
4. รายงานสถานะกลับ (ดู Section 8)

### Phase 2: Stabilize Existing Buy/Sell/Sort/Stock
**เป้าหมาย**: ให้ระบบปัจจุบันใช้งานได้ปลอดภัย

1. ตรวจ lint ผ่าน
2. ตรวจ tsc ไม่มี error ใหม่ (errors ใน examples/skills เป็น pre-existing)
3. ตรวจ JWT_SECRET ใน Vercel env vars
4. ตรวจ user 01 role ใน production DB
5. ตรวจ db/custom.db ไม่ถูก commit ใน diff ถัดไป

### Phase 3: Rebuild billNumber + cancel + AuditLog
**เป้าหมาย**: คืน features ที่จำเป็นสำหรับใช้งานจริง

1. อ่าน `process/REBUILD_SPEC.md` Section 5, 6, 7, 8, 12
2. เพิ่ม fields ใน schema.prisma:
   - `BuyBill.billNumber`, `isCancelled`, `cancelledAt`, `cancelledBy`, `cancelReason`
   - `SellBill` (เหมือนกัน)
   - `SortingBill` (เหมือนกัน)
   - สร้าง `AuditLog` model
3. สร้าง migration SQL (additive only)
4. สร้าง `src/lib/bill-helpers.ts` (generateBillNumber + writeAuditLog)
5. อัปเดต POST routes ให้ generate billNumber + write AuditLog
6. สร้าง `src/app/api/{buy,sell,sorting}-bills/[id]/route.ts` พร้อม DELETE handler
7. อัปเดต history-page.tsx ให้แสดง billNumber + cancel button
8. **ทดสอบ local ก่อน push**

### Phase 4: Rebuild Excel Import
**เป้าหมาย**: คืนความสามารถ import บิลจาก Excel

1. อ่าน `process/REBUILD_SPEC.md` Section 10
2. สร้าง `src/app/api/excel/parse/route.ts` (TIS-620 encoding support)
3. สร้าง `src/components/excel-import-dialog.tsx` (preview + auto-match)
4. เพิ่มปุ่ม import ใน buy-page.tsx
5. ทดสอบกับไฟล์ Excel จริง

### Phase 5: Rebuild Product Alias
**เป้าหมาย**: คืนความสามารถ map สินค้าเดิม → ใหม่

1. อ่าน `process/BUSINESS_RULES.md` Section 3 (Cross-Category Prohibition)
2. สร้างไฟล์ mapping CSV (ต้องการ Excel เดิมของ owner)
3. ประยุกต์ owner business rules
4. (Optional) สร้าง ProductAlias table + import logic

### Phase 6: Rebuild Weight Formula Tracking
**เป้าหมาย**: คืนความสามารถเก็บสูตรใน DB

1. อ่าน `process/REBUILD_SPEC.md` Section 11
2. รัน migration SQL `prisma/migrations/add_weight_expression.sql` (หลัง owner อนุมัติ)
3. เพิ่ม weightExpression ใน schema.prisma (5 fields)
4. เพิ่มใน types.ts
5. อัปเดต 3 API routes (buy/sell/sorting) ให้รับ + เก็บ weightExpression
6. อัปเดต 4 UI pages (buy/sell/sort/history) ให้แสดง live preview + formula hint
7. ทดสอบ end-to-end

---

## 6. Standard Prompt Template สำหรับสั่ง AI Agent ซ่อม

### Template A: ซ่อมปัญหาเฉพาะจุด

```
Task: Repair <feature/issue name>

Context:
- Project: ยงเฮง มหาชัย รีไซเคิล (Next.js + Prisma + Supabase)
- อ่านเอกสาร: process/AGENT_HANDOFF.md, process/REPAIR_RUNBOOK.md, process/FEATURE_INVENTORY.md
- Codebase: /home/z/my-project

อาการ:
<อธิบายปัญหาที่เกิด>

ขอบเขต:
- ซ่อมเฉพาะปัญหานี้
- ห้ามแก้ code อื่น
- ห้าม push/deploy โดยไม่ได้รับอนุมัติ

ข้อห้าม:
- ห้ามใส่ secret ใน code/docs
- ห้าม migrate DB โดยไม่ได้รับอนุมัติ
- ห้าม eval() หรือ new Function()
- ห้าม hardcode password

รายงานกลับ:
1. สาเหตุของปัญหา
2. วิธีแก้ที่ใช้
3. ไฟล์ที่แก้ไข
4. ผลการทดสอบ
5. คำแนะนำขั้นต่อไป
```

### Template B: ซ่อมหลายปัญหาพร้อมกัน

```
Task: Multi-issue Repair

Context:
- Project: ยงเฮง มหาชัย รีไซเคิล
- อ่านเอกสาร: process/AGENT_HANDOFF.md (ทั้งหมดใน process/)
- Codebase: /home/z/my-project

ปัญหาที่ต้องซ่อม:
1. <ปัญหาที่ 1>
2. <ปัญหาที่ 2>
3. <ปัญหาที่ 3>

ลำดับความสำคัญ:
- ปัญหา 1: P0 (บล็อกการใช้งาน)
- ปัญหา 2: P1 (ควรซ่อม)
- ปัญหา 3: P2 (ทำทีหลังได้)

ขอบเขต:
- ซ่อมตามลำดับ priority
- ถ้าปัญหา P0 ต้อง migrate DB → ห้าม migrate โดยไม่ได้รับอนุมัติ
- แจ้ง owner ก่อน ถ้าต้องแก้ข้ามปัญหา

ข้อห้าม: <ดู Section 3 ของ AGENT_HANDOFF.md>

รายงานกลับ:
1. ปัญหาที่ซ่อมสำเร็จ (ตามลำดับ)
2. ปัญหาที่ยังค้าง + เหตุผล
3. ไฟล์ที่แก้ไขทั้งหมด
4. การทดสอบที่ผ่าน
5. คำแนะนำขั้นต่อไป
```

---

## 7. Standard Prompt Template สำหรับสั่ง AI Agent Rebuild

### Template C: Rebuild ระบบใหม่ทั้งหมด

```
Task: Rebuild ยงเฮง มหาชัย รีไซเคิล system from scratch

Context:
- อ่านเอกสาร: process/REBUILD_SPEC.md (full spec)
- อ่านเอกสาร: process/BUSINESS_RULES.md (กฎธุรกิจ)
- อ่านเอกสาร: process/FEATURE_INVENTORY.md (features ทั้งหมด)
- อ่านเอกสาร: process/DATABASE_CONTEXT.md (schema + stock flow)

เป้าหมาย:
สร้างระบบใหม่ที่มีฟีเจอร์เทียบเท่าระบบปัจจุบัน + features ที่หายไป

Tech Stack (บังคับ):
- Next.js 16 + TypeScript 5
- Prisma 6 + Supabase Postgres
- Tailwind CSS 4 + shadcn/ui
- JWT (jose) + bcryptjs
- Zustand

Acceptance Criteria: <ดู REBUILD_SPEC.md Section 14>

ข้อห้าบ:
- ห้ามใช้ eval() หรือ new Function()
- ห้าม hardcode password
- ห้าม ignore type errors
- ห้าม auto-match สินค้าข้ามหมวดวัสดุ

รายงานกลับ:
1. Phase ที่ทำเสร็จ
2. Features ที่ rebuild สำเร็จ
3. การทดสอบที่ผ่าน
4. ปัญหาที่เจอ
5. คำแนะนำขั้นต่อไป
```

### Template D: Rebuild feature เฉพาะ

```
Task: Rebuild <feature name>

Context:
- อ่านเอกสาร: process/REBUILD_SPEC.md Section <ที่เกี่ยวข้อง>
- อ่านเอกสาร: process/FEATURE_INVENTORY.md (สถานะ feature)
- Codebase: /home/z/my-project

เป้าหมาย:
Rebuild <feature> ให้กลับมาใช้งานได้

ขั้นตอน:
1. อ่าน spec ใน REBUILD_SPEC.md
2. ตรวจ codebase ปัจจุบัน — มีอะไรอยู่แล้วบ้าง
3. สร้าง/แก้ไขไฟล์ที่จำเป็น
4. ทดสอบ local
5. ถ้าต้อง migrate DB → เตรียม SQL แต่ห้าม run โดยไม่ได้รับอนุมัติ

ข้อห้าม: <ดู Section 3 ของ AGENT_HANDOFF.md>

รายงานกลับ:
1. ไฟล์ที่สร้าง/แก้ไข
2. การทดสอบที่ผ่าน
3. SQL migration ที่ต้องการ (ถ้ามี)
4. คำแนะนำขั้นต่อไป
```

---

## 8. Required Report Format (AI Agent ต้องตอบกลับ)

### หลังทำงานเสร็จ ต้องรายงานในรูปแบบนี้:

```markdown
# Work Report — <Task name>

**Date**: <วันที่>
**Agent**: <ชื่อ agent>
**Duration**: <ระยะเวลา>

## สรุป
<บรรทัดเดียวสรุปงาน>

## งานที่ทำ
1. <step 1>
2. <step 2>
3. <step 3>

## ไฟล์ที่แก้ไข
| ไฟล์ | การเปลี่ยนแปลง |
|-----|---------------|
| <path> | <สรุป> |

## การทดสอบ
- [x] <test 1 ที่ผ่าน>
- [x] <test 2 ที่ผ่าน>
- [ ] <test 3 ที่ยังไม่ผ่าน>

## ปัญหาที่เจอ
1. <ปัญหา 1 + วิธีแก้>
2. <ปัญหา 2 + วิธีแก้>

## Migration ที่ต้องการ (ถ้ามี)
```sql
<SQL script>
```

## ข้อห้ามที่ปฏิบัติตาม
- ✅ ไม่ใส่ secret ใน code/docs
- ✅ ไม่ push/deploy โดยไม่ได้รับอนุมัติ
- ✅ ไม่ migrate DB โดยไม่ได้รับอนุมัติ
- ✅ ไม่ eval() หรือ new Function()
- ✅ ไม่ hardcode password

## คำแนะนำขั้นต่อไป
1. <recommendation 1>
2. <recommendation 2>

## คำถามสำหรับ owner (ถ้ามี)
1. <question 1>
2. <question 2>
```

---

## 9. วิธีเริ่มต้น (Quick Start สำหรับ AI Agent ใหม่)

```bash
# 1. Clone repo (ถ้ายังไม่ได้)
git clone https://github.com/NUT2550/--ST-yongheng-recycle.git
cd --ST-yongheng-recycle

# 2. Install dependencies
bun install

# 3. อ่านเอกสารหลัก
cat process/PROJECT_OPERATING_CONTEXT.md
cat process/FEATURE_INVENTORY.md
cat worklog.md | tail -100  # ดูงานล่าสุด

# 4. ตรวจสถานะ codebase
grep "provider" prisma/schema.prisma  # ต้องเป็น postgresql
bun run lint
find src/app/api -name "route.ts" | sort

# 5. ตั้งค่า local dev (ถ้าต้องทดสอบ)
echo "DATABASE_URL=file:./dev.db" > .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
# เปลี่ยน schema.prisma provider เป็น sqlite ชั่วคราว (REVERT ก่อน commit!)
bun run db:push
bun run prisma/seed.ts

# 6. เริ่ม dev server
bun run dev
# เปิด http://localhost:3000

# 7. ทำงานตาม priority ใน Section 5
```

---

## 10. ข้อมูลติดต่อ / Escalation

### ถ้าเจอปัญหาที่ไม่รู้จัก
1. อ่าน `process/REPAIR_RUNBOOK.md` Section 19 (Decision Tree)
2. อ่าน `worklog.md` — อาจมีบันทึกปัญหาเดิม
3. รายงาน owner พร้อมรายละเอียด:
   - อาการ
   - สิ่งที่ลองทำ
   - error message หรือ log
   - ไฟล์ที่เกี่ยวข้อง

### ถ้าต้องการข้อมูลเพิ่มเติม
- **Owner decisions** (business rules): ดู `process/BUSINESS_RULES.md`
- **Database schema**: ดู `prisma/schema.prisma` หรือ `process/DATABASE_CONTEXT.md`
- **API routes**: ดู `src/app/api/` หรือ `process/PRODUCTION_LINKS.md`
- **Pending work**: ดู `process/CURRENT_OPEN_ISSUES.md`

### ห้าม
- 🚫 ห้ามตัดสินใจแทน owner ในเรื่อง business rules
- 🚫 ห้าม push/deploy/migrate โดยไม่ได้รับอนุมัติ
- 🚫 ห้ามแก้ secret หรือ password
- 🚫 ห้ามลบ data ใดๆ ใน production DB

---

## 11. Checklist สำหรับ AI Agent ก่อนส่งมอบงาน

ก่อนรายงานว่างานเสร็จ ต้องตรวจ:

- [ ] อ่าน `process/AGENT_HANDOFF.md` (ไฟล์นี้) แล้ว
- [ ] ปฏิบัติตามข้อห้ามทั้งหมดใน Section 3
- [ ] ไม่มี secret ใน code/diff
- [ ] `bun run lint` ผ่าน (exit 0)
- [ ] `grep "provider" prisma/schema.prisma` = `postgresql`
- [ ] `git diff` ไม่มี `.env` หรือ `db/custom.db`
- [ ] ทดสอบ local ผ่าน (ถ้าเกี่ยวข้องกับ code)
- [ ] เขียน report ตาม format ใน Section 8
- [ ] ถ้ามี migration → เตรียม SQL แต่ห้าม run
- [ ] ถ้าต้อง push/deploy → แจ้ง owner ขออนุมัติก่อน

---

## สรุป

เอกสารนี้เป็น **handoff document** สำหรับ AI Agent ตัวอื่นที่จะรับงานต่อ

**สิ่งสำคัญที่ต้องจำ**:
1. อ่าน `process/` ทั้งหมดก่อนเริ่ม
2. ปฏิบัติตามข้อห้ามใน Section 3
3. ทำตาม priority ใน Section 5
4. รายงานตาม format ใน Section 8
5. ห้าม push/deploy/migrate โดยไม่ได้รับอนุมัติ

**ดูเอกสารประกอบ**:
- `REBUILD_SPEC.md` — ถ้าต้องสร้างระบบใหม่/feature ใหม่
- `REPAIR_RUNBOOK.md` — ถ้าต้องซ่อมปัญหา
- `FEATURE_INVENTORY.md` — ถ้าต้องการรู้สถานะ feature
- `BUSINESS_RULES.md` — ถ้าต้องการรู้กฎธุรกิจ
- `SAFETY_CHECKLIST.md` — ถ้าต้อง deploy/migrate
