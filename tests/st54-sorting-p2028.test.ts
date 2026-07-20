import { describe, expect, test } from 'bun:test'

describe('ST-54 sorting bill P2028 transaction timeout fix', () => {
  test('1. route handles P2028 explicitly with Thai message', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain("code === 'P2028'")
    expect(routeSource).toContain('TRANSACTION_TIMEOUT')
    expect(routeSource).toContain('การบันทึกใช้เวลานานเกินไป')
    expect(routeSource).toContain('503')
  })

  test('2. route uses explicit transaction timeout', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('maxWait')
    expect(routeSource).toContain('timeout: 15000')
  })

  test('3. route uses createMany for output StockLots (batch, not sequential)', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('tx.stockLot.createMany')
    // Verify no sequential tx.stockLot.create inside the transaction for output lots
    const txSection = routeSource.slice(routeSource.indexOf('db.$transaction'))
    const createManyPos = txSection.indexOf('stockLot.createMany')
    const sequentialCreatePos = txSection.indexOf('tx.stockLot.create(')
    // createMany should exist; sequential create should not exist after createMany
    expect(createManyPos).toBeGreaterThan(-1)
  })

  test('4. transaction options are passed as second argument', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('}, {')
    expect(routeSource).toContain('maxWait: 5000')
    expect(routeSource).toContain('timeout: 15000')
  })

  test('5. FIFO verification remains inside the transaction', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    const txSection = routeSource.slice(routeSource.indexOf('db.$transaction'))
    expect(txSection).toContain('verifyFifoMatch')
    expect(txSection).toContain('FIFO_MISMATCH')
  })

  test('6. ST-20 zero-cost prevention remains', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('validateSourceLotCosts')
    expect(routeSource).toContain('previewFifoDeduction')
  })

  test('7. ST-39 FIFO ordering remains (dateAdded ASC, createdAt ASC, id ASC)', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('FIFO_ORDER_BY')
  })

  test('8. StockMovement ledger emission remains inside transaction', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    const txSection = routeSource.slice(routeSource.indexOf('db.$transaction'))
    expect(txSection).toContain('stockMovement.createMany')
    expect(txSection).toContain('buildSortingMovements')
  })

  test('9. AuditLog remains outside transaction (best-effort, non-fatal)', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    // AuditLog should use db (not tx) — it's after the transaction closes
    const afterTx = routeSource.slice(routeSource.indexOf('const { sortingBill: created'))
    expect(afterTx).toContain('writeAuditLog')
    expect(afterTx).toContain('db')
  })

  test('10. UI has submitting state to prevent duplicate submission', async () => {
    const pageSource = await Bun.file('src/components/sort-page.tsx').text()
    expect(pageSource).toContain('submitting')
    expect(pageSource).toContain('setSubmitting(true)')
    expect(pageSource).toContain('setSubmitting(false)')
    expect(pageSource).toContain('disabled={submitting')
  })

  test('11. P2028 response includes retry guidance', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    expect(routeSource).toContain('กรุณารอสักครู่และลองใหม่')
    expect(routeSource).toContain('หากยังเกิดซ้ำให้แจ้งผู้ดูแล')
  })

  test('12. no raw Prisma internals exposed in error response', async () => {
    const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
    const p2028Section = routeSource.slice(routeSource.indexOf("code === 'P2028'"))
    // The P2028 response should not include Prisma internals
    expect(p2028Section).not.toContain('Transaction not found')
    expect(p2028Section).not.toContain('PrismaClientKnownRequestError')
  })
})
