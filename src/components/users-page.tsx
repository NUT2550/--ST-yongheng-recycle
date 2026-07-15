'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, UserPlus, Trash2, Edit, Shield, User, Power, KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { getAuthToken } from '@/lib/api'

// ST-14: Canonical permission keys (must match server-side VALID_PERMISSIONS)
const PERMISSION_KEYS = [
  { key: 'customer.create', label: 'สร้างลูกค้า' },
  { key: 'buy.create', label: 'สร้างใบรับซื้อ' },
  { key: 'sell.create', label: 'สร้างใบขาย' },
  { key: 'sort.create', label: 'สร้างใบคัดแยก' },
  { key: 'transfer.create', label: 'สร้างใบย้ายสต็อก' },
  { key: 'history.edit', label: 'แก้ไข/ยกเลิกบิลในประวัติ' },
  { key: 'physical-count.apply', label: 'Apply การชั่งสต็อกจริง (Legacy)' },
  { key: 'dailyPurchaseWeighing', label: 'ชั่งยอดซื้อทองแดง/ทองเหลือง' },
  { key: 'product.manage', label: 'จัดการสินค้า' },
] as const

interface User {
  id: string
  username: string
  name: string
  role: string
  isActive: boolean
  permissions: string[]
  createdAt: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  // ST-14: Permission management state
  const [permUser, setPermUser] = useState<User | null>(null)
  const [permDraft, setPermDraft] = useState<string[]>([])
  const [permSaving, setPermSaving] = useState(false)
  const [permOriginal, setPermOriginal] = useState<string[]>([])

  // Form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('staff')

  async function fetchUsers() {
    setLoading(true)
    try {
      const token = getAuthToken()
      const res = await fetch('/api/users', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 401) {
        toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่')
        return
      }
      if (res.status === 403) {
        toast.error('ไม่มีสิทธิ์เข้าถึง — ต้องเป็นผู้ดูแล')
        return
      }
      if (!res.ok) throw new Error('ไม่สามารถโหลดข้อมูลได้')
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  async function handleAdd() {
    try {
      const token = getAuthToken()
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ username, password, name, role }),
      })
      const data = await res.json()
      if (res.status === 401) { toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่'); return }
      if (res.status === 403) { toast.error('ไม่มีสิทธิ์ — ต้องเป็นผู้ดูแล'); return }
      if (!res.ok) { toast.error(data.error || 'เพิ่มผู้ใช้ไม่สำเร็จ'); return }
      toast.success('เพิ่มผู้ใช้สำเร็จ')
      setAddOpen(false)
      setUsername(''); setPassword(''); setName(''); setRole('staff')
      fetchUsers()
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    }
  }

  async function handleEdit() {
    if (!editUser) return
    try {
      const token = getAuthToken()
      const body: any = { name, role }
      if (password) body.password = password
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.status === 401) { toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่'); return }
      if (res.status === 403) { toast.error('ไม่มีสิทธิ์ — ต้องเป็นผู้ดูแล'); return }
      if (!res.ok) { toast.error(data.error || 'แก้ไขไม่สำเร็จ'); return }
      toast.success('แก้ไขสำเร็จ')
      setEditUser(null)
      setPassword('')
      fetchUsers()
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    }
  }

  async function handleToggleActive(user: User) {
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      const data = await res.json()
      if (res.status === 401) { toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่'); return }
      if (res.status === 403) { toast.error('ไม่มีสิทธิ์ — ต้องเป็นผู้ดูแล'); return }
      if (!res.ok) { toast.error(data.error || 'แก้ไขไม่สำเร็จ'); return }
      toast.success(user.isActive ? 'ปิดการใช้งานแล้ว' : 'เปิดการใช้งานแล้ว')
      fetchUsers()
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`ต้องการลบผู้ใช้ "${user.name}" ใช่ไหม?`)) return
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      if (res.status === 401) { toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่'); return }
      if (res.status === 403) { toast.error('ไม่มีสิทธิ์ — ต้องเป็นผู้ดูแล'); return }
      if (!res.ok) { toast.error(data.error || 'ลบไม่สำเร็จ'); return }
      toast.success('ลบผู้ใช้สำเร็จ')
      fetchUsers()
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    }
  }

  // ST-14: Permission management — open dialog with current permissions
  function openPermissions(user: User) {
    setPermUser(user)
    setPermDraft(user.permissions || [])
    setPermOriginal(user.permissions || [])
  }

  // ST-14: Save permission changes via PATCH /api/users/[id] with permissions field
  async function handleSavePermissions() {
    if (!permUser) return
    setPermSaving(true)
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/users/${permUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ permissions: permDraft }),
      })
      const data = await res.json()
      if (res.status === 401) { toast.error('ไม่ได้เข้าสู่ระบบ — กรุณาเข้าสู่ระบบใหม่'); return }
      if (res.status === 403) { toast.error('ไม่มีสิทธิ์ — ต้องเป็นผู้ดูแล'); return }
      if (res.status === 400) { toast.error(data.error || 'ข้อมูลไม่ถูกต้อง'); return }
      if (!res.ok) { toast.error(data.error || 'บันทึกสิทธิ์ไม่สำเร็จ'); return }
      toast.success(`บันทึกสิทธิ์ของ ${permUser.username} สำเร็จ — ผู้ใช้ต้อง Login ใหม่เพื่อให้สิทธิ์ใหม่มีผล`, { duration: 8000 })
      setPermUser(null)
      fetchUsers()
    } catch {
      toast.error('เกิดข้อผิดพลาด')
    } finally {
      setPermSaving(false)
    }
  }

  function togglePermission(key: string) {
    setPermDraft(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function openEdit(user: User) {
    setEditUser(user)
    setName(user.name)
    setRole(user.role)
    setPassword('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">จัดการผู้ใช้งาน</CardTitle>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <UserPlus className="h-4 w-4 mr-1" />
                  เพิ่มผู้ใช้
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>เพิ่มผู้ใช้ใหม่</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <Label>ชื่อผู้ใช้</Label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="เช่น somchai"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>ชื่อ-สกุล / ชื่อที่แสดง</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="เช่น สมชาย ใจดี"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>รหัสผ่าน</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="อย่างน้อย 4 ตัวอักษร"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>สิทธิ์การใช้งาน</Label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full p-2 border rounded-md bg-background"
                    >
                      <option value="staff">พนักงาน (ใช้งานระบบได้)</option>
                      <option value="admin">ผู้ดูแล (จัดการผู้ใช้ได้)</option>
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>
                    ยกเลิก
                  </Button>
                  <Button onClick={handleAdd}>บันทึก</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อผู้ใช้</TableHead>
                    <TableHead>ชื่อ</TableHead>
                    <TableHead>สิทธิ์</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>
                        {user.role === 'admin' ? (
                          <Badge className="bg-purple-100 text-purple-800">
                            <Shield className="h-3 w-3 mr-1" />
                            ผู้ดูแล
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <User className="h-3 w-3 mr-1" />
                            พนักงาน
                          </Badge>
                        )}
                        {user.role === 'staff' && user.permissions && user.permissions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {user.permissions.map(p => (
                              <Badge key={p} variant="outline" className="text-[9px] px-1 py-0">
                                {PERMISSION_KEYS.find(pk => pk.key === p)?.label || p}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge className="bg-green-100 text-green-800">ใช้งาน</Badge>
                        ) : (
                          <Badge variant="destructive">ปิดใช้งาน</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {user.role === 'staff' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openPermissions(user)}
                              title="จัดการสิทธิ์"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(user)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleActive(user)}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(user)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขผู้ใช้: {editUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>ชื่อ-สกุล / ชื่อที่แสดง</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="อย่างน้อย 4 ตัวอักษร"
              />
            </div>
            <div className="space-y-1.5">
              <Label>สิทธิ์การใช้งาน</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
              >
                <option value="staff">พนักงาน</option>
                <option value="admin">ผู้ดูแล</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleEdit}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ST-14: Permission Management Dialog */}
      <Dialog open={!!permUser} onOpenChange={(o) => !o && setPermUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              จัดการสิทธิ์: {permUser?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
              ⚠️ หลังเปลี่ยนสิทธิ์ ผู้ใช้ต้อง <strong>Logout และ Login ใหม่</strong> เพื่อให้สิทธิ์ใหม่มีผล
            </p>
            <div className="space-y-2">
              {PERMISSION_KEYS.map(pk => (
                <div key={pk.key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`perm-${pk.key}`}
                    checked={permDraft.includes(pk.key)}
                    onCheckedChange={() => togglePermission(pk.key)}
                  />
                  <Label htmlFor={`perm-${pk.key}`} className="text-sm cursor-pointer flex-1">
                    {pk.label}
                    <span className="text-xs text-gray-400 ml-1">({pk.key})</span>
                  </Label>
                  {permOriginal.includes(pk.key) !== permDraft.includes(pk.key) && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 text-blue-600 border-blue-300">
                      {permDraft.includes(pk.key) ? 'เพิ่ม' : 'ลบ'}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500 border-t pt-2">
              <p>สิทธิ์ปัจจุบัน: {permOriginal.length > 0 ? permOriginal.join(', ') : 'ไม่มี'}</p>
              <p>สิทธิ์ใหม่: {permDraft.length > 0 ? permDraft.join(', ') : 'ไม่มี'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermUser(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSavePermissions} disabled={permSaving}>
              {permSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              บันทึกสิทธิ์
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
