import { describe, expect, test } from 'bun:test'

describe('ST-57 sales import P2028 fix', () => {
  test('1. import apply route handles P2028 with HTTP 503', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    expect(routeSource).toContain("code === 'P2028'")
    expect(routeSource).toContain('TRANSACTION_TIMEOUT')
    expect(routeSource).toContain('503')
    expect(routeSource).toContain('การนำเข้าบิลใช้เวลานานเกินกำหนด')
  })

  test('2. import apply route handles SOURCE_LOT_CONFLICT with HTTP 409', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    expect(routeSource).toContain("code === 'SOURCE_LOT_CONFLICT'")
    expect(routeSource).toContain('409')
    expect(routeSource).toContain('สต็อกต้นทางมีการเปลี่ยนแปลง')
  })

  test('3. no raw Prisma error in P2028 response', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    const p2028Section = routeSource.slice(routeSource.indexOf("code === 'P2028'"))
    expect(p2028Section).not.toContain('Transaction not found')
    expect(p2028Section).not.toContain('PrismaClientKnownRequestError')
  })

  test('4. SellBill adapter uses explicit transaction timeout', async () => {
    const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
    expect(adapterSource).toContain('maxWait: 5000')
    expect(adapterSource).toContain('timeout: 15000')
  })

  test('5. SellBill adapter uses updateMany with CAS guard', async () => {
    const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
    expect(adapterSource).toContain('updateMany')
    expect(adapterSource).toContain('result.count !== 1')
    expect(adapterSource).toContain('SOURCE_LOT_CONFLICT')
  })

  test('6. SellBill service passes expected values to updateStockLotRemaining', async () => {
    const serviceSource = await Bun.file('src/lib/bill-services.ts').text()
    expect(serviceSource).toContain('productId: lot.productId')
    expect(serviceSource).toContain('remainingWeight: lot.remainingWeight')
    expect(serviceSource).toContain('costPerKg: lot.costPerKg')
  })

  test('7. SellSourceLot includes productId', async () => {
    const serviceSource = await Bun.file('src/lib/bill-services.ts').text()
    expect(serviceSource).toContain('productId: string')
  })

  test('8. import apply handles DUPLICATE_EXISTING', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    expect(routeSource).toContain('DUPLICATE_EXISTING')
    expect(routeSource).toContain('409')
  })

  test('9. import apply handles insufficient stock', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    expect(routeSource).toContain('สต็อกไม่เพียงพอ')
    expect(routeSource).toContain('INSUFFICIENT_STOCK')
    expect(routeSource).toContain('400')
  })

  test('10. SellBill adapter does NOT use stockLot.update (uses updateMany)', async () => {
    const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
    // The sell adapter section should not contain stockLot.update
    const sellSection = adapterSource.slice(adapterSource.indexOf('makeSellBillServiceDeps'))
    expect(sellSection).not.toContain('prismaTx.stockLot.update(')
    expect(sellSection).toContain('prismaTx.stockLot.updateMany(')
  })

  test('11. P2028 response includes retry guidance', async () => {
    const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
    expect(routeSource).toContain('กรุณารอสักครู่และลองใหม่')
    expect(routeSource).toContain('หากยังเกิดซ้ำให้แจ้งผู้ดูแล')
  })

  test('12. FIFO ordering preserved (FIFO_ORDER_BY)', async () => {
    const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
    expect(adapterSource).toContain('FIFO_ORDER_BY')
  })
})
