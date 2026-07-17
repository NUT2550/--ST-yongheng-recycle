// Product types
export interface ProductCategory {
  id: string;
  name: string;
  type: 'STEEL' | 'METAL';
  sortOrder: number;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  defaultBuyPrice: number;
  sortOrder: number;
  category: ProductCategory;
  stock?: StockInfo;
}

export interface StockInfo {
  totalWeight: number;
  totalCost: number;
  avgCostPerKg: number;
}

// Cart item types for Buy/Sell/Sort bills
export interface BuyCartItem {
  productId: string;
  productName: string;
  weight: number;
  weightExpression?: string; // สูตรที่ผู้ใช้พิมพ์ เช่น "860-3" (ถ้ากรอกตัวเลขตรงๆ ให้ undefined)
  pricePerKg: number;
  totalAmount: number;
}

export interface SellCartItem {
  productId: string;
  productName: string;
  weight: number;
  weightExpression?: string;
  pricePerKg: number;
  totalAmount: number;
  availableWeight: number; // from stock
}

export interface SortCartItem {
  productId: string;
  productName: string;
  weight: number;
  weightExpression?: string;
  isWaste: boolean;
  sortedPricePerKg: number; // ราคารับซื้อสินค้าที่คัดได้ (พนักงานใส่)
  bonusAmount: number; // โบนัส = (sortedPricePerKg - sourcePricePerKg) * weight * 10%
}

export interface TransferCartItem {
  productId: string;
  productName: string;
  weight: number;
  weightExpression?: string;
  isWaste: boolean;
  outputPricePerKg: number;
}

// Bill types (from API response)
export interface BuyBill {
  id: string;
  date: string;
  isCredit: boolean;
  note: string | null;
  externalBillNumber: string | null;
  totalAmount: number;
  items: BuyBillItem[];
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface BuyBillItem {
  id: string;
  productId: string;
  product: { id: string; name: string };
  weight: number;
  weightExpression?: string | null;
  pricePerKg: number;
  totalAmount: number;
}

export interface SellBill {
  id: string;
  date: string;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  isCredit: boolean;
  note: string | null;
  totalAmount: number;
  totalCost: number;
  items: SellBillItem[];
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface SellBillItem {
  id: string;
  productId: string;
  product: { id: string; name: string };
  weight: number;
  weightExpression?: string | null;
  pricePerKg: number;
  totalAmount: number;
  costPerKg: number;
  totalCost: number;
}

export interface SortingBill {
  id: string;
  date: string;
  sourceProductId: string;
  sourceProduct: { id: string; name: string };
  sourceWeight: number;
  sourceWeightExpression?: string | null;
  sourcePricePerKg: number;
  weighedTotal: number;
  weighedTotalExpression?: string | null;
  lossWeight: number;
  lossCost: number;
  roomNumber: string | null;
  note: string | null;
  items: SortingBillItem[];
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface SortingBillItem {
  id: string;
  productId: string;
  product: { id: string; name: string };
  weight: number;
  weightExpression?: string | null;
  isWaste: boolean;
  costPerKg: number;
  totalCost: number;
  sortedPricePerKg: number;
  bonusAmount: number;
}

// แกะของ/ย้ายสต็อก — consume 1 source, produce N outputs. No bonus fields.
export interface StockTransfer {
  id: string;
  date: string;
  sourceProductId: string;
  sourceProduct: { id: string; name: string };
  sourceWeight: number;
  sourceWeightExpression?: string | null;
  sourceCostPerKg: number;
  sourceTotalCost: number;
  // Profitability analysis
  roomNumber: string | null;
  businessType: string | null; // คัดแยก | แกะของ | null — business classification for History tab display
  sourcePricePerKg: number;
  laborCost: number;
  outputTotalValue: number;
  profitLoss: number;
  weighedTotal: number;
  weighedTotalExpression?: string | null;
  lossWeight: number;
  lossCost: number;
  note: string | null;
  items: StockTransferItem[];
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface StockTransferItem {
  id: string;
  productId: string;
  product: { id: string; name: string };
  weight: number;
  weightExpression?: string | null;
  isWaste: boolean;
  costPerKg: number;
  totalCost: number;
  outputPricePerKg: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  createdAt: string;
}

export interface CreditEntry {
  id: string;
  type: 'RECEIVABLE' | 'PAYABLE';
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  referenceType: string;
  referenceId: string | null;
  description: string | null;
  date: string;
  isSettled: boolean;
  payments: CreditPayment[];
  createdAt: string;
}

export interface CreditPayment {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface DashboardData {
  totalStockWeight: number;
  totalStockCost: number;
  buyStockWeight: number;
  buyStockCost: number;
  sortingStockWeight: number;
  sortingStockCost: number;
  todayBuyAmount: number;
  todaySellAmount: number;
  todayBuyWeight: number;
  todaySellWeight: number;
  recentBuyBills: BuyBill[];
  recentSellBills: SellBill[];
  categorySummary: Array<{
    categoryId: string;
    categoryName: string;
    totalWeight: number;
    totalCost: number;
  }>;
  productDetails: Array<{
    productId: string;
    productName: string;
    categoryId: string;
    categoryName: string;
    totalWeight: number;
    totalCost: number;
    buyWeight: number;
    buyCost: number;
    sortingWeight: number;
    sortingCost: number;
    avgCostPerKg: number;
  }>;
}

export type PageTab = 'dashboard' | 'buy' | 'sell' | 'sort' | 'transfer' | 'stock' | 'credit' | 'bonus' | 'history' | 'users' | 'products' | 'daily-weighing';

// Employee types
export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  hireDate: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface SortingBonus {
  id: string;
  date: string;
  employeeId: string;
  employee: { id: string; name: string };
  sortingBillId: string | null;
  sortingBill: { id: string; sourceWeight: number; sourceProduct: { name: string } } | null;
  totalWeight: number;
  ratePerKg: number;
  totalAmount: number;
  note: string | null;
  isPaid: boolean;
  paidDate: string | null;
  createdAt: string;
}

export interface CreateEmployeeRequest {
  name: string;
  phone?: string;
  hireDate?: string;
}

export interface CreateSortingBonusRequest {
  date: string;
  employeeId: string;
  sortingBillId?: string;
  totalWeight: number;
  ratePerKg: number;
  totalAmount?: number; // If provided, use directly instead of totalWeight * ratePerKg
  note?: string;
}

// Stock category with products
export interface StockCategory {
  id: string;
  name: string;
  type: 'STEEL' | 'METAL';
  products: Array<{
    id: string;
    name: string;
    totalWeight: number;
    totalCost: number;
    avgCostPerKg: number;
    stockLots: Array<{
      id: string;
      remainingWeight: number;
      costPerKg: number;
      dateAdded: string;
      source: string;
    }>;
  }>;
}

// API request types
export interface CreateBuyBillRequest {
  date: string;
  isCredit: boolean;
  note?: string;
  externalBillNumber?: string;
  items: Array<{
    productId: string;
    weight: number;
    weightExpression?: string;
    pricePerKg: number;
  }>;
}

export interface CreateSellBillRequest {
  date: string;
  customerId?: string;
  isCredit: boolean;
  note?: string;
  items: Array<{
    productId: string;
    weight: number;
    weightExpression?: string;
    pricePerKg: number;
  }>;
}

export interface CreateSortingBillRequest {
  date: string;
  sourceProductId: string;
  sourceWeight: number;
  sourceWeightExpression?: string;
  sourcePricePerKg: number;
  weighedTotal: number;
  weighedTotalExpression?: string;
  roomNumber?: string;
  note?: string;
  items: Array<{
    productId: string;
    weight: number;
    weightExpression?: string;
    isWaste: boolean;
    sortedPricePerKg: number;
    bonusAmount: number;
  }>;
}

export interface CreateStockTransferRequest {
  date: string;
  sourceProductId: string;
  sourceWeight: number;
  sourceWeightExpression?: string;
  roomNumber?: string;
  sourcePricePerKg?: number;
  laborCost?: number;
  weighedTotal?: number;
  weighedTotalExpression?: string;
  note?: string;
  gainReason?: string; // ST-40: required when output > source
  items: Array<{
    productId: string;
    weight: number;
    weightExpression?: string;
    isWaste: boolean;
    outputPricePerKg?: number;
  }>;
}

export interface CreateCustomerRequest {
  name: string;
  phone?: string;
}

export interface PayCreditRequest {
  amount: number;
  date: string;
  note?: string;
}
