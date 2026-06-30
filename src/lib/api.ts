import {
  Product,
  StockCategory,
  DashboardData,
  BuyBill,
  SellBill,
  SortingBill,
  Customer,
  CreditEntry,
  Employee,
  SortingBonus,
  CreateBuyBillRequest,
  CreateSellBillRequest,
  CreateSortingBillRequest,
  CreateCustomerRequest,
  CreateEmployeeRequest,
  CreateSortingBonusRequest,
  PayCreditRequest,
  CreditPayment,
} from './types';
import { TOKEN_STORAGE_KEY } from './auth-constants';

const API_BASE = '/api';

// Read the auth token from localStorage (client-side only).
// Used to attach an Authorization: Bearer header to every API call
// so auth works even inside cross-origin iframes where cookies are
// blocked by SameSite policies.
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// GET helpers

export async function fetchProducts(): Promise<Product[]> {
  return fetchJSON<Product[]>('/products');
}

export async function fetchStock(): Promise<StockCategory[]> {
  return fetchJSON<StockCategory[]>('/stock');
}

export async function fetchDashboard(): Promise<DashboardData> {
  return fetchJSON<DashboardData>('/dashboard');
}

export async function fetchBuyBills(
  page?: number,
  limit?: number,
  includeCancelled?: boolean
): Promise<{ bills: BuyBill[]; total: number }> {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  if (includeCancelled) params.set('includeCancelled', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJSON<{ bills: BuyBill[]; total: number }>(`/buy-bills${query}`);
}

export async function fetchSellBills(
  page?: number,
  limit?: number,
  includeCancelled?: boolean
): Promise<{ bills: SellBill[]; total: number }> {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  if (includeCancelled) params.set('includeCancelled', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJSON<{ bills: SellBill[]; total: number }>(`/sell-bills${query}`);
}

export async function fetchSortingBills(
  page?: number,
  limit?: number,
  includeCancelled?: boolean
): Promise<{ bills: SortingBill[]; total: number }> {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  if (includeCancelled) params.set('includeCancelled', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJSON<{ bills: SortingBill[]; total: number }>(
    `/sorting-bills${query}`
  );
}

export async function fetchCustomers(): Promise<Customer[]> {
  return fetchJSON<Customer[]>('/customers');
}

export async function fetchCreditEntries(params?: {
  type?: string;
  isSettled?: boolean;
  customerId?: string;
}): Promise<CreditEntry[]> {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set('type', params.type);
  if (params?.isSettled !== undefined)
    searchParams.set('isSettled', String(params.isSettled));
  if (params?.customerId) searchParams.set('customerId', params.customerId);
  const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
  return fetchJSON<CreditEntry[]>(`/credit${query}`);
}

// POST helpers

export async function createBuyBill(data: CreateBuyBillRequest): Promise<BuyBill> {
  return fetchJSON<BuyBill>('/buy-bills', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createSellBill(
  data: CreateSellBillRequest
): Promise<SellBill> {
  return fetchJSON<SellBill>('/sell-bills', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createSortingBill(
  data: CreateSortingBillRequest
): Promise<SortingBill> {
  return fetchJSON<SortingBill>('/sorting-bills', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createCustomer(
  data: CreateCustomerRequest
): Promise<Customer> {
  return fetchJSON<Customer>('/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function payCreditEntry(
  id: string,
  data: PayCreditRequest
): Promise<CreditPayment> {
  return fetchJSON<CreditPayment>(`/credit/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Employee helpers
export async function fetchEmployees(): Promise<Employee[]> {
  return fetchJSON<Employee[]>('/employees');
}

export async function createEmployee(
  data: CreateEmployeeRequest
): Promise<Employee> {
  return fetchJSON<Employee>('/employees', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Bonus helpers
export async function fetchBonuses(params?: {
  employeeId?: string;
  isPaid?: boolean;
  from?: string;
  to?: string;
}): Promise<{ bonuses: SortingBonus[]; summary: { totalUnpaid: number; totalPaid: number; totalAll: number } }> {
  const searchParams = new URLSearchParams();
  if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
  if (params?.isPaid !== undefined) searchParams.set('isPaid', String(params.isPaid));
  if (params?.from) searchParams.set('from', params.from);
  if (params?.to) searchParams.set('to', params.to);
  const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
  return fetchJSON(`/bonuses${query}`);
}

export async function createSortingBonus(
  data: CreateSortingBonusRequest
): Promise<SortingBonus> {
  return fetchJSON<SortingBonus>('/bonuses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateBonus(
  id: string,
  data: { isPaid?: boolean; paidDate?: string; note?: string }
): Promise<SortingBonus> {
  return fetchJSON<SortingBonus>(`/bonuses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchBonusCalculation(year?: number): Promise<{
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
}> {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchJSON(`/bonus-calculation${query}`);
}

export async function deleteBonus(id: string): Promise<void> {
  await fetchJSON(`/bonuses/${id}`, { method: 'DELETE' });
}
