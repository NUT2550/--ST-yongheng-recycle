'use client';

import { useState, useEffect } from 'react';
import { fetchStock } from '@/lib/api';
import { StockCategory } from '@/lib/types';
import { formatBaht, formatWeight } from '@/lib/helpers';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Package, ChevronDown } from 'lucide-react';

export function StockPage() {
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStock()
      .then((data) => {
        // API returns { categories: [...] }
        const cats = (data as unknown as { categories: StockCategory[] }).categories || (data as unknown as StockCategory[]);
        setCategories(cats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <StockSkeleton />;

  // Compute totals
  const totalWeight = categories.reduce(
    (sum, cat) => sum + cat.products.reduce((s, p) => s + p.totalWeight, 0),
    0
  );
  const totalCost = categories.reduce(
    (sum, cat) => sum + cat.products.reduce((s, p) => s + p.totalCost, 0),
    0
  );
  const productsWithStock = categories.reduce(
    (sum, cat) =>
      sum + cat.products.filter((p) => p.totalWeight > 0).length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">สต๊อกสินค้า</h2>
        <p className="text-gray-500 mt-1">
          ดูสต๊อกเหล็กและโลหะคงเหลือ
        </p>
      </div>

      {/* Total Summary */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                สต๊อกทั้งหมด
              </span>
            </div>
            <div className="flex flex-wrap gap-4 sm:gap-6">
              <div>
                <p className="text-xs text-amber-600">น้ำหนักรวม</p>
                <p className="text-lg font-bold text-amber-900">
                  {formatWeight(totalWeight)}
                </p>
              </div>
              <div>
                <p className="text-xs text-amber-600">มูลค่ารวม</p>
                <p className="text-lg font-bold text-amber-900">
                  {formatBaht(totalCost)} บาท
                </p>
              </div>
              <div>
                <p className="text-xs text-amber-600">สินค้ามีสต๊อก</p>
                <p className="text-lg font-bold text-amber-900">
                  {productsWithStock} รายการ
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category Sections */}
      {categories.length > 0 ? (
        <Accordion
          type="multiple"
          defaultValue={categories.map((c) => c.id)}
          className="space-y-3"
        >
          {categories.map((category) => {
            const catWeight = category.products.reduce(
              (s, p) => s + p.totalWeight,
              0
            );
            const catCost = category.products.reduce(
              (s, p) => s + p.totalCost,
              0
            );
            const productsInStock = category.products.filter(
              (p) => p.totalWeight > 0
            ).length;

            return (
              <AccordionItem
                key={category.id}
                value={category.id}
                className="border rounded-lg bg-white shadow-sm overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-gray-50/50 [&[data-state=open]]:bg-gray-50/50">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-left w-full">
                    <Badge
                      variant="secondary"
                      className={
                        category.type === 'STEEL'
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-100 shrink-0'
                          : 'bg-orange-100 text-orange-800 hover:bg-orange-100 shrink-0'
                      }
                    >
                      {category.type === 'STEEL' ? 'เหล็ก' : 'โลหะ'}
                    </Badge>
                    <span className="font-semibold text-gray-900 text-sm sm:text-base">
                      {category.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {productsInStock}/{category.products.length} รายการมีสต๊อก
                    </span>
                    <span className="text-xs text-gray-500 ml-auto whitespace-nowrap">
                      {formatWeight(catWeight)} · {formatBaht(catCost)} บาท
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/80">
                          <TableHead className="text-xs font-medium">
                            ชื่อสินค้า
                          </TableHead>
                          <TableHead className="text-xs font-medium text-right">
                            น้ำหนักคงเหลือ (กก.)
                          </TableHead>
                          <TableHead className="text-xs font-medium text-right">
                            ต้นทุนเฉลี่ย/กก.
                          </TableHead>
                          <TableHead className="text-xs font-medium text-right">
                            ต้นทุนรวม
                          </TableHead>
                          <TableHead className="text-xs font-medium text-right hidden sm:table-cell">
                            ราคารับซื้อ/กก.
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {category.products.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center text-gray-400 py-6 text-sm"
                            >
                              ยังไม่มีสินค้าในหมวดนี้
                            </TableCell>
                          </TableRow>
                        ) : (
                          category.products.map((product) => {
                            const hasStock = product.totalWeight > 0;
                            return (
                              <TableRow
                                key={product.id}
                                className={
                                  hasStock ? '' : 'opacity-50'
                                }
                              >
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={`h-2 w-2 rounded-full shrink-0 ${
                                        hasStock ? 'bg-green-500' : 'bg-gray-300'
                                      }`}
                                    />
                                    <span
                                      className={
                                        hasStock
                                          ? 'text-gray-900'
                                          : 'text-gray-400'
                                      }
                                    >
                                      {product.name}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {hasStock
                                    ? formatWeight(product.totalWeight)
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {hasStock
                                    ? `${formatBaht(product.avgCostPerKg)}`
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {hasStock
                                    ? `${formatBaht(product.totalCost)}`
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-right hidden sm:table-cell text-gray-500">
                                  —
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-400 text-center py-8 text-sm">
              ยังไม่มีข้อมูลสต๊อก
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary Footer */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
            <span>
              สินค้าทั้งหมด{' '}
              <strong className="text-gray-900">
                {categories.reduce((s, c) => s + c.products.length, 0)}
              </strong>{' '}
              รายการ
            </span>
            <span>
              มีสต๊อก{' '}
              <strong className="text-green-700">{productsWithStock}</strong>{' '}
              รายการ · น้ำหนักรวม{' '}
              <strong className="text-amber-800">
                {formatWeight(totalWeight)}
              </strong>{' '}
              · มูลค่ารวม{' '}
              <strong className="text-amber-800">
                {formatBaht(totalCost)} บาท
              </strong>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---- Skeleton ---- */
function StockSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-52 mt-2" />
      </div>
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="flex gap-6">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </CardContent>
      </Card>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-6 w-40" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
