/**
 * ST-54: Prisma production adapter for the sorting transaction service.
 *
 * This adapter connects the testable createSortingBillTransaction service
 * to the real Prisma database. The same service is tested with the
 * in-memory test adapter in tests/st54-executable-transactions.test.ts.
 */
import { db } from './db'
import type { Prisma } from '@prisma/client'
import type { SortingDeps, SortingTxContext, SourceLotData, SortingBillResult } from './sorting-transaction-service'
import type { StockMovementDraft } from './stock-movement-ledger'
import { FIFO_ORDER_BY } from './fifo-validation'

type PrismaTx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export function createPrismaSortingDeps(): SortingDeps {
  return {
    async loadSourceLots(productId: string): Promise<SourceLotData[]> {
      const lots = await db.stockLot.findMany({
        where: { productId, remainingWeight: { gt: 0 } },
        orderBy: FIFO_ORDER_BY,
      })
      return lots.map((l) => ({
        id: l.id,
        productId: l.productId,
        remainingWeight: l.remainingWeight,
        costPerKg: l.costPerKg,
        dateAdded: l.dateAdded,
        createdAt: l.createdAt,
      }))
    },

    async transaction<T>(fn: (tx: SortingTxContext) => Promise<T>): Promise<T> {
      return db.$transaction(async (prismaTx: PrismaTx) => {
        const tx: SortingTxContext = {
          async findSourceLots(productId: string): Promise<SourceLotData[]> {
            const lots = await prismaTx.stockLot.findMany({
              where: { productId, remainingWeight: { gt: 0 } },
              orderBy: FIFO_ORDER_BY,
            })
            return lots.map((l) => ({
              id: l.id,
              productId: l.productId,
              remainingWeight: l.remainingWeight,
              costPerKg: l.costPerKg,
              dateAdded: l.dateAdded,
              createdAt: l.createdAt,
            }))
          },

          async updateSourceLot(lotId: string, newRemainingWeight: number): Promise<void> {
            await prismaTx.stockLot.update({
              where: { id: lotId },
              data: { remainingWeight: newRemainingWeight },
            })
          },

          async createSortingBill(data): Promise<SortingBillResult> {
            const bill = await prismaTx.sortingBill.create({
              data: {
                billNumber: data.billNumber,
                date: data.date,
                sourceProductId: data.sourceProductId,
                sourceWeight: data.sourceWeight,
                sourceWeightExpression: data.sourceWeightExpression,
                sourcePricePerKg: data.sourcePricePerKg,
                weighedTotal: data.weighedTotal,
                weighedTotalExpression: data.weighedTotalExpression,
                lossWeight: data.lossWeight,
                lossCost: data.lossCost,
                roomNumber: data.roomNumber,
                note: data.note,
                items: {
                  create: data.items,
                },
              },
              include: {
                sourceProduct: { select: { id: true, name: true } },
                items: { include: { product: { select: { id: true, name: true } } } },
              },
            })
            return {
              id: bill.id,
              billNumber: bill.billNumber || '',
              sourceProductId: bill.sourceProductId,
              sourceWeight: bill.sourceWeight,
              sourceCostPerKg: data.items.find((i) => !i.isWaste)?.costPerKg || 0,
              lossWeight: bill.lossWeight,
              lossCost: bill.lossCost,
              items: bill.items.map((item) => ({
                id: item.id,
                productId: item.productId,
                weight: item.weight,
                isWaste: item.isWaste,
                costPerKg: item.costPerKg,
                totalCost: item.totalCost,
              })),
            }
          },

          async createOutputStockLots(data): Promise<number> {
            const result = await prismaTx.stockLot.createMany({ data })
            return result.count
          },

          async createStockMovements(data: StockMovementDraft[]): Promise<number> {
            const result = await prismaTx.stockMovement.createMany({
              data: data as Prisma.StockMovementCreateManyInput[],
            })
            return result.count
          },
        }
        return fn(tx)
      }, {
        maxWait: 5000,
        timeout: 15000,
      })
    },
  }
}
