'use client';

import { useState, useEffect, useCallback, Fragment, useMemo } from 'react';
import {
  fetchBonusCalculation,
  fetchEmployees,
  createEmployee,
  createSortingBonus,
  updateBonus,
  deleteBonus,
  fetchBonuses,
} from '@/lib/api';
import { Employee, SortingBonus } from '@/lib/types';
import { formatBaht, formatWeight, formatDate } from '@/lib/helpers';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Gift,
  UserPlus,
  CheckCircle2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Calculator,
  Edit3,
} from 'lucide-react';
import { toast } from 'sonner';

// BonusCalculation response type
interface BonusCalcData {
  year: number;
  totalBonusAmount: number;
  totalSortedWeight: number;
  sortingBillCount: number;
  aggregatedItems: Array<{
    sourceProductId: string;
    sourceProductName: string;
    sortedProductId: string;
    sortedProductName: string;
    totalWeight: number;
    totalCost: number;
    totalValue: number;
    totalGrossProfit: number;
    totalBonusAmount: number;
    sourcePricePerKg: number;
    sortedPricePerKg: number;
  }>;
  bonusItems: Array<{
    sortingBillId: string;
    date: string;
    sourceProductId: string;
    sourceProductName: string;
    sourceWeight: number;
    sourcePricePerKg: number;
    sortedProductId: string;
    sortedProductName: string;
    sortedWeight: number;
    sortedPricePerKg: number;
    costPerKg: number;
    grossProfit: number;
    bonusAmount: number;
  }>;
  employeeDistribution: Array<{
    employeeId: string;
    employeeName: string;
    hireDate: string | null;
    createdAt: string;
    monthsWorked: number;
    bonusAmount: number;
  }>;
}

// Local editable employee months state
interface EmployeeMonthEntry {
  employeeId: string;
  employeeName: string;
  hireDate: string | null;
  calculatedMonths: number; // auto-calculated from hire date
  manualMonths: number; // user-edited (may differ from calculated)
  bonusAmount: number;
}

type ViewTab = 'calculation' | 'history';

export function BonusPage() {
  const [calcData, setCalcData] = useState<BonusCalcData | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bonuses, setBonuses] = useState<SortingBonus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewTab>('calculation');

  // Year selector
  const currentBEYear = new Date().getFullYear() + 543;
  const [selectedYear, setSelectedYear] = useState(currentBEYear);
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentBEYear - i);

  // Expanded sections
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showAllDetails, setShowAllDetails] = useState(false);

  // Create employee dialog
  const [empDialogOpen, setEmpDialogOpen] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empHireDate, setEmpHireDate] = useState('');
  const [creatingEmp, setCreatingEmp] = useState(false);

  // Save bonus dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable employee months (key = employeeId)
  const [employeeMonths, setEmployeeMonths] = useState<Map<string, EmployeeMonthEntry>>(new Map());

  const loadData = useCallback(async () => {
    try {
      const [calcResult, empData, bonusResult] = await Promise.all([
        fetchBonusCalculation(selectedYear),
        fetchEmployees(),
        fetchBonuses(),
      ]);
      setCalcData(calcResult);
      setEmployees(empData);
      setBonuses(bonusResult.bonuses);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Initialize / update employeeMonths when calcData changes
  useEffect(() => {
    if (!calcData) return;
    setEmployeeMonths((prev) => {
      const next = new Map<string, EmployeeMonthEntry>();
      for (const emp of calcData.employeeDistribution) {
        const existing = prev.get(emp.employeeId);
        next.set(emp.employeeId, {
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          hireDate: emp.hireDate,
          calculatedMonths: emp.monthsWorked,
          // Keep manual override if already set, otherwise use calculated
          manualMonths: existing?.manualMonths ?? emp.monthsWorked,
          bonusAmount: emp.bonusAmount, // will be recalculated
        });
      }
      return next;
    });
  }, [calcData]);

  // Recalculate bonus distribution when months change
  const recalculatedDistribution = useMemo(() => {
    if (!calcData) return [];
    const totalMonths = Array.from(employeeMonths.values()).reduce(
      (sum, e) => sum + e.manualMonths,
      0
    );
    return Array.from(employeeMonths.values()).map((entry) => ({
      ...entry,
      bonusAmount:
        totalMonths > 0 && calcData.totalBonusAmount > 0
          ? Math.round((entry.manualMonths / totalMonths) * calcData.totalBonusAmount * 100) / 100
          : 0,
    }));
  }, [employeeMonths, calcData?.totalBonusAmount]);

  const toggleExpanded = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Update months worked for an employee
  const handleMonthsChange = (employeeId: string, value: string) => {
    const numVal = parseInt(value) || 0;
    const clampedVal = Math.min(Math.max(numVal, 0), 12);
    setEmployeeMonths((prev) => {
      const next = new Map(prev);
      const entry = next.get(employeeId);
      if (entry) {
        next.set(employeeId, { ...entry, manualMonths: clampedVal });
      }
      return next;
    });
  };

  // Reset months to auto-calculated value
  const handleResetMonths = (employeeId: string) => {
    setEmployeeMonths((prev) => {
      const next = new Map(prev);
      const entry = next.get(employeeId);
      if (entry) {
        next.set(employeeId, { ...entry, manualMonths: entry.calculatedMonths });
      }
      return next;
    });
  };

  // Create employee
  const handleCreateEmployee = async () => {
    if (!empName.trim()) {
      toast.error('กรุณาใส่ชื่อพนักงาน');
      return;
    }
    setCreatingEmp(true);
    try {
      await createEmployee({
        name: empName.trim(),
        phone: empPhone.trim() || undefined,
        hireDate: empHireDate || undefined,
      });
      toast.success('เพิ่มพนักงานสำเร็จ');
      setEmpDialogOpen(false);
      setEmpName('');
      setEmpPhone('');
      setEmpHireDate('');
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setCreatingEmp(false);
    }
  };

  // Save bonus for all employees
  const handleSaveBonuses = async () => {
    if (!calcData || recalculatedDistribution.length === 0) {
      toast.error('ไม่มีพนักงานหรือข้อมูลโบนัส');
      return;
    }
    setSaving(true);
    try {
      // Create a bonus record for each employee with manually entered months
      await Promise.all(
        recalculatedDistribution
          .filter((e) => e.manualMonths > 0 && e.bonusAmount > 0)
          .map((emp) =>
            createSortingBonus({
              date: new Date().toISOString(),
              employeeId: emp.employeeId,
              totalWeight: calcData.totalSortedWeight,
              ratePerKg: 0, // Not used in new system
              totalAmount: emp.bonusAmount, // Use calculated amount directly
              note: `โบนัสประจำปี ${calcData.year} (${emp.manualMonths} เดือน)`,
            })
          )
      );
      toast.success('บันทึกโบนัสพนักงานสำเร็จ');
      setSaveDialogOpen(false);
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  };

  // Mark as paid
  const handleMarkPaid = async (bonus: SortingBonus) => {
    try {
      await updateBonus(bonus.id, { isPaid: true, paidDate: new Date().toISOString() });
      toast.success('บันทึกจ่ายโบนัสสำเร็จ');
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  // Delete bonus
  const handleDelete = async (bonus: SortingBonus) => {
    if (!confirm(`ต้องการลบโบนัสของ ${bonus.employee.name} ใช่ไหม?`)) return;
    try {
      await deleteBonus(bonus.id);
      toast.success('ลบโบนัสสำเร็จ');
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  };

  // Group bonus items by source → sorted product
  const groupedBySource = new Map<string, {
    sourceName: string;
    items: BonusCalcData['bonusItems'];
  }>();
  if (calcData) {
    for (const item of calcData.bonusItems) {
      const key = item.sourceProductId;
      if (!groupedBySource.has(key)) {
        groupedBySource.set(key, { sourceName: item.sourceProductName, items: [] });
      }
      groupedBySource.get(key)!.items.push(item);
    }
  }

  // Summary stats for history tab
  const totalUnpaid = bonuses.filter((b) => !b.isPaid).reduce((s, b) => s + b.totalAmount, 0);
  const totalPaid = bonuses.filter((b) => b.isPaid).reduce((s, b) => s + b.totalAmount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">โบนัสพนักงาน</h2>
          <p className="text-gray-500 mt-1">
            โบนัสจากการคัดแยก = กำไรขั้นต้น × 10%
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setEmpDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            เพิ่มพนักงาน
          </Button>
        </div>
      </div>

      {/* Tab switch */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'calculation' ? 'default' : 'outline'}
          size="sm"
          className={activeTab === 'calculation' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
          onClick={() => setActiveTab('calculation')}
        >
          <Calculator className="h-4 w-4 mr-1" />
          คำนวณโบนัสประจำปี
        </Button>
        <Button
          variant={activeTab === 'history' ? 'default' : 'outline'}
          size="sm"
          className={activeTab === 'history' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
          onClick={() => setActiveTab('history')}
        >
          <Gift className="h-4 w-4 mr-1" />
          ประวัติโบนัส
        </Button>
      </div>

      {activeTab === 'calculation' ? (
        <CalculationTab
          calcData={calcData}
          loading={loading}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          yearOptions={yearOptions}
          groupedBySource={groupedBySource}
          expandedItems={expandedItems}
          toggleExpanded={toggleExpanded}
          showAllDetails={showAllDetails}
          setShowAllDetails={setShowAllDetails}
          employeeMonths={employeeMonths}
          recalculatedDistribution={recalculatedDistribution}
          onMonthsChange={handleMonthsChange}
          onResetMonths={handleResetMonths}
          onSave={() => setSaveDialogOpen(true)}
        />
      ) : (
        <HistoryTab
          bonuses={bonuses}
          loading={loading}
          totalUnpaid={totalUnpaid}
          totalPaid={totalPaid}
          onMarkPaid={handleMarkPaid}
          onDelete={handleDelete}
        />
      )}

      {/* Create Employee Dialog */}
      <Dialog open={empDialogOpen} onOpenChange={setEmpDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>เพิ่มพนักงาน</DialogTitle>
            <DialogDescription>
              เพิ่มรายชื่อพนักงานสำหรับคำนวณโบนัส
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>ชื่อพนักงาน</Label>
              <Input
                placeholder="ชื่อ-นามสกุล"
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>เบอร์โทร (ไม่จำเป็น)</Label>
              <Input
                placeholder="08x-xxx-xxxx"
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>วันเริ่มงาน</Label>
              <Input
                type="date"
                value={empHireDate}
                onChange={(e) => setEmpHireDate(e.target.value)}
              />
              <p className="text-xs text-gray-400">ใช้คำนวณสัดส่วนโบนัส ถ้าไม่กรอกจะใช้วันที่สร้าง</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmpDialogOpen(false)}
              disabled={creatingEmp}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleCreateEmployee}
              disabled={creatingEmp}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {creatingEmp ? 'กำลังบันทึก...' : 'เพิ่มพนักงาน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Bonus Confirmation Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันบันทึกโบนัสประจำปี</DialogTitle>
            <DialogDescription>
              บันทึกโบนัสพนักงานประจำปี {calcData?.year}
            </DialogDescription>
          </DialogHeader>
          {calcData && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-pink-50 border border-pink-200">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-pink-700">ยอดโบนัสรวม:</span>
                  <span className="text-pink-900 font-bold">{formatBaht(calcData.totalBonusAmount)} บาท</span>
                </div>
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-2">
                  {recalculatedDistribution
                    .filter((e) => e.manualMonths > 0 && e.bonusAmount > 0)
                    .map((emp) => (
                      <div key={emp.employeeId} className="flex justify-between text-sm">
                        <span className="text-gray-700">{emp.employeeName} ({emp.manualMonths} เดือน)</span>
                        <span className="font-semibold text-pink-700">{formatBaht(emp.bonusAmount)} บาท</span>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleSaveBonuses}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกโบนัส'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---- Calculation Tab ---- */
function CalculationTab({
  calcData,
  loading,
  selectedYear,
  setSelectedYear,
  yearOptions,
  groupedBySource,
  expandedItems,
  toggleExpanded,
  showAllDetails,
  setShowAllDetails,
  employeeMonths,
  recalculatedDistribution,
  onMonthsChange,
  onResetMonths,
  onSave,
}: {
  calcData: BonusCalcData | null;
  loading: boolean;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  yearOptions: number[];
  groupedBySource: Map<string, { sourceName: string; items: BonusCalcData['bonusItems'] }>;
  expandedItems: Set<string>;
  toggleExpanded: (key: string) => void;
  showAllDetails: boolean;
  setShowAllDetails: (v: boolean) => void;
  employeeMonths: Map<string, EmployeeMonthEntry>;
  recalculatedDistribution: EmployeeMonthEntry[];
  onMonthsChange: (employeeId: string, value: string) => void;
  onResetMonths: (employeeId: string) => void;
  onSave: () => void;
}) {
  if (loading) return <BonusSkeleton />;

  return (
    <div className="space-y-6">
      {/* Year Selector + Summary */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium text-gray-700">ปี</Label>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {calcData && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>ใบคัดแยก: {calcData.sortingBillCount} ใบ</span>
            <span>·</span>
            <span>น้ำหนักรวม: {formatWeight(calcData.totalSortedWeight)}</span>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {calcData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <Card className="bg-pink-50 border-pink-200">
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs font-medium text-pink-700">กองทุนโบนัสรวม</p>
              <p className="text-lg sm:text-xl font-bold text-pink-900">
                {formatBaht(calcData.totalBonusAmount)} บาท
              </p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs font-medium text-amber-700">น้ำหนักรวมที่คัดมา</p>
              <p className="text-lg sm:text-xl font-bold text-amber-900">
                {formatWeight(calcData.totalSortedWeight)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gray-50 border-gray-200 col-span-2 sm:col-span-1">
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs font-medium text-gray-700">จำนวนพนักงาน</p>
              <p className="text-lg sm:text-xl font-bold text-gray-900">
                {recalculatedDistribution.filter((e) => e.manualMonths > 0).length} คน
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Aggregated Items Table - Summary by source → sorted product */}
      {calcData && calcData.aggregatedItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-pink-600" />
                <CardTitle className="text-base font-semibold text-gray-900">
                  รายละเอียดโบนัสตามรายการ
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowAllDetails(!showAllDetails)}
              >
                {showAllDetails ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดทั้งหมด'}
                {showAllDetails ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs">จาก (ต้นทาง)</TableHead>
                    <TableHead className="text-xs">→ ได้ (คัดแยก)</TableHead>
                    <TableHead className="text-right text-xs">น้ำหนักรวม</TableHead>
                    <TableHead className="text-right text-xs">ราคาต้นทาง/กก.</TableHead>
                    <TableHead className="text-right text-xs">ราคาคัดได้/กก.</TableHead>
                    <TableHead className="text-right text-xs">กำไรขั้นต้น</TableHead>
                    <TableHead className="text-right text-xs">โบนัส 10%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calcData.aggregatedItems.map((item, idx) => {
                    const key = `${item.sourceProductId}_${item.sortedProductId}`;
                    const isExpanded = expandedItems.has(key) || showAllDetails;
                    const detailItems = calcData.bonusItems.filter(
                      (b) => b.sourceProductId === item.sourceProductId && b.sortedProductId === item.sortedProductId
                    );

                    return (
                      <Fragment key={key}>
                        <TableRow
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => toggleExpanded(key)}
                        >
                          <TableCell className="font-medium text-xs sm:text-sm text-gray-900">
                            {item.sourceProductName}
                          </TableCell>
                          <TableCell className="text-xs sm:text-sm text-pink-700 font-medium">
                            → {item.sortedProductName}
                          </TableCell>
                          <TableCell className="text-right text-xs sm:text-sm font-medium">
                            {formatWeight(item.totalWeight)}
                          </TableCell>
                          <TableCell className="text-right text-xs sm:text-sm text-gray-600">
                            {formatBaht(item.sourcePricePerKg)}
                          </TableCell>
                          <TableCell className="text-right text-xs sm:text-sm text-gray-600">
                            {formatBaht(item.sortedPricePerKg)}
                          </TableCell>
                          <TableCell className="text-right text-xs sm:text-sm text-green-700">
                            {formatBaht(item.totalGrossProfit)}
                          </TableCell>
                          <TableCell className="text-right text-xs sm:text-sm font-bold text-pink-700">
                            {formatBaht(item.totalBonusAmount)}
                          </TableCell>
                        </TableRow>
                        {isExpanded && detailItems.map((detail, dIdx) => (
                          <TableRow key={`${key}_d${dIdx}`} className="bg-gray-50/50">
                            <TableCell colSpan={2} className="text-xs text-gray-500 pl-6">
                              {formatDate(detail.date)} · {formatWeight(detail.sourceWeight)} กก. ต้นทาง
                            </TableCell>
                            <TableCell className="text-right text-xs text-gray-500">
                              {formatWeight(detail.sortedWeight)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-gray-500">
                              {formatBaht(detail.sourcePricePerKg)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-gray-500">
                              {formatBaht(detail.sortedPricePerKg)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-gray-500">
                              {formatBaht(detail.grossProfit)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-pink-600">
                              {formatBaht(detail.bonusAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Employee Distribution - EDITABLE MONTHS */}
      {calcData && recalculatedDistribution.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-pink-600" />
              <CardTitle className="text-base font-semibold text-gray-900">
                การแบ่งโบนัสให้พนักงาน
              </CardTitle>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              แก้ไขจำนวนเดือนทำงานได้ (สูงสุด 12 เดือน) · แบ่งตามสัดส่วนเดือนทำงานในปี {calcData.year}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs">พนักงาน</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">วันเริ่มงาน</TableHead>
                    <TableHead className="text-center text-xs">เดือนทำงาน</TableHead>
                    <TableHead className="text-right text-xs">สัดส่วน</TableHead>
                    <TableHead className="text-right text-xs">โบนัส</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recalculatedDistribution
                    .map((emp) => {
                      const totalMonths = recalculatedDistribution.reduce((s, e) => s + e.manualMonths, 0);
                      const ratio = totalMonths > 0 ? (emp.manualMonths / totalMonths * 100) : 0;
                      const isModified = emp.manualMonths !== emp.calculatedMonths;
                      return { ...emp, ratio, isModified, totalMonths };
                    })
                    .map((emp) => (
                      <TableRow key={emp.employeeId} className={emp.manualMonths === 0 ? 'opacity-50' : ''}>
                        <TableCell className="font-medium text-sm">
                          <div>
                            {emp.employeeName}
                          </div>
                          {/* Show hire date on mobile */}
                          <div className="sm:hidden text-xs text-gray-400 mt-0.5">
                            {emp.hireDate ? formatDate(emp.hireDate).split(' ')[0] : '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500 hidden sm:table-cell">
                          {emp.hireDate ? formatDate(emp.hireDate).split(' ')[0] : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              min="0"
                              max="12"
                              value={emp.manualMonths}
                              onChange={(e) => onMonthsChange(emp.employeeId, e.target.value)}
                              className="w-16 h-8 text-center text-sm px-1"
                            />
                            <span className="text-xs text-gray-400">/12</span>
                            {emp.isModified && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-amber-500 hover:text-amber-700"
                                title="รีเซ็ตเป็นค่าอัตโนมัติ"
                                onClick={() => onResetMonths(emp.employeeId)}
                              >
                                <Edit3 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          {emp.isModified && (
                            <p className="text-[10px] text-amber-500 mt-0.5 text-center">
                              อัตโนมัติ: {emp.calculatedMonths} เดือน
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-600">
                          {emp.manualMonths > 0 ? `${emp.ratio.toFixed(1)}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold text-pink-700">
                          {emp.manualMonths > 0 ? `${formatBaht(emp.bonusAmount)} บาท` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  {/* Total row */}
                  <TableRow className="bg-pink-50 font-semibold">
                    <TableCell className="text-sm text-pink-900">รวม</TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="text-center text-sm text-pink-900">
                      {recalculatedDistribution.reduce((s, e) => s + e.manualMonths, 0)} เดือน
                    </TableCell>
                    <TableCell className="text-right text-sm text-pink-900">100%</TableCell>
                    <TableCell className="text-right text-sm font-bold text-pink-900">
                      {formatBaht(calcData.totalBonusAmount)} บาท
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Employees with 0 months */}
            {recalculatedDistribution.some((e) => e.manualMonths === 0) && (
              <div className="px-4 py-3 border-t">
                <p className="text-xs text-gray-400 mb-1">พนักงานที่ไม่มีส่วนแบ่ง (0 เดือน)</p>
                <div className="flex flex-wrap gap-1">
                  {recalculatedDistribution
                    .filter((e) => e.manualMonths === 0)
                    .map((emp) => (
                      <Badge
                        key={emp.employeeId}
                        variant="secondary"
                        className="bg-gray-100 text-gray-400 hover:bg-gray-100 text-xs"
                      >
                        {emp.employeeName}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {calcData && calcData.aggregatedItems.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Gift className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">ยังไม่มีข้อมูลคัดแยกในปี {selectedYear}</p>
            <p className="text-gray-400 text-sm mt-1">เมื่อมีการคัดแยกและบันทึกโบนัส จะแสดงที่นี่</p>
          </CardContent>
        </Card>
      )}

      {/* Save Bonus Button */}
      {calcData && calcData.totalBonusAmount > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={onSave}
            className="bg-pink-600 hover:bg-pink-700 text-white"
          >
            <Gift className="h-4 w-4 mr-1" />
            บันทึกจ่ายโบนัสประจำปี {calcData.year}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---- History Tab ---- */
function HistoryTab({
  bonuses,
  loading,
  totalUnpaid,
  totalPaid,
  onMarkPaid,
  onDelete,
}: {
  bonuses: SortingBonus[];
  loading: boolean;
  totalUnpaid: number;
  totalPaid: number;
  onMarkPaid: (bonus: SortingBonus) => void;
  onDelete: (bonus: SortingBonus) => void;
}) {
  if (loading) return <BonusSkeleton />;

  // Group bonuses by employee
  const bonusesByEmployee = new Map<string, { employee: { id: string; name: string }; bonuses: SortingBonus[]; totalUnpaid: number }>();
  for (const b of bonuses) {
    const key = b.employeeId;
    if (!bonusesByEmployee.has(key)) {
      bonusesByEmployee.set(key, { employee: b.employee, bonuses: [], totalUnpaid: 0 });
    }
    const entry = bonusesByEmployee.get(key)!;
    entry.bonuses.push(b);
    if (!b.isPaid) entry.totalUnpaid += b.totalAmount;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs font-medium text-amber-700">ยังไม่จ่าย</p>
            <p className="text-lg sm:text-xl font-bold text-amber-900">
              {formatBaht(totalUnpaid)} บาท
            </p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs font-medium text-green-700">จ่ายแล้ว</p>
            <p className="text-lg sm:text-xl font-bold text-green-900">
              {formatBaht(totalPaid)} บาท
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bonus List by Employee */}
      {bonuses.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-gray-400 text-center py-8 text-sm">
              ยังไม่มีข้อมูลโบนัส
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[calc(100vh-400px)]">
          <div className="space-y-4 pr-1">
            {Array.from(bonusesByEmployee.values()).map(({ employee, bonuses: empBonuses, totalUnpaid }) => (
              <Card key={employee.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-amber-600" />
                      <CardTitle className="text-base font-semibold text-gray-900">
                        {employee.name}
                      </CardTitle>
                    </div>
                    {totalUnpaid > 0 && (
                      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                        ค้างจ่าย {formatBaht(totalUnpaid)} บาท
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-gray-50">
                    {empBonuses.map((bonus) => (
                      <div key={bonus.id} className={`px-4 py-3 ${bonus.isPaid ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant="secondary"
                                className={
                                  bonus.isPaid
                                    ? 'bg-green-100 text-green-700 hover:bg-green-100 shrink-0'
                                    : 'bg-amber-100 text-amber-700 hover:bg-amber-100 shrink-0'
                                }
                              >
                                {bonus.isPaid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
                              </Badge>
                              <span className="text-sm text-gray-500">
                                {formatDate(bonus.date)}
                              </span>
                            </div>
                            <div className="space-y-0.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-500">น้ำหนัก</span>
                                <span className="font-medium">{formatWeight(bonus.totalWeight)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-700 font-medium">ยอดโบนัส</span>
                                <span className="font-bold text-pink-700">
                                  {formatBaht(bonus.totalAmount)} บาท
                                </span>
                              </div>
                              {bonus.note && (
                                <p className="text-xs text-gray-400">{bonus.note}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            {!bonus.isPaid && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-green-300 text-green-700 hover:bg-green-50 text-xs h-7"
                                onClick={() => onMarkPaid(bonus)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                จ่าย
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-400 hover:text-red-600 hover:bg-red-50 text-xs h-7"
                              onClick={() => onDelete(bonus)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/* ---- Skeleton ---- */
function BonusSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3 sm:p-4 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-5 w-32" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
