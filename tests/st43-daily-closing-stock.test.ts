import { describe, expect, test } from 'bun:test'
import { calculateClosingStockBreakdown } from '../src/lib/stock-ledger-read-service'

const baselineDate = new Date('2026-07-15T00:00:00+07:00')
const businessDate = new Date('2026-07-16T12:00:00+07:00')

function calculate(movements: Array<{ productId: string; movementType: any; signedWeight: number; businessDate?: Date }>) {
  return calculateClosingStockBreakdown({
    selectedDate: '2026-07-16', baselineDate,
    baselineItems: [
      { productId: 'wire', productName: 'สายไฟทองแดง', weight: 10, effectiveStartDate: baselineDate },
      { productId: 'large', productName: 'ทองแดงใหญ่', weight: 5, effectiveStartDate: baselineDate },
      { productId: 'shot', productName: 'ทองแดงช็อต', weight: 0, effectiveStartDate: baselineDate },
    ],
    products: [
      { id: 'wire', name: 'สายไฟทองแดง' },
      { id: 'large', name: 'ทองแดงใหญ่' },
      { id: 'shot', name: 'ทองแดงช็อต' },
    ],
    movements: movements.map(movement => ({ ...movement, businessDate: movement.businessDate || businessDate })),
  })
}

describe('ST-43 expected closing stock', () => {
  test('approved opening plus purchase and minus sale', () => {
    const result = calculate([
      { productId: 'large', movementType: 'PURCHASE_IN', signedWeight: 1.2 },
      { productId: 'large', movementType: 'SALE_OUT', signedWeight: -0.4 },
    ])
    const row = result.items.find(item => item.productId === 'large')!
    expect(row.openingWeight).toBe(5)
    expect(row.purchaseInWeight).toBe(1.2)
    expect(row.saleOutWeight).toBe(0.4)
    expect(row.expectedClosingWeight).toBe(5.8)
  })

  test('sorting source decreases and output increases', () => {
    const result = calculate([
      { productId: 'wire', movementType: 'SORTING_SOURCE_OUT', signedWeight: -1.7 },
      { productId: 'large', movementType: 'SORTING_OUTPUT_IN', signedWeight: 0.3 },
    ])
    expect(result.items.find(item => item.productId === 'wire')!.expectedClosingWeight).toBe(8.3)
    expect(result.items.find(item => item.productId === 'large')!.expectedClosingWeight).toBe(5.3)
  })

  test('required transfer fixture reconciles -1.70, -0.08, +0.38', () => {
    const result = calculate([
      { productId: 'wire', movementType: 'TRANSFER_SOURCE_OUT', signedWeight: -1.7 },
      { productId: 'large', movementType: 'TRANSFER_OUTPUT_IN', signedWeight: 0.3 },
      { productId: 'large', movementType: 'TRANSFER_SOURCE_OUT', signedWeight: -0.38 },
      { productId: 'shot', movementType: 'TRANSFER_OUTPUT_IN', signedWeight: 0.38 },
    ])
    expect(result.items.find(item => item.productId === 'wire')!.netMovementWeight).toBe(-1.7)
    expect(result.items.find(item => item.productId === 'large')!.netMovementWeight).toBe(-0.08)
    expect(result.items.find(item => item.productId === 'shot')!.netMovementWeight).toBe(0.38)
  })

  test('gain, loss, adjustment and reversal retain their signed ledger meaning', () => {
    const result = calculate([
      { productId: 'large', movementType: 'TRANSFER_SOURCE_OUT', signedWeight: -1 },
      { productId: 'large', movementType: 'TRANSFER_OUTPUT_IN', signedWeight: 1.1 },
      { productId: 'large', movementType: 'ADJUSTMENT_OUT', signedWeight: -0.2 },
      { productId: 'large', movementType: 'CANCELLATION_REVERSAL', signedWeight: 0.2 },
    ])
    expect(result.items.find(item => item.productId === 'large')!.netMovementWeight).toBe(0.1)
  })

  test('backdated movement uses business date and future movement is excluded', () => {
    const result = calculate([
      { productId: 'shot', movementType: 'TRANSFER_OUTPUT_IN', signedWeight: 0.38 },
      { productId: 'shot', movementType: 'PURCHASE_IN', signedWeight: 9, businessDate: new Date('2026-07-17T00:00:00+07:00') },
    ])
    expect(result.items.find(item => item.productId === 'shot')!.expectedClosingWeight).toBe(0.38)
  })

  test('zero owner opening is explicit and no movement preserves opening', () => {
    const result = calculate([{ productId: 'shot', movementType: 'PURCHASE_IN', signedWeight: 0.2 }])
    expect(result.items.find(item => item.productId === 'shot')!.openingWeight).toBe(0)
    expect(result.items.find(item => item.productId === 'wire')!.expectedClosingWeight).toBe(10)
  })

  test('date before an item boundary is not presented as verified zero', () => {
    const result = calculateClosingStockBreakdown({
      selectedDate: '2026-07-04', baselineDate,
      baselineItems: [{ productId: 'shot', productName: 'ทองแดงช็อต', weight: 0, effectiveStartDate: new Date('2026-07-05T00:00:00+07:00') }],
      products: [{ id: 'shot', name: 'ทองแดงช็อต' }], movements: [],
    })
    expect(result.items[0]).toMatchObject({ state: 'NOT_STARTED', expectedClosingWeight: null })
  })

  test('six-decimal integer aggregation avoids floating drift', () => {
    const result = calculate([
      { productId: 'shot', movementType: 'PURCHASE_IN', signedWeight: 0.1 },
      { productId: 'shot', movementType: 'PURCHASE_IN', signedWeight: 0.2 },
      { productId: 'shot', movementType: 'TRANSFER_OUTPUT_IN', signedWeight: 0.38 },
      { productId: 'shot', movementType: 'SALE_OUT', signedWeight: -0.38 },
    ])
    expect(result.items.find(item => item.productId === 'shot')!.expectedClosingWeight).toBe(0.3)
  })

  test('daily page remains and legacy physical-count stays absent', async () => {
    const page = await Bun.file('src/components/daily-weighing-page.tsx').text()
    expect(page).toContain('action=closing-stock')
    expect(page).toContain('expectedClosingWeight')
    expect(await Bun.file('src/components/physical-count-page.tsx').exists()).toBe(false)
  })
})
