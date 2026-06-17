import { CreditEntry } from './types';

/**
 * Format number as Thai Baht with 2 decimal places
 * e.g., 1234.56 → "1,234.56"
 */
export function formatBaht(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount)) return '0.00';
  return Number(amount).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format weight in kg with 2 decimal places
 * e.g., 1234.56 → "1,234.56 กก."
 */
export function formatWeight(weight: number | undefined | null): string {
  if (weight == null || isNaN(weight)) return '0.00 กก.';
  return `${Number(weight).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} กก.`;
}

/**
 * Format date for display in Thai format
 * e.g., "2024-01-15T14:30:00" → "15/01/2567 14:30"
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const buddhistYear = date.getFullYear() + 543;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${buddhistYear} ${hours}:${minutes}`;
}

/**
 * Format date for datetime-local input
 * e.g., "2024-01-15T14:30:00.000Z" → "2024-01-15T14:30"
 */
export function formatDateForInput(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Get current date as ISO string
 */
export function getCurrentDate(): string {
  return new Date().toISOString();
}

/**
 * Get current date formatted for datetime-local input
 */
export function getCurrentDateForInput(): string {
  return formatDateForInput(new Date().toISOString());
}

/**
 * Calculate remaining amount for credit entry
 */
export function getRemainingAmount(entry: CreditEntry): number {
  return entry.remainingAmount ?? entry.amount - entry.paidAmount;
}

/**
 * Thai number to text conversion (for receipts)
 * Converts a number to Thai text representation
 */
export function thaiBahtText(amount: number): string {
  if (amount === 0) return 'ศูนย์บาทถ้วน';

  const thaiDigits = [
    '',
    'หนึ่ง',
    'สอง',
    'สาม',
    'สี่',
    'ห้า',
    'หก',
    'เจ็ด',
    'แปด',
    'เก้า',
  ];
  const thaiUnits = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  const baht = Math.floor(amount);
  const satang = Math.round((amount - baht) * 100);

  function convertNumber(num: number): string {
    if (num === 0) return '';
    let result = '';
    const numStr = num.toString();
    const len = numStr.length;

    for (let i = 0; i < len; i++) {
      const digit = parseInt(numStr[i]);
      const position = len - i - 1;

      if (digit === 0) continue;

      if (position === 1 && digit === 1) {
        result += 'สิบ';
      } else if (position === 1 && digit === 2) {
        result += 'ยี่สิบ';
      } else if (position === 0 && digit === 1 && len > 1) {
        result += 'เอ็ด';
      } else {
        result += thaiDigits[digit] + thaiUnits[position];
      }
    }
    return result;
  }

  let result = '';

  if (baht > 0) {
    if (baht >= 1000000) {
      const millions = Math.floor(baht / 1000000);
      const remainder = baht % 1000000;
      result += convertNumber(millions) + 'ล้าน';
      if (remainder > 0) {
        result += convertNumber(remainder);
      }
    } else {
      result += convertNumber(baht);
    }
    result += 'บาท';
  }

  if (satang > 0) {
    result += convertNumber(satang) + 'สตางค์';
  } else {
    result += 'ถ้วน';
  }

  return result;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Calculate total amount for cart items
 */
export function calculateCartTotal(
  items: Array<{ totalAmount: number }>
): number {
  return items.reduce((sum, item) => sum + item.totalAmount, 0);
}

/**
 * Calculate total weight for cart items
 */
export function calculateCartWeight(
  items: Array<{ weight: number }>
): number {
  return items.reduce((sum, item) => sum + item.weight, 0);
}
