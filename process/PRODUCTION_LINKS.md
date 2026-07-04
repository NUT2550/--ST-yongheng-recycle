# Production Links — ยงเฮง มหาชัย รีไซเคิล

> รวม URL ทั้งหมดที่ใช้ในโปรเจกต์ — สำหรับ owner และ ChatGPT
> วันที่รวบรวม: 27/06/2569

---

## Application

| รายการ | URL |
|--------|-----|
| **Production app** | https://st-yongheng-recycle.vercel.app |
| **Login page** | https://st-yongheng-recycle.vercel.app/ (auto-redirect) |
| **API base** | https://st-yongheng-recycle.vercel.app/api |
| **Health check** | https://st-yongheng-recycle.vercel.app/ (ต้องได้ 200 แม้ไม่ login) |

---

## Source Code

| รายการ | URL |
|--------|-----|
| **GitHub repo** | https://github.com/NUT2550/--ST-yongheng-recycle |
| **Default branch** | `main` (deploy จาก branch นี้ไป Vercel อัตโนมัติ) |
| **Commit history** | https://github.com/NUT2550/--ST-yongheng-recycle/commits/main |

> ⚠️ ชื่อ repo มี `--` นำหน้า (เป็น default ของ GitHub ตอนสร้าง repo)

---

## Vercel

| รายการ | ข้อมูล |
|--------|-------|
| **Project name** | st-yongheng-recycle |
| **Dashboard URL** | https://vercel.com/dashboard (login ด้วย GitHub account ของ owner) |
| **Project URL** | ผูกกับ repo `NUT2550/--ST-yongheng-recycle` |
| **Auto-deploy** | ทุก push ไป `main` branch → Vercel build อัตโนมัติ |
| **Build command** | `next build` (อัตโนมัติจาก package.json `build` script) |
| **Output mode** | `standalone` (จาก next.config.ts) |

---

## Supabase

| รายการ | URL |
|--------|-----|
| **Project dashboard** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx |
| **SQL Editor (new query)** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/sql/new |
| **Table editor** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/editor |
| **Database backups** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups |
| **Auth settings** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/auth/users |
| **Project settings** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/settings |

### Project ref
```
wefqhunzjvsxciiwdhjx
```

---

## Local Development

| รายการ | URL / Path |
|--------|------------|
| **Local app** | http://localhost:3000 |
| **Local DB (SQLite)** | `file:/home/z/my-project/db/custom.db` (เฉพาะใน sandbox — production ใช้ Supabase) |
| **Caddy gateway** | http://localhost:81 (ใน sandbox — proxy ไป port 3000) |

---

## API Routes (Production)

Base URL: `https://st-yongheng-recycle.vercel.app/api`

### Auth
| Method | Path | ใช้ทำอะไร |
|--------|------|----------|
| POST | `/api/auth/login` | Login → ได้ token |
| GET | `/api/auth/me` | ตรวจสอบ token ปัจจุบัน |
| POST | `/api/auth/logout` | Logout (client-side ล้าง token) |

### Bills
| Method | Path | สถานะ |
|--------|------|-------|
| POST | `/api/buy-bills` | ✅ สร้าง BuyBill |
| GET | `/api/buy-bills` | ✅ List BuyBills (paginated) |
| POST | `/api/sell-bills` | ✅ สร้าง SellBill (FIFO) |
| GET | `/api/sell-bills` | ✅ List SellBills |
| POST | `/api/sorting-bills` | ✅ สร้าง SortingBill (FIFO source + add output) |
| GET | `/api/sorting-bills` | ✅ List SortingBills |
| DELETE | `/api/buy-bills/{id}` | ❌ **ยังไม่มี** (cancel feature หายไป) |
| DELETE | `/api/sell-bills/{id}` | ❌ **ยังไม่มี** |
| DELETE | `/api/sorting-bills/{id}` | ❌ **ยังไม่มี** |

### Master data
| Method | Path | สถานะ |
|--------|------|-------|
| GET/POST | `/api/products` | ✅ |
| GET/PATCH/DELETE | `/api/products/{id}` | ✅ |
| GET/POST | `/api/customers` | ✅ |
| GET/POST | `/api/employees` | ✅ |
| GET/PATCH/DELETE | `/api/employees/{id}` | ✅ |
| GET/POST | `/api/users` | ✅ |
| GET/PATCH/DELETE | `/api/users/{id}` | ✅ |

### Operations
| Method | Path | สถานะ |
|--------|------|-------|
| GET | `/api/stock` | ✅ |
| GET | `/api/dashboard` | ✅ |
| GET | `/api/credit` | ✅ |
| POST | `/api/credit/{id}/pay` | ✅ |
| GET | `/api/bonuses` | ✅ |
| POST | `/api/bonuses` | ✅ |
| GET/PATCH/DELETE | `/api/bonuses/{id}` | ✅ |
| GET | `/api/bonus-calculation` | ✅ |

### Missing Routes (features that were lost)
| Method | Path | หมายเหตุ |
|--------|------|---------|
| POST | `/api/excel/parse` | ❌ Excel import หายไป |

---

## หมายเหตุ

- ทุก API route ต้องมี `Authorization: Bearer <token>` header (ยกเว้น `/api/auth/login`)
- Token ได้จาก POST /api/auth/login → เก็บใน `localStorage` ภายใต้ key `auth_token`
- ดู `src/lib/auth-constants.ts` สำหรับชื่อ key ที่แน่นอน
