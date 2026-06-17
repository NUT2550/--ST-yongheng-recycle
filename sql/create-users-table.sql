-- =====================================================
-- SQL สร้างตาราง User สำหรับระบบ Login
-- รันที่ Supabase Dashboard → SQL Editor → New query
-- =====================================================

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT PRIMARY KEY,
    "username" TEXT UNIQUE NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- สร้าง default admin user
-- username: admin
-- password: admin123 (จะเปลี่ยนภายหลังได้)
INSERT INTO "User" ("id", "username", "password", "name", "role", "isActive", "createdAt", "updatedAt")
VALUES (
    'user_admin_default',
    'admin',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    'ผู้ดูแลระบบ',
    'admin',
    TRUE,
    NOW(),
    NOW()
) ON CONFLICT ("username") DO NOTHING;

-- Enable RLS
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

-- อนุญาตให้ service_role เข้าถึงได้ทั้งหมด
CREATE POLICY "Service role full access" ON "User"
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- สำเร็จ! admin account:
-- username: admin
-- password: admin123
