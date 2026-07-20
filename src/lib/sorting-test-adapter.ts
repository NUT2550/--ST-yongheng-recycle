/**
 * ST-54: In-memory transaction test adapter for sorting bill service.
 *
 * Models real Prisma transaction behavior:
 * - Atomic commit/rollback (all writes or no writes)
 * - FIFO lot loading with deterministic ordering
 * - Per-lot remainingWeight updates
 * - SortingBill + items creation
 * - Batch output StockLot creation (createMany)
 * - StockMovement createMany
 * - Failure injection at each stage for rollback testing
 *
 * This is NOT a mock that returns canned values — it executes the real
 * transaction logic against in-memory state and verifies consistency.
 */
import type {
  SortingTxContext,
  SortingDeps,
  SourceLotData,
  SortingBillResult,
} from './sorting-transaction-service'
import { SourceLotConflictError } from './sorting-transaction-service'
import type { FifoPreviewSuccess } from './fifo-validation'
import type { StockMovementDraft } from './stock-movement-ledger'
import { FIFO_ORDER_BY } from './fifo-validation'

export interface TestSourceLot extends SourceLotData {
  originalRemainingWeight: number // for rollback verification
}

export interface TestSortingBill {
  id: string
  billNumber: string
  date: Date
  sourceProductId: string
  sourceWeight: number
  lossWeight: number
  lossCost: number
  roomNumber: string | null
  note: string | null
  items: Array<{
    id: string
    productId: string
    weight: number
    isWaste: boolean
    costPerKg: number
    totalCost: number
  }>
}

export interface TestStockLot {
  id: string
  productId: string
  remainingWeight: number
  costPerKg: number
  dateAdded: Date
  createdAt: Date
  source: string
  sourceId: string
}

export interface TestStockMovement {
  id: string
  productId: string
  businessDate: Date
  movementType: string
  signedWeight: number
  sourceType: string
  sourceId: string
  sourceItemId: string | null
  idempotencyKey: string
}

export interface TestState {
  stockLots: Map<string, TestStockLot>
  sortingBills: Map<string, TestSortingBill>
  stockMovements: Map<string, TestStockMovement>
}

export interface FailureInjection {
  failAt?: 'updateSourceLot' | 'createSortingBill' | 'createOutputStockLots' | 'createStockMovements' | 'findSourceLots'
  error?: Error
}

export interface TestAdapterOptions {
  failures?: FailureInjection
  /** Simulate P2028 transaction timeout */
  simulateTimeout?: boolean
}

let idCounter = 0
const nextId = (prefix: string) => `${prefix}-${++idCounter}`

export function createTestAdapter(
  initialSourceLots: TestSourceLot[],
  options: TestAdapterOptions = {},
): SortingDeps & { getState(): TestState; getCommittedState(): TestState; getQueryCount(): number } {
  // The "committed" state — only updated on successful transaction commit
  const committedState: TestState = {
    stockLots: new Map(initialSourceLots.map((l): [string, TestStockLot] => [l.id, { ...l, source: 'INITIAL', sourceId: '' }])),
    sortingBills: new Map(),
    stockMovements: new Map(),
  }

  // Track query count for performance measurement
  let queryCount = 0

  const failures = options.failures || {}

  return {
    async loadSourceLots(productId: string): Promise<SourceLotData[]> {
      queryCount++
      const lots = [...committedState.stockLots.values()].filter((l) => l.productId === productId && l.remainingWeight > 0)
      // Apply FIFO ordering: dateAdded ASC, createdAt ASC, id ASC
      lots.sort((a, b) => {
        if (a.dateAdded.getTime() !== b.dateAdded.getTime()) return a.dateAdded.getTime() - b.dateAdded.getTime()
        if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
        return a.id.localeCompare(b.id)
      })
      return lots.map((l) => ({ ...l }))
    },

    async transaction<T>(fn: (tx: SortingTxContext) => Promise<T>): Promise<T> {
      if (options.simulateTimeout) {
        throw Object.assign(new Error('Transaction not found. Transaction ID is invalid'), { code: 'P2028' })
      }

      // Create a transaction-local copy of state
      const txState: TestState = {
        stockLots: new Map([...committedState.stockLots].map(([k, v]) => [k, { ...v }])),
        sortingBills: new Map(), // new bills created in this tx
        stockMovements: new Map(),
      }

      const tx: SortingTxContext = {
        async findSourceLots(productId: string): Promise<SourceLotData[]> {
          queryCount++
          if (failures.failAt === 'findSourceLots') {
            throw failures.error || new Error('Injected: findSourceLots failed')
          }
          const lots = [...txState.stockLots.values()].filter((l) => l.productId === productId && l.remainingWeight > 0)
          lots.sort((a, b) => {
            if (a.dateAdded.getTime() !== b.dateAdded.getTime()) return a.dateAdded.getTime() - b.dateAdded.getTime()
            if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime()
            return a.id.localeCompare(b.id)
          })
          return lots.map((l) => ({ ...l }))
        },

        async updateSourceLot(
          lotId: string,
          expected: { productId: string; remainingWeight: number; costPerKg: number },
          newRemainingWeight: number,
        ): Promise<void> {
          queryCount++
          if (failures.failAt === 'updateSourceLot') {
            throw failures.error || new Error('Injected: updateSourceLot failed')
          }
          const lot = txState.stockLots.get(lotId)
          if (!lot) throw new Error(`Lot not found: ${lotId}`)
          // ST-54: Compare-and-set guard — EXACT READ-VALUE CAS
          // Matches Prisma updateMany WHERE clause semantics:
          // strict numeric equality (===), no rounding, no epsilon tolerance.
          // A concurrent change to any guarded field → SourceLotConflictError.
          if (lot.productId !== expected.productId) {
            throw new SourceLotConflictError()
          }
          if (lot.remainingWeight !== expected.remainingWeight) {
            throw new SourceLotConflictError()
          }
          if (lot.costPerKg !== expected.costPerKg) {
            throw new SourceLotConflictError()
          }
          lot.remainingWeight = newRemainingWeight
        },

        async createSortingBill(data): Promise<SortingBillResult> {
          queryCount++
          if (failures.failAt === 'createSortingBill') {
            throw failures.error || new Error('Injected: createSortingBill failed')
          }
          const id = nextId('sort')
          const bill: TestSortingBill = {
            id,
            billNumber: data.billNumber,
            date: data.date,
            sourceProductId: data.sourceProductId,
            sourceWeight: data.sourceWeight,
            lossWeight: data.lossWeight,
            lossCost: data.lossCost,
            roomNumber: data.roomNumber,
            note: data.note,
            items: data.items.map((item, idx) => ({
              id: `${id}-item-${idx + 1}`,
              productId: item.productId,
              weight: item.weight,
              isWaste: item.isWaste,
              costPerKg: item.costPerKg,
              totalCost: item.totalCost,
            })),
          }
          txState.sortingBills.set(id, bill)
          return {
            id,
            billNumber: bill.billNumber,
            sourceProductId: bill.sourceProductId,
            sourceWeight: bill.sourceWeight,
            sourceCostPerKg: data.items.find((i) => !i.isWaste)?.costPerKg || 0,
            lossWeight: bill.lossWeight,
            lossCost: bill.lossCost,
            items: bill.items,
          }
        },

        async createOutputStockLots(data): Promise<number> {
          queryCount++
          if (failures.failAt === 'createOutputStockLots') {
            throw failures.error || new Error('Injected: createOutputStockLots failed')
          }
          for (const lot of data) {
            const id = nextId('lot')
            txState.stockLots.set(id, { id, ...lot, createdAt: new Date() })
          }
          return data.length
        },

        async createStockMovements(data: StockMovementDraft[]): Promise<number> {
          queryCount++
          if (failures.failAt === 'createStockMovements') {
            throw failures.error || new Error('Injected: createStockMovements failed')
          }
          for (const m of data) {
            const id = nextId('mv')
            txState.stockMovements.set(id, {
              id,
              productId: m.productId,
              businessDate: m.businessDate,
              movementType: m.movementType,
              signedWeight: m.signedWeight,
              sourceType: m.sourceType,
              sourceId: m.sourceId,
              sourceItemId: m.sourceItemId || null,
              idempotencyKey: m.idempotencyKey,
            })
          }
          return data.length
        },
      }

      // Execute the transaction function
      const result = await fn(tx)

      // If we reach here, commit: copy txState into committedState
      for (const [k, v] of txState.stockLots) committedState.stockLots.set(k, v)
      for (const [k, v] of txState.sortingBills) committedState.sortingBills.set(k, v)
      for (const [k, v] of txState.stockMovements) committedState.stockMovements.set(k, v)

      return result
    },

    getState(): TestState {
      return committedState
    },

    getCommittedState(): TestState {
      return committedState
    },

    getQueryCount(): number {
      return queryCount
    },
  }
}

/**
 * Create a deterministic source-lot fixture for testing.
 */
export function createSourceLots(productId: string, count: number, totalWeight: number, costPerKg: number = 10): TestSourceLot[] {
  const perLot = Math.round((totalWeight / count) * 100) / 100
  const lots: TestSourceLot[] = []
  for (let i = 0; i < count; i++) {
    const date = new Date(`2026-01-${String(5 + i).padStart(2, '0')}T00:00:00+07:00`)
    lots.push({
      id: `lot-${productId}-${i + 1}`,
      productId,
      remainingWeight: perLot,
      originalRemainingWeight: perLot,
      costPerKg,
      dateAdded: date,
      createdAt: date,
    })
  }
  return lots
}
