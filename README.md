# YH Stock System

ระบบบริหารสต็อกและเอกสารซื้อขายสำหรับธุรกิจรับซื้อเศษเหล็กและโลหะ
พัฒนาสำหรับ บจก. ยงเฮง มหาชัย รีไซเคิล

---

## จุดประสงค์ของระบบ

ระบบบันทึกและบริหารสต็อกสำหรับร้านรับซื้อเหล็กและโลหะ ครอบคลุม:

- การรับซื้อ (Buy) — บันทึกน้ำหนัก ราคา สร้าง StockLot อัตโนมัติ
- การขาย (Sell) — หักสต็อกแบบ FIFO พร้อมคำนวณต้นทุนและกำไร
- การคัดแยก (Sorting) — แยกสินค้าต้นทางเป็นผลผลิตหลายรายการ
- การย้ายสต็อก (Stock Transfer) — ย้ายระหว่างสินค้าด้วย FIFO
- การยกเลิกบิล (Cancellation) — คืนสต็อก ย้อนรายการ บันทึก AuditLog
- การเงิน (Credit) — ติดตามค้างรับ/ค้างจ่าย
- ประวัติและการตรวจสอบ (History & Audit) — ดูประวัติบิลทั้งหมด ย้อนกลับได้

## ฟีเจอร์หลัก

| ฟีเจอร์ | สถานะ | รายละเอียด |
|---------|-------|-----------|
| Login + JWT Auth | ใช้งานได้ | JWT ใน localStorage + Authorization header, แยกบทบาท admin/staff |
| บิลรับซื้อ (Buy) | ใช้งานได้ | สร้างบิล สร้าง StockLot อัตโนมัติ รองรับเครดิตค้างจ่าย |
| บิลขาย (Sell) | ใช้งานได้ | หักสต็อก FIFO คำนวณต้นทุน/กำไร รองรับเครดิตค้างรับ |
| บิลคัดแยก (Sorting) | ใช้งานได้ | หักสต็อกต้นทาง FIFO สร้างผลผลิตหลายรายการ คำนวณโบนัสพนักงาน |
| ใบย้ายสต็อก (Transfer) | ใช้งานได้ | ย้ายสต็อกด้วย FIFO ระหว่างสินค้า |
| ยกเลิกบิล (Cancel) | ใช้งานได้ | คืนสต็อก ย้อน StockMovement บันทึก AuditLog ทำงานใน transaction เดียว |
| ประวัติบิล (History) | ใช้งานได้ | ดูบิลทั้ง 3 ประเภท กรองตามวันที่ แยกบิลยกเลิก |
| สต็อกคงเหลือ | ใช้งานได้ | ดูสต็อกแยกตามหมวดสินค้า |
| Dashboard | ใช้งานได้ | สรุปยอดรับซื้อ/ขาย สถิติ |
| จัดการผู้ใช้ | ใช้งานได้ | เพิ่ม/แก้ไข/ปิดผู้ใช้ กำหนดสิทธิ์ (admin เท่านั้น) |
| จัดการสินค้า | ใช้งานได้ | เพิ่ม/แก้ไข/ลบสินค้าและหมวดหมู่ |
| จัดการลูกค้า | ใช้งานได้ | เพิ่ม/แก้ไขข้อมูลลูกค้า |
| การเงิน (Credit) | ใช้งานได้ | ติดตามค้างรับ/ค้างจ่าย บันทึกการชำระ |
| โบนัสพนักงาน | ใช้งานได้ | คำนวณโบนัสจากการคัดแยกอัตโนมัติ |
| Excel Import | ยังไม่มี | วางไว้ในแผนพัฒนาต่อ |
| Weight Expression | ยังไม่มี | การเก็บสูตรน้ำหนัก (เช่น `860-3`) รอ migration |

## หลักการสำคัญ

1. **ความถูกต้องของสต็อก ต้นทุน และประวัติ เหนือความเร็ว** — ไม่รีบทำรายการที่ผิดพลาด
2. **ตรวจสอบสิทธิ์ก่อนเปลี่ยนแปลงข้อมูล** — ทุก route ตรวจ auth ก่อนเข้าถึง database
3. **Transaction safety** — การยกเลิกบิลทำงานใน Prisma `$transaction` เดียว ถ้า fail จะ rollback ทั้งหมด
4. **Regression prevention** — มี CI checks 5 อย่าง + PostgreSQL runtime tests + static contract tests
5. **GitHub เป็น source of truth ทางเทคนิค** — โค้ด การทดสอบ และหลักฐานทั้งหมดอยู่ใน repository
6. **ต้องได้รับอนุมัติจาก Owner สำหรับการกระทำที่ Production** — ไม่แก้ไข ย้าย หรือลบข้อมูลจริงโดยไม่ได้รับอนุมัติ

## เทคโนโลยี

| ชั้น | เทคโนโลยี |
|------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| Runtime | Bun (dev) / Node.js (production บน Vercel) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | PostgreSQL (Supabase production / SQLite local dev) |
| ORM | Prisma 6 |
| Auth | JWT (jose) + bcryptjs |
| State | Zustand (client) + TanStack Query (server) |
| Icons | lucide-react |
| CI/CD | GitHub Actions + Vercel (auto-deploy จาก main) |

## เริ่มต้นใช้งานสำหรับนักพัฒนา

### สิ่งที่ต้องมี

- [Bun](https://bun.sh/) 1.3+ (หรือ Node.js 20+)
- PostgreSQL (หรือใช้ SQLite สำหรับ local dev)

### การติดตั้ง

```bash
git clone https://github.com/NUT2550/--ST-yongheng-recycle.git
cd --ST-yongheng-recycle
bun install
bun run db:generate
```

### ตัวแปรสภาพแวดล้อม (Environment Variables)

สร้างไฟล์ `.env` ใน root directory:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/yh_stock
JWT_SECRET=your-secret-key
```

> **ห้าม** commit ไฟล์ `.env` หรือใส่ค่าจริงใน repository

### คำสั่งสำคัญ

| คำสั่ง | วัตถุประสงค์ |
|--------|-------------|
| `bun run dev` | เริ่ม dev server ที่ port 3000 |
| `bun run lint` | ตรวจสอบ ESLint |
| `bun run test` | รัน unit tests ทั้งหมด |
| `npx tsc --noEmit` | ตรวจสอบ TypeScript types |
| `bun run build` | Build production (Vercel ทำอัตโนมัติ) |
| `bun run db:push` | Apply Prisma schema ไปยัง database |
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:migrate` | สร้างและรัน migration (ต้องได้รับอนุมัติจาก Owner) |
| `bash scripts/validate-foundation.sh` | ตรวจสอบ repository foundation (ไฟล์ที่จำเป็น, safety checks) |

## การทดสอบและการตรวจสอบ

### Universal CI Checks (รันทุก PR ไป main)

ทุก Pull Request ต้องผ่าน 5 checks เหล่านี้ก่อน merge:

| Check | วัตถุประสงค์ |
|-------|-------------|
| Foundation Validation | ตรวจสอบไฟล์ที่จำเป็น, safety rules, knowledge records |
| Lint | ESLint 0 errors |
| TypeScript Typecheck | `tsc --noEmit` 0 errors |
| Production Build | `next build` สำเร็จ |
| Unit Tests | `bun test` ทั้งหมดผ่าน |

### PostgreSQL Runtime Tests (path-filtered)

รันเฉพาะเมื่อแก้ไขไฟล์ที่เกี่ยวข้อง:

- **ST-70 PostgreSQL Concurrency** — ทดสอบ Sorting cancellation กับ real PostgreSQL (ephemeral container)
- **ST-71 PostgreSQL Runtime** — ทดสอบ Buy/Sell/Transfer cancellation + CAS concurrency guard + rollback

### Knowledge Semantic Validation

```bash
node scripts/validate-knowledge.mjs
```

ตรวจสอบความถูกต้องของ knowledge records (unique IDs, schema, credentials scan)

### Production Smoke Test (Owner-gated)

Manual dispatch เท่านั้น ทดสอบ 401 (unauthenticated) และ 403 (authenticated staff without `history.edit`) บน Production โดยใช้ synthetic nonexistent ID

## การควบคุมการ Release

### Branch Protection

Branch `main` ได้รับการป้องกันด้วย Repository Ruleset "Protect main":

- **ต้องใช้ Pull Request** ก่อน merge (ห้าม direct push)
- **5 required checks** ต้องผ่านทั้งหมด
- **Branch ต้อง up to date** ก่อน merge
- **Block force push** และ **block branch deletion**
- **Administrator ไม่สามารถ bypass** ได้
- **Required approvals: 0** (single-maintainer repository — ดู AGENTS.md สำหรับกระบวนการ review)

### Exact-Head Merge Guard

ก่อน merge ทุกครั้ง ต้องยืนยันว่า head SHA ตรงกับที่ reviewed และอนุมัติ ไม่ใช้ stale commit

### กฎด้านความปลอดภัย

- ห้ามแก้ไข Production โดยไม่ได้รับอนุมัติจาก Owner
- ห้าม run migration โดยไม่ได้รับอนุมัติ
- ห้าม force push หรือ push ตรงไป main
- ทุก cancellation ต้องทำงานใน transaction เดียว (atomic)
- ห้าม commit `.env`, `db/custom.db`, tokens, หรือ Production dumps

## เอกสารโครงการ

| เอกสาร | วัตถุประสงค์ |
|--------|-------------|
| [`AGENTS.md`](AGENTS.md) | จุดเริ่มต้นสำหรับ AI agents — safety rules, working method |
| [`process/CURRENT_STATE.md`](process/CURRENT_STATE.md) | สถานะปัจจุบัน — main SHA, Production SHA, verified/unverified behavior |
| [`process/BUSINESS_RULES.md`](process/BUSINESS_RULES.md) | กฎธุรกกิจ — bill number, cancel behavior, FIFO, permissions |
| [`process/FEATURE_INVENTORY.md`](process/FEATURE_INVENTORY.md) | ตารางรวมทุก feature และสถานะ |
| [`process/PROJECT_OPERATING_CONTEXT.md`](process/PROJECT_OPERATING_CONTEXT.md) | สรุปโครงการ, tech stack, โครงสร้างไฟล์ |
| [`process/DEPLOYMENT_RUNBOOK.md`](process/DEPLOYMENT_RUNBOOK.md) | ขั้นตอน deployment |
| [`process/DEFINITION_OF_DONE.md`](process/DEFINITION_OF_DONE.md) | เกณฑ์การพิจารณางานว่าเสร็จสมบูรณ์ |
| [`process/SAFETY_CHECKLIST.md`](process/SAFETY_CHECKLIST.md) | Checklist สำหรับ migration + deploy + smoke test |
| [`process/REBUILD_SPEC.md`](process/REBUILD_SPEC.md) | Specification สำหรับสร้างระบบใหม่ที่เทียบเท่า |
| [`process/RESTART_HANDOFF.md`](process/RESTART_HANDOFF.md) | Context สำหรับ resume งานหลัง workspace reset |

## สถานะปัจจุบัน

```
ST-71 FULLY COMPLETE — ALL FOLLOW-UPS VERIFIED
```

- ST-71 core engineering work: complete (PRs #51–#59)
- ST-72 branch protection: configured and verified
- ST-73 Production 403: verified (all 4 routes returned 403 PERMISSION_DENIED)
- Production 401: verified
- PostgreSQL runtime cancellation: covered (Buy/Sell/Transfer/Sorting)
- CAS concurrency safety: proven
- Rollback: proven at 3 fault-injection stages

ดูรายละเอียดล่าสุดได้ที่ [`process/CURRENT_STATE.md`](process/CURRENT_STATE.md)

---

ออกแบบกระบวนการโดย Owner · พัฒนาและตรวจสอบร่วมกับ AI agents · GitHub เป็น source of truth ทางเทคนิค
