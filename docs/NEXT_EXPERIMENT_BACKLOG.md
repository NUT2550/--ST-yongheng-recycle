# Next Experiment Backlog — งานที่ควรทำต่อ

> เรียงตามลำดับความสำคัญ (P0 = ด่วนที่สุด)

---

## P0 — ด่วน (ทำภายใน 3 วัน)

### E1: Reset staff (04) password
- **Impact**: 10/10 — พนักงาน login ไม่ได้
- **Effort**: 5 นาที
- **Risk**: ต่ำ
- **วิธี**: แก้ใน DB: `UPDATE "User" SET password = '<bcrypt hash>' WHERE username = '04'`

### E2: Excel import กับไฟล์ .xls จริง (TIS-620)
- **Impact**: 10/10 — daily-critical workflow
- **Effort**: 1 ชั่วโมง
- **Risk**: ปานกลาง (encoding อาจมีปัญหา)
- **วิธี**: ขอไฟล์ Excel จริง 1 ไฟล์ → ทดสอบ parse + product matching + import

### E3: Push date range filter + confirm dialog
- **Impact**: 8/10 — ใช้จริงง่ายขึ้นมาก
- **Effort**: 10 นาที (push only — code พร้อมแล้ว)
- **Risk**: ต่ำ
- **วิธี**: push commit ปัจจุบัน → Vercel deploy → ทดสอบ

---

## P1 — สำคัญ (ทำภายใน 7 วัน)

### E4: Keyboard shortcut Enter = เพิ่มรายการ
- **Impact**: 8/10 — เร็วขึ้นหน้าลาน
- **Effort**: 1 ชั่วโมง
- **Risk**: ต่ำ

### E5: PATCH sell/sort audit log test จริง
- **Impact**: 7/10
- **Effort**: 30 นาที
- **Risk**: ต่ำ
- **สถานะ**: ทดสอบ buy ผ่านแล้ว (Task 22C) — ต้องทดสอบ sell/sort ด้วย

### E6: Stock reconciliation ครั้งแรก
- **Impact**: 8/10 — ยืนยันความถูกต้อง
- **Effort**: 2 ชั่วโมง (นับจริงที่ลาน)
- **Risk**: ไม่มี (read-only)
- **วิธี**: ดู `docs/STOCK_RECONCILIATION_GUIDE.md`

---

## P2 — ปรับปรุง (ทำภายใน 30 วัน)

### E7: PWA / offline support
- **Impact**: 9/10 — เน็ตหลุดบ่อยที่ลาน
- **Effort**: 2 วัน
- **Risk**: ปานกลาง

### E8: Concurrent editing test
- **Impact**: 6/10
- **Effort**: 2 ชั่วโมง
- **Risk**: ปานกลาง

### E9: Bonus calculation จริง
- **Impact**: 7/10
- **Effort**: 2 ชั่วโมง
- **Risk**: ต่ำ

### E10: Monthly closing report
- **Impact**: 7/10
- **Effort**: 1 วัน
- **Risk**: ต่ำ

---

## P3 — รอก่อน

### E11: เครื่องชั่ง RS232 integration
- **Impact**: 9/10
- **Effort**: 3-5 วัน
- **Risk**: สูง (ต้องการ hardware + PoC)

### E12: LINE OA notification
- **Impact**: 6/10
- **Effort**: 1 วัน
- **Risk**: ต่ำ

### E13: PDF ใบเสร็จ
- **Impact**: 6/10
- **Effort**: 4 ชั่วโมง
- **Risk**: ต่ำ

### E14: FlowAccount/PEAK accounting integration
- **Impact**: 5/10
- **Effort**: 3 วัน
- **Risk**: ปานกลาง

---

## สรุปลำดับการทำ

1. **วันที่ 1**: E1 (reset password) + E3 (push โค้ดปัจจุบัน)
2. **วันที่ 2-3**: E2 (Excel จริง) + E5 (PATCH test)
3. **วันที่ 4-7**: E4 (keyboard) + E6 (stock reconciliation)
4. **สัปดาห์ที่ 2**: E7 (PWA) + E9 (bonus) + E10 (monthly report)
5. **เดือนที่ 2**: E11-E14 (integrations ใหญ่)
