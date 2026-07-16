/**
 * ST-8: Safe partial-success import pipeline.
 *
 * Core principle: duplicates are SKIPPED (not blocking). One duplicate
 * must NOT fail the entire batch. Valid non-duplicate bills proceed.
 *
 * This module is pure (no React, no DOM, no DB). Both the API routes
 * and the test suite import the SAME functions — no duplicated logic.
 *
 * Naming convention:
 *   - "classify" = compute a status for a single bill (pure)
 *   - "detect"   = scan a list and tag bills (pure)
 *   - "build"    = aggregate results into a summary (pure)
 */

// ============================================================================
// Types
// ============================================================================

/** A single item inside a parsed bill. Shared by purchase + sales. */
export interface ParsedBillItem {
  productId: string;
  productName: string;
  productCode?: string;
  weight: number;
  weightExpression?: string;
  pricePerKg: number;
  totalAmount: number;
  matched: boolean; // false = unmatched product (Excel name didn't resolve)
}

/** A bill parsed from Excel that's ready for import. */
export interface ParsedBill {
  externalBillNumber: string;
  seller?: string; // purchase only
  buyer?: string; // sales only
  buyerCode?: string; // sales only
  licensePlate?: string; // sales only
  date: string; // ISO date string (already parsed from Thai Buddhist format)
  note: string;
  items: ParsedBillItem[];
}

/** Classification status for a bill during the import pipeline. */
export type BillClassification =
  | 'READY' // valid, no duplicate, will be (or was) imported
  | 'DUPLICATE_EXISTING' // bill number already exists in the database
  | 'DUPLICATE_IN_FILE' // bill number appears more than once in the same upload
  | 'INVALID' // missing externalBillNumber, missing items, etc.
  | 'UNMATCHED_PRODUCT' // has at least one item where matched=false
  | 'INSUFFICIENT_STOCK' // sales only — not enough FIFO stock for an item
  | 'FAILED'; // attempt to create the bill threw an error

/** Per-bill result returned by the apply controller. */
export interface BillImportResult {
  externalBillNumber: string;
  normalizedBillNumber: string;
  status: BillClassification;
  billNumber?: string; // generated BUY-/SELL- number (set on success)
  billId?: string; // db id (set on success)
  error?: string; // error message (set on FAILED/INSUFFICIENT_STOCK)
}

/** Aggregated summary returned by the apply controller. */
export interface ImportSummary {
  importedCount: number;
  duplicateExistingCount: number;
  duplicateInFileCount: number;
  invalidCount: number;
  unmatchedCount: number;
  insufficientStockCount: number;
  failedCount: number;
  importedBills: BillImportResult[];
  skippedDuplicateBills: BillImportResult[];
  failedBills: BillImportResult[];
}

// ============================================================================
// normalizeBillNumber
// ============================================================================

/**
 * Normalize an external bill number for comparison.
 *
 * Rules (deliberately minimal — bill numbers are case-sensitive identifiers):
 *   - Trim leading/trailing whitespace.
 *   - Normalize Unicode whitespace variants (NBSP, thin space, etc.) to U+0020.
 *   - Collapse internal whitespace runs into a single space.
 *   - NFC normalization (handles Thai combining/precomposed variants).
 *   - PRESERVE case (A1051492 != a1051492 per existing data).
 *   - PRESERVE `/`, `-`, leading zeroes, and all other characters.
 *   - Do NOT convert to numeric.
 *   - Do NOT remove characters.
 *
 * @param value — raw bill number (string; non-strings return empty string)
 * @returns normalized bill number (empty string if input is blank/invalid)
 */
export function normalizeBillNumber(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Step 1: NFC normalization (canonical Thai Unicode forms)
  let s = value.normalize('NFC');
  // Step 2: Convert all Unicode whitespace variants to regular space.
  // This covers: \t \n \r \f \v, U+00A0 (NBSP), U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
  // Using \s with the Unicode flag covers all of these in one shot.
  s = s.replace(/\s+/gu, ' ');
  // Step 3: Trim leading/trailing space (now possible after step 2 normalized NBSP etc.)
  s = s.trim();
  return s;
}

/**
 * Check whether a normalized bill number is "present" (non-empty after normalization).
 */
export function isBlankBillNumber(value: unknown): boolean {
  return normalizeBillNumber(value) === '';
}

// ============================================================================
// classifyBillStatus (single-bill)
// ============================================================================

/**
 * Pre-classification: determine if a single parsed bill is structurally
 * ready to import. Does NOT check for duplicates (use detectInFileDuplicates
 * and the apply controller for that).
 *
 * Order of checks (first match wins):
 *   1. INVALID           — missing externalBillNumber or no valid items
 *   2. UNMATCHED_PRODUCT — at least one item has matched=false
 *   3. READY             — otherwise
 *
 * DUPLICATE_EXISTING / DUPLICATE_IN_FILE / INSUFFICIENT_STOCK / FAILED
 * are determined later by the apply controller.
 */
export function classifyBillStatus(bill: ParsedBill): BillClassification {
  // INVALID: missing externalBillNumber
  if (isBlankBillNumber(bill.externalBillNumber)) {
    return 'INVALID';
  }
  // INVALID: no items or all items have weight <= 0
  const validItems = bill.items.filter(
    (i) => typeof i.weight === 'number' && i.weight > 0
  );
  if (validItems.length === 0) {
    return 'INVALID';
  }
  // UNMATCHED_PRODUCT: at least one item has matched=false
  if (bill.items.some((i) => i.matched === false)) {
    return 'UNMATCHED_PRODUCT';
  }
  return 'READY';
}

// ============================================================================
// detectInFileDuplicates
// ============================================================================

export interface InFileDuplicateResult {
  /** Map from bill index → boolean (true if this bill is a later duplicate within the file) */
  duplicateFlags: boolean[];
  /** Set of normalized bill numbers that appeared more than once */
  duplicateNumbers: string[];
}

/**
 * Detect duplicate bill numbers within a single upload.
 *
 * First occurrence (in array order) is the "keeper" — NOT a duplicate.
 * Subsequent occurrences are flagged as DUPLICATE_IN_FILE.
 *
 * Two bills are considered duplicates if their NORMALIZED bill numbers
 * are equal (case-sensitive — see normalizeBillNumber).
 *
 * Blank/invalid bill numbers are NOT considered duplicates of each other
 * (they are classified as INVALID separately).
 *
 * @param bills — array of parsed bills (any order)
 * @returns duplicateFlags aligned to input order; duplicateNumbers is the
 *          set of normalized numbers that occurred more than once.
 */
export function detectInFileDuplicates(bills: ParsedBill[]): InFileDuplicateResult {
  const seen = new Map<string, number>(); // normalized → first-seen count
  const duplicateFlags = new Array<boolean>(bills.length).fill(false);
  const duplicateNumbers = new Set<string>();

  for (let i = 0; i < bills.length; i++) {
    const norm = normalizeBillNumber(bills[i].externalBillNumber);
    // Blank bill numbers are not "duplicates" — they're INVALID.
    if (norm === '') continue;

    const count = seen.get(norm) ?? 0;
    if (count === 0) {
      // First occurrence — keeper
      seen.set(norm, 1);
    } else {
      // Subsequent occurrence — flag as in-file duplicate
      duplicateFlags[i] = true;
      seen.set(norm, count + 1);
      duplicateNumbers.add(norm);
    }
  }

  return {
    duplicateFlags,
    duplicateNumbers: Array.from(duplicateNumbers),
  };
}

// ============================================================================
// buildImportSummary
// ============================================================================

/**
 * Aggregate a list of per-bill results into a summary.
 *
 * Pure: just counts and groups. No side effects.
 */
export function buildImportSummary(results: BillImportResult[]): ImportSummary {
  const summary: ImportSummary = {
    importedCount: 0,
    duplicateExistingCount: 0,
    duplicateInFileCount: 0,
    invalidCount: 0,
    unmatchedCount: 0,
    insufficientStockCount: 0,
    failedCount: 0,
    importedBills: [],
    skippedDuplicateBills: [],
    failedBills: [],
  };

  for (const r of results) {
    switch (r.status) {
      case 'READY':
        summary.importedCount++;
        summary.importedBills.push(r);
        break;
      case 'DUPLICATE_EXISTING':
        summary.duplicateExistingCount++;
        summary.skippedDuplicateBills.push(r);
        break;
      case 'DUPLICATE_IN_FILE':
        summary.duplicateInFileCount++;
        summary.skippedDuplicateBills.push(r);
        break;
      case 'INVALID':
        summary.invalidCount++;
        summary.failedBills.push(r);
        break;
      case 'UNMATCHED_PRODUCT':
        summary.unmatchedCount++;
        summary.failedBills.push(r);
        break;
      case 'INSUFFICIENT_STOCK':
        summary.insufficientStockCount++;
        summary.failedBills.push(r);
        break;
      case 'FAILED':
        summary.failedCount++;
        summary.failedBills.push(r);
        break;
    }
  }

  return summary;
}

// ============================================================================
// UI preview helpers (pure — used by both the dialog and tests)
// ============================================================================

/** Category bucket for UI preview grouping. */
export type PreviewCategory =
  | 'ready'
  | 'duplicate-existing'
  | 'duplicate-in-file'
  | 'invalid'
  | 'unmatched'
  | 'insufficient-stock';

export interface PreviewRow {
  index: number; // index in the original plannedBills array
  externalBillNumber: string;
  normalizedBillNumber: string;
  category: PreviewCategory;
}

/**
 * Categorize planned bills for UI preview.
 *
 * Combines the in-file duplicate detection with existing-duplicate flags
 * (from the batch check API) and pre-classification.
 *
 * @param bills             — planned bills (any order)
 * @param existingDuplicates — set of NORMALIZED bill numbers that already exist in DB
 * @param insufficientStock  — optional set of normalized numbers flagged for insufficient stock (sales)
 * @returns PreviewRow[] aligned to input order
 */
export function categorizeBillsForPreview(
  bills: ParsedBill[],
  existingDuplicates: Set<string>,
  insufficientStock?: Set<string>
): PreviewRow[] {
  const inFile = detectInFileDuplicates(bills);
  const rows: PreviewRow[] = [];

  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    const norm = normalizeBillNumber(b.externalBillNumber);

    let category: PreviewCategory;
    if (norm === '') {
      category = 'invalid';
    } else if (inFile.duplicateFlags[i]) {
      category = 'duplicate-in-file';
    } else if (existingDuplicates.has(norm)) {
      category = 'duplicate-existing';
    } else if (insufficientStock?.has(norm)) {
      category = 'insufficient-stock';
    } else {
      const status = classifyBillStatus(b);
      if (status === 'INVALID') category = 'invalid';
      else if (status === 'UNMATCHED_PRODUCT') category = 'unmatched';
      else category = 'ready';
    }

    rows.push({
      index: i,
      externalBillNumber: b.externalBillNumber,
      normalizedBillNumber: norm,
      category,
    });
  }

  return rows;
}

/**
 * Compute counts per category for UI display.
 */
export function countByCategory(rows: PreviewRow[]): Record<PreviewCategory, number> {
  const counts: Record<PreviewCategory, number> = {
    ready: 0,
    'duplicate-existing': 0,
    'duplicate-in-file': 0,
    invalid: 0,
    unmatched: 0,
    'insufficient-stock': 0,
  };
  for (const r of rows) {
    counts[r.category]++;
  }
  return counts;
}

/**
 * Determine if the Apply button should be enabled.
 *
 * Apply is enabled IFF there is at least one READY bill AND we are not
 * currently importing AND we are not currently loading the file.
 *
 * Duplicates, invalid, unmatched, and insufficient-stock bills do NOT
 * block the Apply button — they're just skipped.
 */
export function shouldEnableApply(
  readyCount: number,
  isImporting: boolean,
  isLoading: boolean
): boolean {
  if (isImporting || isLoading) return false;
  return readyCount > 0;
}

// ============================================================================
// Apply controller (injectable deps — same pattern as ST-10)
// ============================================================================

/** Auth payload (mirrors src/lib/auth.ts JWTPayload — kept here for test isolation). */
export interface ImportActor {
  userId: string;
  username: string;
  name: string;
  role: 'admin' | 'staff';
}

/** Injectable dependencies for the apply controller. */
export interface ImportApplyDeps {
  /** Returns true if a bill with the given NORMALIZED number already exists in DB. */
  findExistingBillNumber: (
    type: 'purchase' | 'sales',
    normalizedBillNumber: string
  ) => Promise<boolean>;

  /** Pre-check stock availability for sales bills (returns first failing item if any). */
  checkStockAvailability?: (
    items: ParsedBillItem[]
  ) => Promise<
    | { ok: true }
    | {
        ok: false;
        productId: string;
        productName?: string;
        available: number;
        requested: number;
      }
  >;

  /** Create a purchase bill. MUST be transactional (writes BuyBill + items + StockLots + AuditLog). */
  createPurchaseBill: (
    bill: ParsedBill,
    actor: ImportActor
  ) => Promise<{ id: string; billNumber: string }>;

  /** Create a sales bill. MUST be transactional (writes SellBill + items + FIFO deduction + AuditLog). */
  createSalesBill: (
    bill: ParsedBill,
    actor: ImportActor
  ) => Promise<{ id: string; billNumber: string }>;
}

/**
 * Apply the import: process each bill per the partial-success contract.
 *
 * Algorithm:
 *   1. Pre-classify all bills (INVALID, UNMATCHED_PRODUCT, READY).
 *   2. Detect in-file duplicates (later occurrences → DUPLICATE_IN_FILE).
 *   3. For each READY bill (in array order):
 *      a. Re-check duplicate at apply time (concurrency protection).
 *         If duplicate → DUPLICATE_EXISTING, skip.
 *      b. (Sales only) Pre-check stock availability.
 *         If insufficient → INSUFFICIENT_STOCK, skip.
 *      c. Attempt to create the bill. Per-bill try/catch.
 *         If success → READY (imported).
 *         If throws  → FAILED, continue with next bill.
 *   4. Return ImportSummary.
 *
 * One bill's failure does NOT abort the batch.
 *
 * NOTE: The actor is trusted (auth already verified by the route handler).
 */
export async function applyImport(
  type: 'purchase' | 'sales',
  bills: ParsedBill[],
  deps: ImportApplyDeps,
  actor: ImportActor
): Promise<ImportSummary> {
  const inFile = detectInFileDuplicates(bills);
  const results: BillImportResult[] = [];

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    const norm = normalizeBillNumber(bill.externalBillNumber);

    // In-file duplicate (later occurrence) — check FIRST so we don't waste
    // an apply-time duplicate check on a bill we already know is a dup.
    if (inFile.duplicateFlags[i]) {
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'DUPLICATE_IN_FILE',
      });
      continue;
    }

    // Initial classification (INVALID / UNMATCHED_PRODUCT / READY)
    const preStatus = classifyBillStatus(bill);

    if (preStatus === 'INVALID') {
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'INVALID',
        error: 'Missing externalBillNumber or no valid items',
      });
      continue;
    }
    if (preStatus === 'UNMATCHED_PRODUCT') {
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'UNMATCHED_PRODUCT',
        error: 'Has unmatched product items',
      });
      continue;
    }

    // Concurrency re-check: another process may have created this bill
    // between preview and apply.
    try {
      const exists = await deps.findExistingBillNumber(type, norm);
      if (exists) {
        results.push({
          externalBillNumber: bill.externalBillNumber,
          normalizedBillNumber: norm,
          status: 'DUPLICATE_EXISTING',
        });
        continue;
      }
    } catch {
      // If the duplicate check itself fails, we conservatively skip the bill
      // rather than risk creating a duplicate. Classify as FAILED.
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'FAILED',
        error: 'Duplicate check failed',
      });
      continue;
    }

    // Sales only: pre-check stock availability
    if (type === 'sales' && deps.checkStockAvailability) {
      try {
        const stockCheck = await deps.checkStockAvailability(bill.items);
        if (!stockCheck.ok) {
          results.push({
            externalBillNumber: bill.externalBillNumber,
            normalizedBillNumber: norm,
            status: 'INSUFFICIENT_STOCK',
            error: `สต็อกไม่เพียงพอสำหรับ "${stockCheck.productName || stockCheck.productId}". มี: ${stockCheck.available} kg, ต้องการ: ${stockCheck.requested} kg`,
          });
          continue;
        }
      } catch {
        // Stock check failed — classify as FAILED, continue with next bill.
        results.push({
          externalBillNumber: bill.externalBillNumber,
          normalizedBillNumber: norm,
          status: 'FAILED',
          error: 'Stock availability check failed',
        });
        continue;
      }
    }

    // Attempt to create the bill — per-bill try/catch.
    try {
      const created =
        type === 'purchase'
          ? await deps.createPurchaseBill(bill, actor)
          : await deps.createSalesBill(bill, actor);

      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'READY',
        billNumber: created.billNumber,
        billId: created.id,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error during bill creation';
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'FAILED',
        error: message,
      });
      // Continue with next bill — one failure must NOT abort the batch.
    }
  }

  return buildImportSummary(results);
}
