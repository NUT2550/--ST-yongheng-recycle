# CLAUDE.md — คำสั่งเริ่มต้นสำหรับ AI ทุกตัว

> **⚠️ อ่านไฟล์นี้ก่อนเริ่มทำงานทุกครั้ง**

## กฎเหล็ก (ทำทุกครั้งก่อนเริ่มงาน)

1. **อ่าน `worklog.md` ก่อนเริ่มทำงานทุกครั้ง** — เพื่อเข้าใจสิ่งที่ทำไปแล้ว และไม่ทำซ้ำ/ทำลายงานเดิม
2. **อัปเดต `worklog.md` ทุกครั้งหลังเสร็จงาน** — append บันทึกใหม่ในส่วน 8 (ประวัติการทำงาน)
3. **Commit + push `worklog.md` ทุกครั้ง** — ให้ข้อมูลล่าสุดอยู่บน GitHub เสมอ
4. **อ่าน `UPDATE_WORKLOG.md`** — สำหรับรูปแบบการบันทึก

## โปรเจกท์นี้คืออะไร

- **ชื่อ**: ยงเฮง มหาชัย รีไซเคิล — ระบบจัดการสต๊อกร้านรับซื้อเหล็กและโลหะ
- **Tech**: Next.js 16 + Prisma + Supabase PostgreSQL + TypeScript
- **Deploy**: Vercel ที่ https://st-yongheng-recycle.vercel.app
- **GitHub**: https://github.com/NUT2550/--ST-yongheng-recycle

## ห้ามทำ

- ห้าม commit `.env`
- ห้ามใช้ git email อื่นนอกจาก `207142776+NUT2550@users.noreply.github.com`
- ห้ามใส่ `output: "standalone"` ใน next.config.ts
- ห้ามเปลี่ยน Prisma provider เป็นอย่างอื่นนอกจาก `postgresql` (production)
- ห้ามลบ `worklog.md` หรือไฟล์นี้

## ข้อมูลละเอียด

ดูทั้งหมดใน `worklog.md` — มี schema, API routes, ฟีเจอร์, วิธีสร้างแอปขึ้นมาใหม่
