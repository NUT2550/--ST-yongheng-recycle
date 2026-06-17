# Task 4 - Frontend Layout Agent

## Task
Build frontend layout, Zustand store, type definitions, API helpers, and utility functions for the scrap metal recycling shop stock management system.

## Work Completed

### 1. Type Definitions (`/src/lib/types.ts`)
- ProductCategory, Product, StockInfo interfaces
- Cart item types: BuyCartItem, SellCartItem, SortCartItem
- Bill types: BuyBill, BuyBillItem, SellBill, SellBillItem, SortingBill, SortingBillItem
- Customer, CreditEntry, CreditPayment interfaces
- DashboardData interface with category summary
- PageTab union type
- StockCategory with nested products and stock lots
- API request types: CreateBuyBillRequest, CreateSellBillRequest, CreateSortingBillRequest, CreateCustomerRequest, PayCreditRequest

### 2. Zustand Store (`/src/lib/store.ts`)
- Navigation state: activeTab, setActiveTab
- Buy cart: add, remove, update, clear
- Sell cart: add, remove, update, clear
- Sorting cart: source product, weight, weighed total, items CRUD, clear

### 3. API Helpers (`/src/lib/api.ts`)
- fetchProducts, fetchStock, fetchDashboard
- fetchBuyBills, fetchSellBills, fetchSortingBills (with pagination)
- fetchCustomers, fetchCreditEntries (with filters)
- createBuyBill, createSellBill, createSortingBill
- createCustomer, payCreditEntry

### 4. Utility Functions (`/src/lib/helpers.ts`)
- formatBaht, formatWeight (Thai formatting)
- formatDate (Thai Buddhist calendar), formatDateForInput
- getCurrentDate, getCurrentDateForInput
- getRemainingAmount for credit entries
- thaiBahtText (number to Thai text)
- truncate, calculateCartTotal, calculateCartWeight

### 5. Main Page Layout (`/src/app/page.tsx`)
- Header with shop name and Factory icon logo
- Desktop sidebar (lg:w-64) with vertical navigation
- Mobile bottom navigation with horizontal layout
- Mobile hamburger menu using Sheet component
- 7 placeholder tab components with relevant headers
- Cart item count badges on buy/sell/sort pages
- All Thai language interface
- Amber/Orange color scheme

### 6. Supporting Changes
- Updated layout.tsx with Thai metadata and lang="th"
- Added safe-area-bottom CSS class to globals.css
- Added custom scrollbar styling to globals.css

## Lint Status
All code passes ESLint with no errors.
