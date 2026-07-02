'use client'

import { useState, useEffect } from 'react'
import { Loader2, Plus, Trash2, Edit, Package } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getAuthToken } from '@/lib/api'
import { toast } from 'sonner'

interface Product {
  id: string
  name: string
  defaultBuyPrice: number
  category: { id: string; name: string }
  stock?: { totalWeight: number }
}
interface Category { id: string; name: string; type: string }

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('0')

  async function fetchData() {
    setLoading(true)
    try {
      const token = getAuthToken()
      const [prodRes, catRes] = await Promise.all([
        fetch('/api/products', { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        fetch('/api/stock', { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
      ])
      const prodData = await prodRes.json()
      setProducts(prodData.products || [])
      const catData = await catRes.json()
      setCategories(catData.categories || catData || [])
    } catch { toast.error('โหลดข้อมูลไม่ได้') }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  async function handleAdd() {
    if (!name || !name.trim()) { toast.error('กรุณากรอกชื่อสินค้า'); return }
    if (!categoryId) { toast.error('กรุณาเลือกหมวดหมู่'); return }
    const token = getAuthToken()
    const res = await fetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ name, categoryId, defaultBuyPrice: parseFloat(price) || 0, sortOrder: 99 }),
    })
    if (res.ok) { toast.success('เพิ่มสินค้าแล้ว'); setAddOpen(false); setName(''); setCategoryId(''); setPrice('0'); fetchData() }
    else {
      const d = await res.json().catch(() => ({ error: 'ไม่สำเร็จ' }))
      toast.error(d.error || 'ไม่สำเร็จ')
    }
  }

  async function handleEdit() {
    if (!editProduct || !name) return
    const token = getAuthToken()
    const res = await fetch(`/api/products/${editProduct.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ name, defaultBuyPrice: parseFloat(price) || 0, categoryId }),
    })
    if (res.ok) { toast.success('แก้ไขแล้ว'); setEditProduct(null); fetchData() }
    else { const d = await res.json(); toast.error(d.error || 'ไม่สำเร็จ') }
  }

  async function handleDelete(p: Product) {
    if (!confirm(`ลบ "${p.name}"?`)) return
    const token = getAuthToken()
    const res = await fetch(`/api/products/${p.id}`, {
      method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.ok) { toast.success('ลบแล้ว'); fetchData() }
    else { const d = await res.json(); toast.error(d.error || 'ไม่สามารถลบได้') }
  }

  function openEdit(p: Product) {
    setEditProduct(p); setName(p.name); setCategoryId(p.category.id); setPrice(String(p.defaultBuyPrice))
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-amber-600" /></div>

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-5 w-5" /> จัดการสินค้า</CardTitle>
          <Button size="sm" onClick={() => { setName(''); setCategoryId(''); setPrice('0'); setAddOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> เพิ่มสินค้า
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อสินค้า</TableHead>
                  <TableHead>หมวดหมู่</TableHead>
                  <TableHead className="text-right">ราคาซื้อ/กก.</TableHead>
                  <TableHead className="text-right">สต็อก (กก.)</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline">{p.category?.name || '-'}</Badge></TableCell>
                    <TableCell className="text-right">{p.defaultBuyPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{(p.stock?.totalWeight ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Edit className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>เพิ่มสินค้าใหม่</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5"><Label>ชื่อสินค้า</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>หมวดหมู่</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="เลือกหมวดหมู่" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>ราคารับซื้อ/กก.</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAddOpen(false)}>ยกเลิก</Button><Button onClick={handleAdd}>บันทึก</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editProduct} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>แก้ไขสินค้า: {editProduct?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5"><Label>ชื่อสินค้า</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>หมวดหมู่</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>ราคารับซื้อ/กก.</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditProduct(null)}>ยกเลิก</Button><Button onClick={handleEdit}>บันทึก</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
