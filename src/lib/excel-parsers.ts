/**
 * ST-16: Pure helpers for report04 Excel parser.
 *
 * Extracted from detailed-excel-import-dialog.tsx so that tests can
 * exercise the SAME code path as production — no duplicated regex.
 *
 * These functions are pure (no React, no DOM, no side-effects) and
 * can be imported by both the component and the test suite.
 */

/**
 * Check whether a string is a valid external bill number.
 *
 * Real bill numbers observed in production Excel files:
 *   - A-prefixed: A1051472, A1051492, etc.
 *   - D-prefixed: D1025582, D1025583, etc.
 *
 * Rule: single uppercase letter prefix + one or more digits, nothing else.
 * The `$` anchor rejects strings with trailing characters (e.g. "A1051492-extra").
 *
 * @param value — raw cell value from Excel (may have whitespace)
 * @returns true if the value is a valid bill number
 */
export function isValidExternalBillNumber(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[A-Z]\d+$/i.test(trimmed);
}

/**
 * Check whether a row is a report04 seller-summary row.
 *
 * Seller summary rows have:
 *   - col 0: 4-digit seller code (e.g. "0020")
 *   - col 1: seller name (non-empty)
 *   - col 2: null/empty (distinguishes from bill header and item rows)
 *   - col 12: seller total amount (number)
 *
 * @param row — array of cell values from Excel
 * @returns true if the row matches the seller-summary pattern
 */
export function isReport04SellerSummaryRow(row: unknown[]): boolean {
  const col0 = row[0];
  const col1 = row[1];
  const col2 = row[2];
  const col12 = row[12];
  return (
    !!col0 &&
    !!col1 &&
    !col2 &&
    col12 != null &&
    /^\d{4}$/.test(String(col0).trim())
  );
}

/**
 * Check whether a row is a report04 bill-header row.
 *
 * Bill header rows have:
 *   - col 1: date string (e.g. "11/7/2569")
 *   - col 2: valid external bill number (passes isValidExternalBillNumber)
 *
 * @param row — array of cell values from Excel
 * @returns true if the row matches the bill-header pattern
 */
export function isReport04BillHeaderRow(row: unknown[]): boolean {
  const col1 = row[1];
  const col2 = row[2];
  return !!col1 && isValidExternalBillNumber(col2);
}

/**
 * Check whether a row is a report04 product-item row.
 *
 * Item rows have:
 *   - col 2: product code (non-empty, but NOT a valid bill number)
 *   - col 3: product name (non-empty)
 *   - col 9: weight (non-null number)
 *
 * @param row — array of cell values from Excel
 * @returns true if the row matches the product-item pattern
 */
export function isReport04ItemRow(row: unknown[]): boolean {
  const col2 = row[2];
  const col3 = row[3];
  const col9 = row[9];
  return !!col2 && !!col3 && col9 != null && !isValidExternalBillNumber(col2);
}
