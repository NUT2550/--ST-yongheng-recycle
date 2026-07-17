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
 *
 * ST-8 Blocker 3 (production parity): the apply controller delegates
 * actual bill creation to the deps' `createPurchaseBill` /
 * `createSalesBill` callbacks. The Production route
 * (src/app/api/import/apply/route.ts) implements those callbacks as
 * thin adapters over the SHARED services `createBuyBillService` /
 * `createSellBillService` (from ./bill-services) — it does NOT contain
 * a second bill engine. Tests inject mock callbacks.
 *
 * ST-8 Blocker 7 (P2002 mapping): when the shared service hits a Prisma
 * P2002 (unique constraint violation), it throws `DuplicateExistingError`.
 * The apply controller catches that specific error class and classifies
 * the bill as DUPLICATE_EXISTING (not FAILED) so the rest of the batch
 * continues. Other errors bubble up as FAILED.
 *
 * ST-8 rev 2 (one lookup per request): the original
 * `findExistingBillNumber(type, normalized)` was called PER BILL inside
 * `applyImport` — and each call loaded ALL historical bills from the DB
 * (O(N*M) where N = batch size, M = total existing bills). The new
 * `loadExistingBillNumbers(type, normalizedCandidates)` is called ONCE
 * per import request — it returns a Set<string> of all NORMALIZED bill
 * numbers that already exist in the DB. The apply controller then
 * performs an in-memory `existingSet.has(norm)` check per bill — O(1)
 * per bill. To detect in-file duplicates (bill A and bill B in the same
 * upload both claim number X), the controller adds each successfully
 * imported (or P2002-rejected) bill's normalized number to the
 * existingSet AFTER processing — so later bills in the same batch are
 * correctly classified as DUPLICATE_EXISTING.
 */

import { DuplicateExistingError } from './bill-services';

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
 *   1. INVALID           — missing externalBillNumber, no valid items,
 *                          or any item has invalid weight/price (NaN,
 *                          Infinity, <= 0 weight, < 0 price)
 *   2. UNMATCHED_PRODUCT — at least one item has matched=false
 *   3. READY             — otherwise
 *
 * DUPLICATE_EXISTING / DUPLICATE_IN_FILE / INSUFFICIENT_STOCK / FAILED
 * are determined later by the apply controller.
 *
 * ST-8 rev 2 input safety: weight must be finite and > 0; pricePerKg
 * must be finite and >= 0. NaN, Infinity, -Infinity, negative weight,
 * zero weight, and negative price all classify the bill as INVALID
 * (zero write — no DB query, no bill creation, no stock modification).
 */
export function classifyBillStatus(bill: ParsedBill): BillClassification {
  // INVALID: missing externalBillNumber
  if (isBlankBillNumber(bill.externalBillNumber)) {
    return 'INVALID';
  }
  // ST-8 rev 2 Fix 3: INVALID if date is missing, blank, or does not parse
  // to a valid Date. The route preserves missing/invalid dates as '' (it
  // NEVER fabricates dates via new Date().toISOString()). The shared
  // service also validates — but classifying here means zero write (no
  // createPurchaseBill / createSalesBill call) instead of FAILED.
  if (
    typeof bill.date !== 'string' ||
    bill.date.trim() === '' ||
    Number.isNaN(new Date(bill.date).getTime())
  ) {
    return 'INVALID';
  }
  // INVALID: no items, or no items with valid weight + price
  const validItems = bill.items.filter(
    (i) =>
      typeof i.weight === 'number' &&
      Number.isFinite(i.weight) &&
      i.weight > 0 &&
      typeof i.pricePerKg === 'number' &&
      Number.isFinite(i.pricePerKg) &&
      i.pricePerKg >= 0
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
// Server-side product validation (pure — used by the route + tests)
// ============================================================================

/**
 * ST-8 rev 2 (no client trust): override the client-supplied `matched`
 * flag on each ParsedBillItem based on SERVER-SIDE product validation.
 *
 * The route handler does ONE batch DB query to fetch all valid productIds
 * (db.product.findMany with `where: { id: { in: [...] } }}`), then calls
 * this pure function to override `matched` on every item. The client's
 * `matched` flag is NEVER trusted — even if a malicious client sends
 * `matched: true` for an invalid productId, this function flips it to
 * `false` so the bill gets classified as UNMATCHED_PRODUCT (zero write).
 *
 * @param bills              — parsed bills (mutated in-place + returned)
 * @param validProductIds    — Set of productIds that exist in the DB
 * @returns the same bills array (for chaining); each item's `matched`
 *          field is set to `validProductIds.has(item.productId)`
 */
export function overrideMatchedFlagFromServerValidation(
  bills: ParsedBill[],
  validProductIds: Set<string>
): ParsedBill[] {
  for (const bill of bills) {
    for (const item of bill.items) {
      item.matched = validProductIds.has(item.productId);
    }
  }
  return bills;
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

/**
 * Injectable dependencies for the apply controller.
 *
 * ST-8 rev 2: `loadExistingBillNumbers` replaces `findExistingBillNumber`.
 * The new function is called ONCE per import request (not per bill) and
 * returns a Set<string> of all NORMALIZED bill numbers that already exist
 * in the DB. The apply controller then performs an O(1) `set.has(norm)`
 * check per bill.
 */
export interface ImportApplyDeps {
  /**
   * Batch-load all NORMALIZED bill numbers that already exist in the DB
   * for the given type. Called ONCE per import request.
   *
   * @param type                 — 'purchase' or 'sales'
   * @param normalizedCandidates — array of normalized bill numbers to check
   *                               (may include '' entries; those are ignored)
   * @returns Set<string> of normalized bill numbers that exist in the DB
   */
  loadExistingBillNumbers: (
    type: 'purchase' | 'sales',
    normalizedCandidates: string[]
  ) => Promise<Set<string>>;

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
 *   3. ONE batch DB query: load all existing normalized bill numbers for
 *      the candidates into a Set<string>.
 *   4. For each READY bill (in array order):
 *      a. In-memory check: `existingSet.has(norm)`.
 *         If duplicate → DUPLICATE_EXISTING, skip.
 *      b. (Sales only) Pre-check stock availability.
 *         If insufficient → INSUFFICIENT_STOCK, skip.
 *      c. Attempt to create the bill. Per-bill try/catch.
 *         If success → READY (imported); add norm to existingSet.
 *         If DuplicateExistingError → DUPLICATE_EXISTING; add norm to existingSet.
 *         Other errors → FAILED.
 *   5. Return ImportSummary.
 *
 * One bill's failure does NOT abort the batch.
 *
 * ST-8 rev 2: only ONE call to `deps.loadExistingBillNumbers` is made
 * per import request (not per bill). The Set is mutated in-memory as
 * bills are processed so that later bills in the same batch correctly
 * detect in-file duplicates of earlier successful imports.
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

  // ST-8 rev 2: ONE batch DB query for the entire import request.
  // Collect ALL normalized bill numbers from the batch (including
  // in-file duplicates and invalid ones — the DB query just ignores
  // empty strings). This replaces the O(N*M) per-bill lookup.
  const allNormalized = bills.map((b) => normalizeBillNumber(b.externalBillNumber));

  let existingSet: Set<string>;
  try {
    existingSet = await deps.loadExistingBillNumbers(type, allNormalized);
  } catch {
    // If the batch duplicate check itself fails, we conservatively mark
    // every non-skipped bill as FAILED (no DB writes). This preserves
    // the "never create a duplicate" invariant.
    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];
      const norm = allNormalized[i];
      if (inFile.duplicateFlags[i]) {
        results.push({
          externalBillNumber: bill.externalBillNumber,
          normalizedBillNumber: norm,
          status: 'DUPLICATE_IN_FILE',
        });
        continue;
      }
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
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'FAILED',
        error: 'Duplicate check failed',
      });
    }
    return buildImportSummary(results);
  }

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    const norm = allNormalized[i];

    // In-file duplicate (later occurrence) — check FIRST so we don't waste
    // a create attempt on a bill we already know is a dup of an earlier one.
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

    // ST-8 rev 2: in-memory O(1) duplicate check (no DB call per bill).
    if (norm !== '' && existingSet.has(norm)) {
      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'DUPLICATE_EXISTING',
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

      // ST-8 rev 2: add the normalized number to the existingSet so that
      // later bills in the SAME batch with the same number are correctly
      // classified as DUPLICATE_EXISTING (in-file duplicate detection
      // already caught earlier occurrences, but this is defense in depth
      // for any edge case where in-file detection missed something).
      if (norm !== '') {
        existingSet.add(norm);
      }

      results.push({
        externalBillNumber: bill.externalBillNumber,
        normalizedBillNumber: norm,
        status: 'READY',
        billNumber: created.billNumber,
        billId: created.id,
      });
    } catch (err) {
      // ST-8 Blocker 7: DuplicateExistingError (thrown by the shared
      // createBuyBillService / createSellBillService on Prisma P2002) is
      // classified as DUPLICATE_EXISTING so the rest of the batch
      // continues. All other errors → FAILED.
      if (err instanceof DuplicateExistingError) {
        // ST-8 rev 2: add the normalized number to the existingSet so
        // that later bills in the same batch with the same number are
        // classified as DUPLICATE_EXISTING (not re-attempted).
        if (norm !== '') {
          existingSet.add(norm);
        }
        results.push({
          externalBillNumber: bill.externalBillNumber,
          normalizedBillNumber: norm,
          status: 'DUPLICATE_EXISTING',
        });
      } else {
        const message =
          err instanceof Error ? err.message : 'Unknown error during bill creation';
        results.push({
          externalBillNumber: bill.externalBillNumber,
          normalizedBillNumber: norm,
          status: 'FAILED',
          error: message,
        });
      }
      // Continue with next bill — one failure must NOT abort the batch.
    }
  }

  return buildImportSummary(results);
}
