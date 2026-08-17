'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Product, BuyCartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { formatBaht, formatWeight } from '@/lib/helpers';
import { getAuthToken, setAuthToken } from '@/lib/api';
import { classifyAuthResponse } from '@/lib/auth-response-classifier';
import { classifyImportOutcome, shouldBlockClose, shouldRefreshHistory, getOutcomeMessage, type ImportOutcomeState } from '@/lib/import-state-helper';
import { scheduleAmbiguousRefresh, type ScheduledRefreshHandle } from '@/lib/import-refresh-helper';
import * as XLSX from 'xlsx';
import {
  isValidExternalBillNumber,
  isReport04SellerSummaryRow,
  isReport04BillHeaderRow,
  isReport04ItemRow,
} from '@/lib/excel-parsers';
import {
  normalizeBillNumber,
  categorizeBillsForPreview,
  countByCategory,
  shouldEnableApply,
  type ParsedBill,
  type ParsedBillItem,
  type ImportSummary,
  type PreviewCategory,
} from '@/lib/import-pipeline';

export interface PlannedBill {
  externalBillNumber: string;
  seller: string;
  date: string; // raw date string from Excel e.g. "1/7/2569"
  note: string;
  items: Array<{
    productName: string;
    productCode: string;
    productId: string | null; // null = unmatched
    weight: number;
    pricePerKg: number;
    amount: number;
    matched: boolean;
  }>;
  totalWeight: number;
  totalAmount: number;
  excelTotalAmount: number;
  amountDiff: number;
  isDuplicate: boolean;
  // ST-8: in-file duplicate flag (later occurrence of same bill number)
  isInFileDuplicate?: boolean;
}

interface DetailedExcelImportDialogProps {
  products: Product[];
  /** ST-75: Called when session expires (401) — parent clears token + user state. */
  onSessionExpired?: () => void;
  /** Legacy callback — kept for backward compat. Called with empty array after apply. */
  onImport?: (bills: Array<{
    externalBillNumber: string;
    date: string;
    note: string;
    items: BuyCartItem[];
  }>) => void;
  /** ST-8: New callback — fired after /api/import/apply completes (success or partial). */
  onApplied?: (summary: ImportSummary) => void;
  /**
   * ST-75 P2-B: Real server-backed refresh callback — invoked when bills may have
   * committed (SUCCESS / PARTIAL_SUCCESS / AMBIGUOUS_RESULT). The parent MUST wire
   * this to an actual server fetch (e.g., reload products/stock/bills from the API).
   * Replaces the legacy onImport([]) call which did NOT actually refresh server state.
   */
  onRefreshAfterImport?: () => void | Promise<void>;
}

export function DetailedExcelImportDialog({ products, onSessionExpired, onImport, onApplied, onRefreshAfterImport }: DetailedExcelImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plannedBills, setPlannedBills] = useState<PlannedBill[]>([]);
  const [fileName, setFileName] = useState('');
  // ST-8: Set of NORMALIZED bill numbers that already exist in DB
  const [existingDuplicates, setExistingDuplicates] = useState<Set<string>>(new Set());
  // ST-8: Structured apply result (shown after apply completes)
  const [applyResult, setApplyResult] = useState<ImportSummary | null>(null);
  const [importOutcome, setImportOutcome] = useState<ImportOutcomeState>('IDLE');
  const importInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ST-75 P2-A: Track scheduled ambiguous-refresh handles so they can be
  // cancelled on unmount or dialog reset. Prevents stale-closure leaks and
  // duplicate refresh side effects if the dialog closes during the delayed
  // retry window.
  const ambiguousRefreshHandlesRef = useRef<ScheduledRefreshHandle[]>([]);

  // ST-75 P2-A: Cancel any pending delayed refreshes on unmount.
  useEffect(() => {
    return () => {
      for (const handle of ambiguousRefreshHandlesRef.current) {
        handle.cancel();
      }
      ambiguousRefreshHandlesRef.current = [];
    };
  }, []);

  // ST-75 P2-A: Schedule a bounded delayed reconciliation refresh for ambiguous
  // outcomes (429/5xx after apply dispatch, network error, or malformed 2xx
  // summary classified as AMBIGUOUS_RESULT). The backend MAY still be
  // committing bills when the immediate refresh fires — the delayed retries
  // give the commit time to land so the UI eventually shows authoritative
  // state. This is a GET/read refresh only; it NEVER re-issues the POST
  // /api/import/apply mutation.
  const scheduleAmbiguousImportRefresh = () => {
    const handle = scheduleAmbiguousRefresh(() => {
      onRefreshAfterImport?.();
    });
    ambiguousRefreshHandlesRef.current.push(handle);
  };

  // Build product lookup map: normalized exact name → product
  // NFC normalization handles Thai Unicode variant differences (combining vs precomposed)
  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      m.set(p.name.trim().normalize('NFC'), p);
    }
    return m;
  }, [products]);

  // Safe aliases: map common Excel name variants to canonical product names
  // Only within the same material category — no cross-category guessing.
  // NOTE: All MetalTrack aluminum product names use "อลูมิเนียม" spelling
  // (normalized from "อลูมีเนียม" per owner decision Task 35).
  const safeAliases: Record<string, string> = {
    'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
    'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
    'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
    'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
  };

  // Fix Thai text garbled by XLSX library in browser (TIS-620 read as Latin-1)
  function fixThaiText(text: string): string {
    if (!text) return text;
    // Check if text looks like garbled Thai (chars in 0xA0-0xFF range = Latin-1 extended)
    const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF);
    if (!hasGarbled) return text; // already proper UTF-8 Thai
    try {
      const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF));
      return new TextDecoder('windows-874').decode(bytes);
    } catch {
      return text;
    }
  }

  function matchProduct(excelName: string): Product | null {
    // Standardize aluminum spelling: อลูมีเนียม → อลูมิเนียม
    // (per owner Decision 1, Task 35 — all MetalTrack products now use อลูมิเนียม spelling.
    //  Old Excel files may still use อลูมีเนียม, so normalize before matching.)
    const normalizedInput = excelName.replace(/อลูมีเนียม/g, 'อลูมิเนียม');
    const trimmed = normalizedInput.trim().normalize('NFC');
    // 1. Exact match (normalized)
    if (productMap.has(trimmed)) return productMap.get(trimmed)!;
    // 2. Safe alias (normalized)
    const alias = safeAliases[normalizedInput.trim()]?.normalize('NFC');
    if (alias && productMap.has(alias)) return productMap.get(alias)!;
    // 3. Try contains match (single result only — no ambiguity, normalized)
    const contains = products.filter(p => {
      const pn = p.name.normalize('NFC');
      return pn.includes(trimmed) || trimmed.includes(pn);
    });
    if (contains.length === 1) return contains[0];
    return null;
  }

  function parseThaiDate(dateStr: string): string {
    // Parse "1/7/2569" (Thai Buddhist year) → ISO date
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const buddhistYear = parseInt(parts[2]);
      const ceYear = buddhistYear - 543;
      return new Date(ceYear, month, day, 10, 0, 0).toISOString();
    }
    return new Date().toISOString();
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      // User cancelled the file picker — not an error
      return;
    }

    // ST-15: Validate file type before parsing
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.xls') && !lowerName.endsWith('.xlsx')) {
      toast.error('ไฟล์ต้องเป็น .xls หรือ .xlsx เท่านั้น');
      // Reset input so the same file can be "selected" again
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setLoading(true);
    setPlannedBills([]);
    setApplyResult(null);
    setExistingDuplicates(new Set());
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', codepage: 874 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];

      // ST-16: Detect file format — report03 (per-product) vs report04 (per-seller/person)
      const row3 = rows[3] || [];
      const lastRows = rows.slice(-5).map(r => (r || []).map(c => c == null ? '' : fixThaiText(String(c))).join(' ')).join(' ');
      const isReport04 = lastRows.includes('report04') || String(row3[0] || '').includes('ผู้ขาย');
      const isReport03 = lastRows.includes('report03') || (!isReport04 && (String(row3[1] || '').includes('วัสดุ') || String(row3[0] || '').includes('วัสดุ')));
      const detectedFormat = isReport04 ? 'report04' : 'report03';

      const bills: PlannedBill[] = [];
      let currentBill: PlannedBill | null = null;
      let currentSeller = '';
      let currentProductName = '';

      if (isReport04) {
        // ST-16: report04 — per-seller (per-person) layout
        for (let i = 4; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

          if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue;
          if (fixThaiText(String(r[12] || '')).includes('report04') || fixThaiText(String(r[0] || '')).match(/^หน้าที่/)) continue;

          if (isReport04SellerSummaryRow(r)) {
            currentSeller = fixThaiText(String(r[1])).trim();
            continue;
          }

          if (isReport04BillHeaderRow(r)) {
            if (currentBill) bills.push(currentBill);
            const dateStr = fixThaiText(String(r[1])).trim();
            const billNo = String(r[2]).trim();
            const licensePlate = r[3] ? fixThaiText(String(r[3])).trim() : '';
            const note = r[4] ? fixThaiText(String(r[4])).trim() : '';
            const excelTotal = parseFloat(String(r[12])) || 0;
            currentBill = {
              externalBillNumber: billNo,
              seller: currentSeller,
              date: dateStr,
              note: note + (licensePlate ? ` | ทะเบียน: ${licensePlate}` : ''),
              items: [],
              totalWeight: 0,
              totalAmount: 0,
              excelTotalAmount: excelTotal,
              amountDiff: 0,
              isDuplicate: false,
            };
            continue;
          }

          if (isReport04ItemRow(r) && currentBill) {
            const productName = fixThaiText(String(r[3])).trim();
            const weight = parseFloat(String(r[9])) || 0;
            const pricePerKg = parseFloat(String(r[11])) || 0;
            const amount = parseFloat(String(r[12])) || 0;
            const matched = matchProduct(productName);

            currentBill.items.push({
              productName,
              productCode: String(r[2]).trim(),
              productId: matched?.id || null,
              weight,
              pricePerKg,
              amount,
              matched: !!matched,
            });
            currentBill.totalWeight += weight;
            currentBill.totalAmount += amount;
          }
        }
      } else {
        // report03: per-product layout
        for (let i = 4; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.every(c => c === null || c === undefined)) continue;

          if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue;
          if (fixThaiText(String(r[12] || '')).includes('report03') || fixThaiText(String(r[0] || '')).match(/^หน้าที่/)) continue;

          if (r[0] && /^\d{4}$/.test(String(r[0]).trim()) && r[1] && typeof r[1] === 'string' && r[9] != null) {
            currentProductName = fixThaiText(String(r[1])).trim();
            continue;
          }

          if (r[0] && r[1] && r[9] != null) {
            const dateStr = fixThaiText(String(r[0])).trim();
            const billNo = String(r[1]).trim();
            if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
              const sellerCode = String(r[2] ?? '').trim();
              const sellerName = String(r[3] ?? '').trim();
              const weight = parseFloat(String(r[9])) || 0;
              const pricePerKg = parseFloat(String(r[11])) || 0;
              const amount = parseFloat(String(r[12])) || 0;
              const note = r[6] ? fixThaiText(String(r[6])).trim() : '';

              if (!currentBill || currentBill.externalBillNumber !== billNo) {
                if (currentBill) bills.push(currentBill);
                currentBill = {
                  externalBillNumber: billNo,
                  seller: sellerName || sellerCode,
                  date: dateStr,
                  note,
                  items: [],
                  totalWeight: 0,
                  totalAmount: 0,
                  excelTotalAmount: 0,
                  amountDiff: 0,
                  isDuplicate: false,
                };
              }

              const productName = currentProductName || '(ไม่ระบุสินค้า)';
              const matched = matchProduct(productName);

              currentBill.items.push({
                productName,
                productCode: String(r[0]).trim(),
                productId: matched?.id || null,
                weight,
                pricePerKg,
                amount,
                matched: !!matched,
              });
              currentBill.totalWeight += weight;
              currentBill.totalAmount += amount;
            }
          }
        }
      }
      if (currentBill) bills.push(currentBill);

      // Calculate amount diff and round
      for (const b of bills) {
        b.totalWeight = Math.round(b.totalWeight * 100) / 100;
        b.totalAmount = Math.round(b.totalAmount * 100) / 100;
        b.amountDiff = Math.round((b.totalAmount - b.excelTotalAmount) * 100) / 100;
      }

      setPlannedBills(bills);
      toast.success(`พาร์สไฟล์สำเร็จ (${detectedFormat}): ${bills.length} บิล, ${bills.reduce((s, b) => s + b.items.length, 0)} รายการ`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast.error(`พาร์สไฟล์ไม่สำเร็จ: ${message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ST-8: Batch duplicate check — uses /api/import/check-duplicates
  // (replaces the old per-bill /api/buy-bills?externalBillNumber=X calls)
  const checkDuplicatesBatch = async () => {
    if (plannedBills.length === 0) return;
    try {
      const token = getAuthToken();
      if (!token) {
        toast.warning('ไม่สามารถตรวจบิลซ้ำได้ — กรุณา Login ใหม่');
        return;
      }
      const billNumbers = plannedBills.map(b => b.externalBillNumber);
      const res = await fetch('/api/import/check-duplicates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ billNumbers, type: 'purchase' }),
      });
      // ST-75: Use tested classifier for auth response handling
      const checkAction = classifyAuthResponse(res.status);
      if (checkAction === 'SESSION_EXPIRED') {
        toast.error('เซสชันหมดอายุ — กรุณา Login ใหม่');
        handleSessionExpired();
        return;
      }
      if (checkAction === 'PERMISSION_DENIED') {
        toast.error('ไม่มีสิทธิ์ตรวจบิลซ้ำ — กรุณาแจ้งผู้ดูแล');
        handlePermissionDenied();
        return;
      }
      if (checkAction === 'TRANSIENT_ERROR') {
        toast.error('เซิร์ฟเวอร์ไม่ตอบสนอง — กรุณาลองใหม่ภายหลัง');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const existingSet = new Set<string>((data.existing || []) as string[]);
        setExistingDuplicates(existingSet);
        // Also update per-bill isDuplicate flag for legacy UI display
        setPlannedBills(prev =>
          prev.map(b => ({
            ...b,
            isDuplicate: existingSet.has(normalizeBillNumber(b.externalBillNumber)),
          }))
        );
      }
    } catch {
      // non-fatal — network error
    }
  };

  // ST-8: Preview rows categorized for display
  const previewRows = useMemo(() => {
    // Convert PlannedBill → ParsedBill for the categorizer
    const parsedBills: ParsedBill[] = plannedBills.map(b => ({
      externalBillNumber: b.externalBillNumber,
      date: parseThaiDate(b.date),
      note: b.note,
      items: b.items.map(it => ({
        productId: it.productId || '',
        productName: it.productName,
        productCode: it.productCode,
        weight: it.weight,
        pricePerKg: it.pricePerKg,
        totalAmount: it.amount,
        matched: it.matched,
      })),
    }));
    return categorizeBillsForPreview(parsedBills, existingDuplicates);
  }, [plannedBills, existingDuplicates]);

  const categoryCounts = useMemo(() => countByCategory(previewRows), [previewRows]);

  // ST-8: hasBlockers is GONE. Duplicates are SKIPPED, not blocking.
  // The only blockers are now: nothing. Apply is enabled when readyCount > 0.
  const canImport = shouldEnableApply(
    categoryCounts.ready,
    importing,
    loading
  );

  const handleImport = async () => {
    if (!canImport) return;
    // ST-75: Double-submit guard — synchronous ref check
    if (importInFlightRef.current) return;
    importInFlightRef.current = true;
    setImporting(true);
    setImportOutcome('IMPORTING');
    setApplyResult(null);
    try {
      const token = getAuthToken();
      if (!token) {
        toast.error('ไม่ได้เข้าสู่ระบบ — กรุณา Login ใหม่');
        // ST-75: pre-dispatch — no request sent, no backend writes possible.
        setImportOutcome('IDLE');
        setImporting(false);
        return;
      }

      // Build the bills payload for /api/import/apply
      // Only include bills that are READY (preview category === 'ready')
      // The apply endpoint will also re-check duplicates at apply time.
      const readyIndices = new Set(
        previewRows.filter(r => r.category === 'ready').map(r => r.index)
      );
      const billsToApply: ParsedBill[] = plannedBills
        .map((b, idx) => ({ b, idx }))
        .filter(({ idx }) => readyIndices.has(idx))
        .map(({ b }) => ({
          externalBillNumber: b.externalBillNumber,
          date: parseThaiDate(b.date),
          note: `ผู้ขาย: ${b.seller}${b.note ? ` | ${b.note}` : ''} | นำเข้าจาก: ${fileName}`,
          items: b.items
            .filter(i => i.matched && i.productId)
            .map((i): ParsedBillItem => ({
              productId: i.productId!,
              productName: i.productName,
              productCode: i.productCode,
              weight: i.weight,
              pricePerKg: i.pricePerKg,
              totalAmount: i.amount,
              matched: true,
            })),
        }));

      if (billsToApply.length === 0) {
        toast.warning('ไม่มีบิลพร้อมนำเข้า');
        // ST-75: pre-dispatch — no request sent, no backend writes possible.
        setImportOutcome('IDLE');
        setImporting(false);
        return;
      }

      const res = await fetch('/api/import/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'purchase', bills: billsToApply }),
      });

      // ST-75: Use tested classifier for auth response handling.
      // NOTE: /api/import/apply has already been dispatched at this point.
      // For 401, the backend rejects before processing — session is expired, no writes.
      // For 403, the backend denies permission — no writes, session preserved.
      // For 429/5xx, the backend MAY have started or committed per-bill transactions.
      //   A client receiving 429/5xx after dispatch CANNOT safely claim zero writes.
      //   Therefore 429/5xx MUST be classified as AMBIGUOUS_RESULT, not a simple retry.
      const applyAction = classifyAuthResponse(res.status);
      if (applyAction === 'SESSION_EXPIRED') {
        toast.error('เซสชันหมดอายุ — กรุณา Login ใหม่');
        handleSessionExpired();
        return;
      }
      if (applyAction === 'PERMISSION_DENIED') {
        toast.error('ไม่มีสิทธิ์นำเข้าบิลซื้อ — กรุณาแจ้งผู้ดูแล');
        handlePermissionDenied();
        return;
      }
      // ST-75 F4: 429/5xx after apply dispatch → AMBIGUOUS_RESULT (backend may have committed).
      if (applyAction === 'TRANSIENT_ERROR') {
        const ambiguousOutcome = classifyImportOutcome(res.status, null, false);
        setImportOutcome(ambiguousOutcome); // AMBIGUOUS_RESULT for 429/5xx
        toast.error(getOutcomeMessage(ambiguousOutcome));
        // ST-75 P2-A: Schedule a BOUNDED delayed reconciliation refresh instead of a
        // single immediate call. The backend MAY still be committing per-bill
        // transactions when this fires — the delayed retries (default 1.5s, 4s)
        // give the commit time to land so the UI eventually shows authoritative
        // state. This is a GET/read refresh only; it NEVER re-issues the POST
        // /api/import/apply mutation.
        if (shouldRefreshHistory(ambiguousOutcome)) {
          scheduleAmbiguousImportRefresh();
        }
        return;
      }

      if (!res.ok) {
        // ST-75: other non-2xx (400/404 etc.) — confirmed client error, no commit.
        const failedOutcome = classifyImportOutcome(res.status, null, false);
        setImportOutcome(failedOutcome); // FAILED_CONFIRMED for 400/404
        const data = await res.json().catch(() => ({}));
        toast.error(`นำเข้าไม่สำเร็จ: ${data.error || res.statusText}`);
        return;
      }

      const summary = (await res.json()) as ImportSummary;
      setApplyResult(summary);

      // ST-75: Classify outcome using tested helper
      const outcome = classifyImportOutcome(res.status, summary, false);
      setImportOutcome(outcome);

      // ST-8: Structured result toast
      const parts: string[] = [`นำเข้าสำเร็จ ${summary.importedCount} บิล`];
      if (summary.duplicateExistingCount > 0) {
        parts.push(`ข้ามซ้ำ ${summary.duplicateExistingCount}`);
      }
      if (summary.duplicateInFileCount > 0) {
        parts.push(`ซ้ำในไฟล์ ${summary.duplicateInFileCount}`);
      }
      if (summary.failedCount > 0) {
        parts.push(`ล้มเหลว ${summary.failedCount}`);
      }
      if (outcome === 'SUCCESS') {
        toast.success(parts.join(' · '));
      } else if (outcome === 'PARTIAL_SUCCESS') {
        toast.warning(parts.join(' · '));
      } else if (outcome === 'AMBIGUOUS_RESULT') {
        toast.error(getOutcomeMessage(outcome));
      } else {
        toast.error(parts.join(' · ') || 'นำเข้าไม่สำเร็จ');
      }

      // ST-75 P2-B: Refresh history only when bills may have committed.
      // Use the real server-backed refresh callback instead of legacy onImport([])
      // which did not actually reload server state.
      // ST-75 P2-A: If the outcome is AMBIGUOUS_RESULT (e.g., malformed 2xx summary
      // that failed isValidImportSummary validation), schedule a BOUNDED delayed
      // reconciliation refresh — the backend MAY still be committing. For
      // SUCCESS/PARTIAL_SUCCESS, an immediate refresh is safe (backend has
      // confirmed commit).
      if (shouldRefreshHistory(outcome)) {
        if (outcome === 'AMBIGUOUS_RESULT') {
          scheduleAmbiguousImportRefresh();
        } else {
          onRefreshAfterImport?.();
        }
        onApplied?.(summary);
      }

      // ST-8: Re-check duplicates after apply so the preview reflects reality
      // (imported bills now show as duplicate-existing if user re-opens the same file)
      setTimeout(() => {
        checkDuplicatesBatch();
      }, 100);
    } catch (err) {
      // ST-75: Network error after request sent → AMBIGUOUS_RESULT
      const outcome = classifyImportOutcome(null, null, true);
      setImportOutcome(outcome);
      toast.error(getOutcomeMessage(outcome));
      // ST-75 P2-A: Schedule a BOUNDED delayed reconciliation refresh — the backend
      // may have committed before the network dropped. The delayed retries give the
      // commit time to land. This is a GET/read refresh only; it NEVER re-issues the
      // POST /api/import/apply mutation.
      if (shouldRefreshHistory(outcome)) {
        scheduleAmbiguousImportRefresh();
      }
    } finally {
      setImporting(false);
      importInFlightRef.current = false;
    }
  };

  const handleOpenChange = (v: boolean) => {
    // ST-75 F2: Guard the authoritative close path.
    // Previously, only onInteractOutside + onEscapeKeyDown checked shouldBlockClose,
    // but the X button (DialogClose) and footer Cancel call onOpenChange(false) directly,
    // bypassing those handlers. This guard ensures ALL close paths are blocked while
    // importOutcome === 'IMPORTING', and resetDialogState() (which clears
    // importInFlightRef) does NOT run while a fetch is genuinely active.
    if (!v && shouldBlockClose(importOutcome)) {
      toast.warning('กำลังนำเข้า กรุณารอผลลัพธ์ก่อน เพื่อป้องกันสถานะบิลไม่ชัดเจน');
      return;
    }
    setOpen(v);
    if (!v) {
      resetDialogState();
    }
  };

  // ST-75: Unified cleanup path — used by handleOpenChange, 401, 403, and success.
  // Prevents stale planned bills, duplicates, and state from persisting across reopens.
  const resetDialogState = () => {
    setImportOutcome('IDLE');
    importInFlightRef.current = false;
    setPlannedBills([]);
    setFileName('');
    setApplyResult(null);
    setExistingDuplicates(new Set());
    setImporting(false);
    setLoading(false);
    // ST-15: Reset file input value on close so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Reset duplicate check ref so re-opening re-checks
    duplicateChecked.current = false;
    // ST-75 P2-A: Cancel any pending delayed ambiguous-refresh timers so they
    // don't fire after the dialog has closed and been reopened with a new file
    // (which would cause a stale-closure refresh against the old state).
    for (const handle of ambiguousRefreshHandlesRef.current) {
      handle.cancel();
    }
    ambiguousRefreshHandlesRef.current = [];
  };

  // ST-75: Session expired — clear token via parent, reset dialog, close.
  const handleSessionExpired = () => {
    setAuthToken(null);
    onSessionExpired?.();
    resetDialogState();
    setOpen(false);
  };

  // ST-75: Permission denied — reset dialog + close (do NOT clear token).
  const handlePermissionDenied = () => {
    resetDialogState();
    setOpen(false);
  };

  // ST-15: Auto-check duplicates when planned bills change — moved to useEffect to avoid
  // calling async function during render (which can cause state issues).
  const duplicateChecked = useRef(false);
  useEffect(() => {
    if (plannedBills.length > 0 && !duplicateChecked.current) {
      duplicateChecked.current = true;
      checkDuplicatesBatch();
    }
    if (plannedBills.length === 0) duplicateChecked.current = false;
  }, [plannedBills]);

  // ST-8: Helper — get category for a bill index (for styling)
  function getCategoryForBill(idx: number): PreviewCategory | null {
    const row = previewRows.find(r => r.index === idx);
    return row?.category ?? null;
  }

  // ST-8: Category badge styling
  const categoryBadge: Record<PreviewCategory, { label: string; className: string }> = {
    ready: { label: 'พร้อม', className: 'bg-green-100 text-green-700' },
    'duplicate-existing': { label: 'ซ้ำในระบบ', className: 'bg-amber-100 text-amber-700' },
    'duplicate-in-file': { label: 'ซ้ำในไฟล์', className: 'bg-orange-100 text-orange-700' },
    invalid: { label: 'ไม่ถูกต้อง', className: 'bg-red-100 text-red-700' },
    unmatched: { label: 'สินค้าไม่ตรง', className: 'bg-red-100 text-red-700' },
    'insufficient-stock': { label: 'สต็อกไม่พอ', className: 'bg-red-100 text-red-700' },
  };

  // ST-8: Duplicate bill numbers list for visibility
  const duplicateBillNumbers = useMemo(() => {
    const list: Array<{ number: string; kind: 'existing' | 'in-file' }> = [];
    for (const row of previewRows) {
      if (row.category === 'duplicate-existing') {
        list.push({ number: row.externalBillNumber, kind: 'existing' });
      } else if (row.category === 'duplicate-in-file') {
        list.push({ number: row.externalBillNumber, kind: 'in-file' });
      }
    }
    return list;
  }, [previewRows]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800"
      >
        <FileSpreadsheet className="h-4 w-4 mr-1" />
        นำเข้าแบบละเอียด (แยกบิล)
      </Button>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => { if (shouldBlockClose(importOutcome)) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (shouldBlockClose(importOutcome)) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            นำเข้า Excel แบบละเอียด แยกบิลตามเลขบิล
          </DialogTitle>
          <DialogDescription>
            เลือกไฟล์ Excel รายละเอียดการซื้อ — ระบบจะแยกบิลตามเลขบิลอัตโนมัติ — บิลซ้ำจะถูกข้าม (ไม่บล็อกการนำเข้า)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* File upload */}
          {plannedBills.length === 0 ? (
            <div className="space-y-3">
              <Label htmlFor="detailed-excel-file">เลือกไฟล์ Excel (.xls/.xlsx)</Label>
              <Input
                id="detailed-excel-file"
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileSelect}
                disabled={loading}
              />
              {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังพาร์สไฟล์...
                </div>
              )}
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                <p className="font-medium mb-1">รูปแบบไฟล์ที่รองรับ:</p>
                <p>ไฟล์ Excel ที่มีคอลัมน์: ผู้ขาย, เลขบิล, รายการสินค้า, จำนวน, ราคา@, รวมเงิน</p>
                <p>ระบบจะแยกบิลตามเลขบิลอัตโนมัติ — แต่ละเลขบิล = 1 ใบรับซื้อ</p>
                <p className="mt-1 font-medium text-amber-700">ST-8: บิลซ้ำจะถูกข้าม ไม่บล็อกการนำเข้า — นำเข้าบิลอื่นได้ปกติ</p>
              </div>
            </div>
          ) : (
            <>
              {/* ST-8: Summary stats — partial success categories */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="p-2 rounded-lg bg-gray-50 border text-center">
                  <p className="text-xs text-gray-500">ทั้งหมด</p>
                  <p className="text-lg font-bold text-gray-900">{plannedBills.length}</p>
                </div>
                <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-center">
                  <p className="text-xs text-green-600">พร้อม</p>
                  <p className="text-lg font-bold text-green-700">{categoryCounts.ready}</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-center">
                  <p className="text-xs text-amber-600">ซ้ำในระบบ</p>
                  <p className="text-lg font-bold text-amber-700">{categoryCounts['duplicate-existing']}</p>
                </div>
                <div className="p-2 rounded-lg bg-orange-50 border border-orange-200 text-center">
                  <p className="text-xs text-orange-600">ซ้ำในไฟล์</p>
                  <p className="text-lg font-bold text-orange-700">{categoryCounts['duplicate-in-file']}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                  <p className="text-xs text-red-600">สินค้าไม่ตรง</p>
                  <p className="text-lg font-bold text-red-700">{categoryCounts.unmatched}</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
                  <p className="text-xs text-red-600">ไม่ถูกต้อง</p>
                  <p className="text-lg font-bold text-red-700">{categoryCounts.invalid}</p>
                </div>
              </div>

              {/* ST-8: Apply result panel (shown after apply) */}
              {applyResult && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="flex items-center gap-2 text-blue-700 font-medium text-sm mb-2">
                    <CheckCircle2 className="h-4 w-4" />
                    ผลการนำเข้า
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">นำเข้าสำเร็จ</p>
                      <p className="text-base font-bold text-green-700">{applyResult.importedCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ข้าม (ซ้ำในระบบ)</p>
                      <p className="text-base font-bold text-amber-700">{applyResult.duplicateExistingCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ข้าม (ซ้ำในไฟล์)</p>
                      <p className="text-base font-bold text-orange-700">{applyResult.duplicateInFileCount}</p>
                    </div>
                    <div className="p-2 bg-white rounded border">
                      <p className="text-gray-500">ล้มเหลว</p>
                      <p className="text-base font-bold text-red-700">{applyResult.failedCount}</p>
                    </div>
                  </div>
                  {applyResult.failedBills.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      <p className="font-medium">บิลที่ล้มเหลว:</p>
                      <div className="max-h-24 overflow-y-auto mt-1 space-y-0.5">
                        {applyResult.failedBills.map((b, i) => (
                          <div key={i}>• {b.externalBillNumber}: {b.error || b.status}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ST-8: Duplicate bill numbers — visible list */}
              {duplicateBillNumbers.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-2 text-amber-700 font-medium text-sm mb-2">
                    <Copy className="h-4 w-4" />
                    เลขบิลซ้ำ ({duplicateBillNumbers.length}) — จะถูกข้าม
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {duplicateBillNumbers.map((d, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className={
                          d.kind === 'existing'
                            ? 'bg-amber-100 text-amber-700 text-[10px]'
                            : 'bg-orange-100 text-orange-700 text-[10px]'
                        }
                      >
                        {d.number}
                        {d.kind === 'existing' ? ' (ในระบบ)' : ' (ในไฟล์)'}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched products warning */}
              {categoryCounts.unmatched > 0 && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    สินค้าที่ไม่ตรง — บิลเหล่านี้จะถูกข้าม
                  </div>
                  <div className="space-y-1">
                    {Array.from(new Set(
                      plannedBills
                        .flatMap((b, idx) =>
                          getCategoryForBill(idx) === 'unmatched'
                            ? b.items.filter(i => !i.matched).map(i => i.productName)
                            : []
                        )
                    )).map(name => {
                      const count = plannedBills
                        .flatMap((b, idx) =>
                          getCategoryForBill(idx) === 'unmatched'
                            ? b.items.filter(i => !i.matched && i.productName === name)
                            : []
                        ).length;
                      return (
                        <div key={name} className="text-xs text-red-600">
                          • {name} ({count} รายการ)
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Planned bills list */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {plannedBills.map((bill, idx) => {
                  const cat = getCategoryForBill(idx);
                  const isDup = cat === 'duplicate-existing' || cat === 'duplicate-in-file';
                  const isBlocked = cat === 'invalid' || cat === 'unmatched';
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${
                        isBlocked ? 'border-red-200 bg-red-50/30'
                        : isDup ? 'border-amber-200 bg-amber-50/30'
                        : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-900">{bill.externalBillNumber || '(ไม่มีเลขบิล)'}</span>
                          {cat && (
                            <Badge variant="secondary" className={`text-[10px] ${categoryBadge[cat].className}`}>
                              {categoryBadge[cat].label}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{bill.date}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-1">ผู้ขาย: {bill.seller}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                        <span className="text-gray-500">รายการ: <span className="font-medium text-gray-900">{bill.items.length}</span></span>
                        <span className="text-gray-500">น้ำหนัก: <span className="font-medium text-gray-900">{formatWeight(bill.totalWeight)} กก.</span></span>
                        <span className="text-gray-500">ยอด: <span className="font-medium text-gray-900">{formatBaht(bill.totalAmount)} บาท</span></span>
                      </div>
                      {Math.abs(bill.amountDiff) > 1 && (
                        <p className="text-[11px] text-amber-600">
                          ⚠ ยอดต่างจาก Excel {bill.excelTotalAmount > 0 ? `(${formatBaht(bill.excelTotalAmount)})` : ''} ไป {formatBaht(Math.abs(bill.amountDiff))} บาท
                        </p>
                      )}
                      {/* Items list */}
                      <div className="mt-1 space-y-0.5">
                        {bill.items.map((item, iIdx) => (
                          <div key={iIdx} className="flex justify-between text-[11px]">
                            <span className={item.matched ? 'text-gray-600' : 'text-red-500'}>
                              {!item.matched && '⚠ '}{item.productName}
                            </span>
                            <span className="text-gray-500">
                              {formatWeight(item.weight)} กก. @ {formatBaht(item.pricePerKg)} = {formatBaht(item.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">ยกเลิก</Button>
          </DialogClose>
          {plannedBills.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={!canImport}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {importing ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> กำลังนำเข้า...</>
              ) : (
                <>นำเข้า {categoryCounts.ready} บิล{categoryCounts.ready === 0 ? '' : ''}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
