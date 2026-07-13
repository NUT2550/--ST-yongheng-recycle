/**
 * ST-16: Regression tests for report04 bill-header detection.
 *
 * These tests import the SAME helpers used by the production parser
 * (src/lib/excel-parsers.ts) — no duplicated regex.
 *
 * Run: bun test tests/st16-report04-bill-prefix.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  isValidExternalBillNumber,
  isReport04SellerSummaryRow,
  isReport04BillHeaderRow,
  isReport04ItemRow,
} from '../src/lib/excel-parsers';

describe('ST-16: isValidExternalBillNumber (production helper)', () => {
  describe('A-prefixed bills (should match)', () => {
    const aBills = ['A1051492', 'A1051473', 'A1051474', 'A1051476', 'A1051477', 'A1051479',
                    'A1051483', 'A1051484', 'A1051489', 'A1051490', 'A1051491', 'A1051485',
                    'A1051481', 'A1051482', 'A1051486', 'A1051480', 'A1051472', 'A1051478',
                    'A1051488', 'A1051475', 'A1051487'];
    for (const bill of aBills) {
      test(`matches ${bill}`, () => {
        expect(isValidExternalBillNumber(bill)).toBe(true);
      });
    }
  });

  describe('D-prefixed bills (should match — was the bug)', () => {
    const dBills = ['D1025582', 'D1025583', 'D1025584', 'D1000001'];
    for (const bill of dBills) {
      test(`matches ${bill}`, () => {
        expect(isValidExternalBillNumber(bill)).toBe(true);
      });
    }
  });

  describe('Other letter-prefixed bills (should match)', () => {
    const otherBills = ['B1000001', 'C1000001', 'E1000001', 'Z9999999',
                        'a1051492', 'd1025582']; // lowercase
    for (const bill of otherBills) {
      test(`matches ${bill}`, () => {
        expect(isValidExternalBillNumber(bill)).toBe(true);
      });
    }
  });

  describe('Non-bill-number strings (should NOT match)', () => {
    const nonBills: Array<[string, unknown]> = [
      ['product code 0103', '0103'],
      ['product code 0301', '0301'],
      ['seller code 0001', '0001'],
      ['seller code 0040', '0040'],
      ['date 11/7/2569', '11/7/2569'],
      ['summary text', 'ยอดรวมท้ายรายงาน'],
      ['page number', 'หน้าที่ 1'],
      ['report marker', 'report04'],
      ['empty string', ''],
      ['bill with suffix', 'A1051492-extra'],
      ['letter only', 'A'],
      ['digits only', '1234'],
      ['two-letter prefix', 'AB1234'],
      ['null', null],
      ['number 123', 123],
      ['undefined', undefined],
    ];
    for (const [label, value] of nonBills) {
      test(`does not match ${label}`, () => {
        expect(isValidExternalBillNumber(value)).toBe(false);
      });
    }
  });

  describe('Whitespace handling', () => {
    test('trims leading/trailing whitespace', () => {
      expect(isValidExternalBillNumber('  A1051492  ')).toBe(true);
      expect(isValidExternalBillNumber(' D1025582')).toBe(true);
    });
  });
});

describe('ST-16: isReport04SellerSummaryRow', () => {
  test('matches seller summary row', () => {
    expect(isReport04SellerSummaryRow(['0020', 'เจ๊อุ้ย', null, null, null, null, null, null, null, null, null, null, 6113.40])).toBe(true);
  });
  test('rejects bill header row (has col 2)', () => {
    expect(isReport04SellerSummaryRow([null, '11/7/2569', 'A1051492', '-', '5 16.17', null, null, null, null, null, null, null, 6113.40])).toBe(false);
  });
  test('rejects item row (has col 2 and col 3)', () => {
    expect(isReport04SellerSummaryRow([null, null, '0106', 'เหล็กบาง', null, null, null, null, null, 298, 'กก.', 9, 2682])).toBe(false);
  });
  test('rejects row with non-4-digit col 0', () => {
    expect(isReport04SellerSummaryRow(['ABC', 'name', null, null, null, null, null, null, null, null, null, null, 100])).toBe(false);
  });
});

describe('ST-16: isReport04BillHeaderRow', () => {
  test('matches A-prefixed bill header', () => {
    expect(isReport04BillHeaderRow([null, '11/7/2569', 'A1051492', '-', '5 16.17', null, null, null, null, null, null, null, 6113.40])).toBe(true);
  });
  test('matches D-prefixed bill header', () => {
    expect(isReport04BillHeaderRow([null, '11/7/2569', 'D1025582', '-', 'ห้อง1', null, null, null, null, null, null, null, 6245.90])).toBe(true);
  });
  test('rejects seller summary row (no col 1 date)', () => {
    expect(isReport04BillHeaderRow(['0020', 'เจ๊อุ้ย', null, null, null, null, null, null, null, null, null, null, 6113.40])).toBe(false);
  });
  test('rejects item row (col 2 is product code, not bill number)', () => {
    expect(isReport04BillHeaderRow([null, null, '0106', 'เหล็กบาง', null, null, null, null, null, 298, 'กก.', 9, 2682])).toBe(false);
  });
});

describe('ST-16: isReport04ItemRow', () => {
  test('matches product item row', () => {
    expect(isReport04ItemRow([null, null, '0106', 'เหล็กบาง', null, null, null, null, null, 298, 'กก.', 9, 2682])).toBe(true);
  });
  test('rejects bill header row (col 2 is bill number, not product code)', () => {
    expect(isReport04ItemRow([null, '11/7/2569', 'A1051492', '-', '5 16.17', null, null, null, null, null, null, null, 6113.40])).toBe(false);
  });
  test('rejects D-prefixed bill header row', () => {
    expect(isReport04ItemRow([null, '11/7/2569', 'D1025582', '-', 'ห้อง1', null, null, null, null, null, null, null, 6245.90])).toBe(false);
  });
  test('rejects row without col 9 (weight)', () => {
    expect(isReport04ItemRow([null, null, '0106', 'เหล็กบาง', null, null, null, null, null, null, 'กก.', 9, 2682])).toBe(false);
  });
  test('rejects row without col 3 (product name)', () => {
    expect(isReport04ItemRow([null, null, '0106', null, null, null, null, null, null, 298, 'กก.', 9, 2682])).toBe(false);
  });
});

/**
 * Simulated parser test: verify that D-prefixed bill items don't leak
 * into the previous A-prefixed bill.
 *
 * Uses the SAME production helpers — no duplicated logic.
 */
describe('ST-16: Bill context isolation (simulated parser with production helpers)', () => {
  const testRows: (any[] | null)[] = [
    // Seller summary
    ['0020', 'เจ๊อุ้ย', null, null, null, null, null, null, null, null, null, null, 6113.40],
    // A1051492 bill header
    [null, '11/7/2569', 'A1051492', 'บธ9781', '5 16.17', null, null, null, null, null, null, null, 6113.40],
    // A1051492 items
    [null, null, '0106', 'เหล็กบาง', null, null, null, null, null, 298, 'กก.', 9, 2682],
    [null, null, '0204', 'อลูมิเนียมบาง', null, null, null, null, null, 8.6, 'กก.', 70, 602],
    // blank
    null,
    // Next seller
    ['0040', 'คุณรุ่งโรจน์', null, null, null, null, null, null, null, null, null, null, 6245.90],
    // D1025582 bill header — was NOT detected by old regex
    [null, '11/7/2569', 'D1025582', '-', 'ห้อง1', null, null, null, null, null, null, null, 6245.90],
    // D1025582 items
    [null, null, '0203', 'อลูมิเนียมสายไฟ', null, null, null, null, null, 8, 'กก.', 91, 728],
    [null, null, '0302', 'ทองแดงช็อต', null, null, null, null, null, 4.5, 'กก.', 416, 1872],
  ];

  interface SimBill {
    externalBillNumber: string;
    items: Array<{ productName: string; amount: number }>;
    totalAmount: number;
    excelTotalAmount: number;
  }

  function parseRows(rows: (any[] | null)[]): SimBill[] {
    const bills: SimBill[] = [];
    let currentBill: SimBill | null = null;

    for (const r of rows) {
      if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

      if (isReport04SellerSummaryRow(r)) continue;

      if (isReport04BillHeaderRow(r)) {
        if (currentBill) bills.push(currentBill);
        currentBill = {
          externalBillNumber: String(r[2]).trim(),
          items: [],
          totalAmount: 0,
          excelTotalAmount: parseFloat(String(r[12])) || 0,
        };
        continue;
      }

      if (isReport04ItemRow(r) && currentBill) {
        const amount = parseFloat(String(r[12])) || 0;
        currentBill.items.push({ productName: String(r[3]).trim(), amount });
        currentBill.totalAmount += amount;
      }
    }
    if (currentBill) bills.push(currentBill);
    return bills;
  }

  test('A1051492 and D1025582 are parsed as separate bills', () => {
    const bills = parseRows(testRows);
    expect(bills).toHaveLength(2);
    expect(bills[0].externalBillNumber).toBe('A1051492');
    expect(bills[1].externalBillNumber).toBe('D1025582');
  });

  test('A1051492 has exactly 2 items (not 4 — no D1025582 leak)', () => {
    const bills = parseRows(testRows);
    const a1051492 = bills.find(b => b.externalBillNumber === 'A1051492')!;
    expect(a1051492.items).toHaveLength(2);
  });

  test('A1051492 totalAmount = 3284 (not 5884 with leaked D items)', () => {
    const bills = parseRows(testRows);
    const a1051492 = bills.find(b => b.externalBillNumber === 'A1051492')!;
    expect(a1051492.totalAmount).toBe(3284);
  });

  test('D1025582 has exactly 2 items', () => {
    const bills = parseRows(testRows);
    const d1025582 = bills.find(b => b.externalBillNumber === 'D1025582')!;
    expect(d1025582.items).toHaveLength(2);
  });

  test('D1025582 totalAmount = 2600 (728 + 1872)', () => {
    const bills = parseRows(testRows);
    const d1025582 = bills.find(b => b.externalBillNumber === 'D1025582')!;
    expect(d1025582.totalAmount).toBe(2600);
  });

  test('D1025582 items are NOT in A1051492', () => {
    const bills = parseRows(testRows);
    const a1051492 = bills.find(b => b.externalBillNumber === 'A1051492')!;
    const productNames = a1051492.items.map(i => i.productName);
    expect(productNames).not.toContain('อลูมิเนียมสายไฟ');
    expect(productNames).not.toContain('ทองแดงช็อต');
  });
});
