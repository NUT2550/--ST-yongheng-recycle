<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma" alt="Prisma 6" />
  <img src="https://img.shields.io/badge/Bun-runtime-000000?style=flat-square&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL / Supabase" />
</p>

<h1 align="center">YH Stock System</h1>

<p align="center">
  ระบบบริหารสต็อกและเอกสารซื้อขาย สำหรับธุรกิจรับซื้อเศษเหล็กและโลหะ<br/>
  พัฒนาสำหรับ <strong>บจก. ยงเฮง มหาชัย รีไซเคิล</strong>
</p>

<p align="center">
  <a href="https://st-yongheng-recycle.vercel.app/">🌐 Production</a> ·
  <a href="https://github.com/NUT2550/--ST-yongheng-recycle">💻 GitHub</a> ·
  <a href="AGENTS.md">🤖 AI Entry Point</a>
</p>

---

## สารบัญ

- [เกี่ยวกับระบบ](#เกี่ยวกับระบบ)
- [ฟีเจอร์หลัก](#ฟีเจอร์หลัก)
- [หลักการสำคัญ](#หลักการสำคัญ)
- [เทคโนโลยี](#เทคโนโลยี)
- [เริ่มต้นใช้งานสำหรับนักพัฒนา](#เริ่มต้นใช้งานสำหรับนักพัฒนา)
- [การทดสอบและการตรวจสอบ](#การทดสอบและการตรวจสอบ)
- [การควบคุมการ Release และความปลอดภัย](#การควบคุมการ-release-และความปลอดภัย)
- [เอกสารโครงการ](#เอกสารโครงการ)
- [สถานะปัจจุบัน](#สถานะปัจจุบัน)

---

## เกี่ยวกับระบบ

ระบบบันทึกและบริหารสต็อกสำหรับร้านรับซื้อเหล็กและโลหะ ครอบคลุมวงจรการทำงานจริง ตั้งแต่รับซื้อ คัดแยก ขาย ย้ายสต็อก ไปจนถึงการยกเลิกบิลและการเงิน

- **การรับซื้อ (Buy)** — บันทึกน้ำหนัก/ราคา สร้าง `StockLot` อัตโนมัติ รองรับเครดิตค้างจ่าย
- **การขาย (Sell)** — หักสต็อกแบบ **FIFO** พร้อมคำนวณต้นทุนและกำไร รองรับเครดิตค้างรับ
- **การคัดแยก (Sorting)** — แยกสินค้าต้นทางเป็นผลผลิตหลายรายการ คำนวณโบนัสพนักงาน
- **การย้ายสต็อก (Stock Transfer)** — ย้ายระหว่างสินค้าด้วย FIFO
- **การยกเลิกบิล (Cancellation)** — คืนสต็อก ย้อนรายการ บันทึก AuditLog ทำงานแบบ atomic
- **การเงิน (Credit)** — ติดตามค้างรับ/ค้างจ่าย บันทึกการชำระ
- **ประวัติและการตรวจสอบ (History & Audit)** — ดูประวัติบิลทั้งหมด ตรวจสอบย้อนหลังได้

## ฟีเจอร์หลัก

| ฟีเจอร์ | สถานะ | รายละเอียด |
| --- | --- | --- |
| Login + JWT Auth | ✅ ใช้งานได้ | JWT ใน localStorage + Authorization header แยกบทบาท admin/staff |
| บิลรับซื้อ (Buy) | ✅ ใช้งานได้ | สร้างบิล สร้าง `StockLot` อัตโนมัติ รองรับเครดิตค้างจ่าย |
| บิลขาย (Sell) | ✅ ใช้งานได้ | หักสต็อก FIFO คำนวณต้นทุน/กำไร รองรับเครดิตค้างรับ |
| บิลคัดแยก (Sorting) | ✅ ใช้งานได้ | หักสต็อกต้นทาง FIFO สร้างผลผลิตหลายรายการ คำนวณโบนัสพนักงาน |
| ใบย้ายสต็อก (Transfer) | ✅ ใช้งานได้ | ย้ายสต็อกด้วย FIFO ระหว่างสินค้า |
| ยกเลิกบิล (Cancel) | ✅ ใช้งานได้ | คืนสต็อก ย้อน `StockMovement` บันทึก AuditLog ใน transaction เดียว ป้องกัน race ด้วย CAS guard |
| Excel Import (Buy/Sell) | ✅ ใช้งานได้ | Import แบบ partial-success ข้ามบิลซ้ำ (`DUPLICATE_EXISTING`) idempotent เมื่ออัปโหลดไฟล์เดิมซ้ำ |
| ประวัติบิล (History) | ✅ ใช้งานได้ | ดูบิลทุกประเภท กรองตามวันที่ แยกบิลยกเลิก |
| สต็อกคงเหลือ | ✅ ใช้งานได้ | ดูสต็อกแยกตามหมวดสินค้า |
| Stock Ledger & Baseline | ✅ ใช้งานได้ | `StockMovement` แบบ append-only + `StockBaseline` คำนวณ closing stock ตามวันที่ธุรกิจไทย |
| ตรวจนับสต็อก (Physical Count) | ✅ ใช้งานได้ | Apply ผลนับพร้อม metadata และ preview ยืนยัน 2 ขั้นตอน |
| Dashboard | ✅ ใช้งานได้ | สรุปยอดรับซื้อ/ขายและสถิติ |
| จัดการผู้ใช้ | ✅ ใช้งานได้ | เพิ่ม/แก้ไข/ปิดผู้ใช้ กำหนดสิทธิ์ (admin เท่านั้น) |
| จัดการสินค้า | ✅ ใช้งานได้ | เพิ่ม/แก้ไข/ลบสินค้าและหมวดหมู่ |
| จัดการลูกค้า | ✅ ใช้งานได้ | เพิ่ม/แก้ไขข้อมูลลูกค้า |
| การเงิน (Credit) | ✅ ใช้งานได้ | ติดตามค้างรับ/ค้างจ่าย บันทึกการชำระ |
| โบนัสพนักงาน | ✅ ใช้งานได้ | คำนวณโบนัสจากการคัดแยกอัตโนมัติ |
| Weight Expression | ⏳ รอ migration | การเก็บสูตรน้ำหนัก (เช่น `860-3`) รอ Owner อนุมัติ `add_weight_expression` |

## หลักการสำคัญ

1. **ความถูกต้องของสต็อก ต้นทุน และประวัติ เหนือความเร็ว** — ไม่รีบทำรายการที่อาจผิดพลาด
2. **ตรวจสอบสิทธิ์ก่อนเปลี่ยนแปลงข้อมูล** — ทุก route ตรวจ auth ก่อนเข้าถึง database (แยก 401/403 ชัดเจน)
3. **Transaction safety** — การยกเลิกบิลทำงานใน Prisma `$transaction` เดียว ถ้า fail จะ rollback ทั้งหมด
4. **Regression prevention** — มี CI checks หลายชั้น + PostgreSQL runtime tests + static contract tests
5. **GitHub เป็น source of truth ทางเทคนิค** — โค้ด การทดสอบ และหลักฐานทั้งหมดอยู่ใน repository
6. **ต้องได้รับอนุมัติจาก Owner สำหรับการกระทำที่ Production** — ไม่แก้ไข ย้าย หรือลบข้อมูลจริงโดยไม่ได้รับอนุมัติ

## เทคโนโลยี

| ชั้น | เทคโนโลยี |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| Runtime | Bun (dev) / Node.js (production บน Vercel) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | PostgreSQL (Supabase — production) / SQLite (local dev) |
| ORM | Prisma 6 |
| Auth | JWT (jose) + bcryptjs |
| State | Zustand (client) + TanStack Query (server) |
| Icons | lucide-react |
| CI/CD | GitHub Actions + Vercel (auto-deploy จาก `main`) |

## เริ่มต้นใช้งานสำหรับนักพัฒนา

### สิ่งที่ต้องมี

- Bun 1.3+ (หรือ Node.js 20+)
- PostgreSQL (หรือใช้ SQLite สำหรับ local dev)

### การติดตั้ง

```bash
git clone https://github.com/NUT2550/--ST-yongheng-recycle.git
cd --ST-yongheng-recycle
bun install
bun run db:generate
