import { describe, expect, test } from 'bun:test'
import { classifyImportBillError } from '../src/lib/import-pipeline'
import { DuplicateExistingError } from '../src/lib/bill-errors'

describe('ST-57 sales import P2028 + per-bill error sanitization', () => {
  describe('Phase 2-5: classifyImportBillError (production function)', () => {
    test('1. P2028 classified as TRANSACTION_TIMEOUT', () => {
      const error = Object.assign(new Error('Invalid prisma.stockLot.update() invocation: Transaction not found. Transaction ID is invalid'), { code: 'P2028' })
      const result = classifyImportBillError(error)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('TRANSACTION_TIMEOUT')
      expect(result.safeMessage).toContain('การนำเข้าบิลใช้เวลานานเกินกำหนด')
      expect(result.safeMessage).toContain('กรุณารอสักครู่และลองใหม่')
      // No raw Prisma internals
      expect(result.safeMessage).not.toContain('Transaction not found')
      expect(result.safeMessage).not.toContain('PrismaClient')
      expect(result.safeMessage).not.toContain('stockLot.update')
    })

    test('2. SOURCE_LOT_CONFLICT classified safely', () => {
      const error = Object.assign(new Error('CAS mismatch'), { code: 'SOURCE_LOT_CONFLICT' })
      const result = classifyImportBillError(error)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('SOURCE_LOT_CONFLICT')
      expect(result.safeMessage).toContain('สต็อกต้นทางมีการเปลี่ยนแปลง')
      expect(result.safeMessage).not.toContain('CAS mismatch')
    })

    test('3. insufficient stock classified as INSUFFICIENT_STOCK', () => {
      const error = new Error('สต็อกไม่เพียงพอสำหรับ "เหล็ก". มี: 100 kg, ต้องการ: 200 kg')
      const result = classifyImportBillError(error)
      expect(result.status).toBe('INSUFFICIENT_STOCK')
      expect(result.errorCode).toBe('INSUFFICIENT_STOCK')
      expect(result.safeMessage).toContain('สต็อกไม่เพียงพอ')
    })

    test('4. unknown error returns generic safe message', () => {
      const error = new Error('Some internal database connection failure with SQL: SELECT * FROM')
      const result = classifyImportBillError(error)
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('BILL_CREATE_FAILED')
      expect(result.safeMessage).toBe('นำเข้าบิลไม่สำเร็จ กรุณาลองใหม่หรือแจ้งผู้ดูแล')
      // No raw internals
      expect(result.safeMessage).not.toContain('database')
      expect(result.safeMessage).not.toContain('SQL')
      expect(result.safeMessage).not.toContain('SELECT')
    })

    test('5. zero-cost source lot classified safely', () => {
      const error = new Error('ZERO_COST_SOURCE_LOT: lot-123 has costPerKg=0')
      const result = classifyImportBillError(error)
      expect(result.errorCode).toBe('FIFO_VALIDATION_ERROR')
      expect(result.safeMessage).toContain('ต้นทุน 0')
      expect(result.safeMessage).not.toContain('ZERO_COST_SOURCE_LOT')
      expect(result.safeMessage).not.toContain('lot-123')
    })

    test('6. FIFO mismatch classified safely', () => {
      const error = Object.assign(new Error('FIFO preview/execution mismatch'), { code: 'FIFO_MISMATCH' })
      const result = classifyImportBillError(error)
      expect(result.errorCode).toBe('FIFO_MISMATCH')
      expect(result.safeMessage).toContain('สต็อกต้นทางมีการเปลี่ยนแปลง')
    })

    test('7. non-Error unknown value classified safely', () => {
      const result = classifyImportBillError('some string error')
      expect(result.errorCode).toBe('BILL_CREATE_FAILED')
      expect(result.safeMessage).not.toContain('some string')
    })

    test('8. DuplicateExistingError is NOT classified by classifyImportBillError (handled separately)', () => {
      // DuplicateExistingError is handled by instanceof check in applyImport,
      // not by classifyImportBillError. But if it reaches the classifier:
      const error = new DuplicateExistingError('externalBillNumber')
      const result = classifyImportBillError(error)
      // It would fall through to BILL_CREATE_FAILED since it doesn't match
      // any specific code/message pattern
      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('BILL_CREATE_FAILED')
    })
  })

  describe('Phase 7: mandatory CAS verification', () => {
    test('9. SellBillTx interface requires expected parameter', async () => {
      const serviceSource = await Bun.file('src/lib/bill-services.ts').text()
      // The interface should NOT have optional ? on expected
      expect(serviceSource).toContain('expected: { productId: string; remainingWeight: number; costPerKg: number }')
      expect(serviceSource).not.toContain('expected?')
    })

    test('10. Prisma adapter always uses updateMany with CAS WHERE', async () => {
      const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
      const sellSection = adapterSource.slice(adapterSource.indexOf('makeSellBillServiceDeps'))
      expect(sellSection).toContain('updateMany')
      expect(sellSection).toContain('expected.productId')
      expect(sellSection).toContain('expected.remainingWeight')
      expect(sellSection).toContain('expected.costPerKg')
      expect(sellSection).not.toContain('if (expected)')
    })

    test('11. service passes expected values from lot data', async () => {
      const serviceSource = await Bun.file('src/lib/bill-services.ts').text()
      expect(serviceSource).toContain('productId: lot.productId')
      expect(serviceSource).toContain('remainingWeight: lot.remainingWeight')
      expect(serviceSource).toContain('costPerKg: lot.costPerKg')
    })
  })

  describe('Phase 6: outer route error handling', () => {
    test('12. import apply route handles P2028 at route level (defense in depth)', async () => {
      const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
      expect(routeSource).toContain("code === 'P2028'")
      expect(routeSource).toContain('503')
      expect(routeSource).toContain('TRANSACTION_TIMEOUT')
    })

    test('13. import apply route handles SOURCE_LOT_CONFLICT at route level', async () => {
      const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
      expect(routeSource).toContain("code === 'SOURCE_LOT_CONFLICT'")
      expect(routeSource).toContain('409')
    })

    test('14. route P2028 response has no raw Prisma text', async () => {
      const routeSource = await Bun.file('src/app/api/import/apply/route.ts').text()
      const p2028Section = routeSource.slice(routeSource.indexOf("code === 'P2028'"))
      expect(p2028Section).not.toContain('Transaction not found')
      expect(p2028Section).not.toContain('PrismaClientKnownRequestError')
    })
  })

  describe('Phase 3: per-bill error sanitization in applyImport', () => {
    test('15. applyImport uses classifyImportBillError for non-duplicate errors', async () => {
      const pipelineSource = await Bun.file('src/lib/import-pipeline.ts').text()
      expect(pipelineSource).toContain('classifyImportBillError')
      expect(pipelineSource).toContain('classified.safeMessage')
      expect(pipelineSource).toContain('classified.errorCode')
    })

    test('16. applyImport no longer exposes err.message directly', async () => {
      const pipelineSource = await Bun.file('src/lib/import-pipeline.ts').text()
      // The old pattern was: error: err instanceof Error ? err.message : 'Unknown error'
      // The new pattern uses classifyImportBillError
      const catchSection = pipelineSource.slice(pipelineSource.indexOf('} else {'))
      expect(catchSection).not.toContain("err instanceof Error ? err.message")
    })

    test('17. BillImportResult has errorCode field', async () => {
      const pipelineSource = await Bun.file('src/lib/import-pipeline.ts').text()
      expect(pipelineSource).toContain('errorCode?: string')
    })
  })

  describe('Phase 8: transaction timeout configuration', () => {
    test('18. SellBill adapter uses 15s timeout', async () => {
      const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
      expect(adapterSource).toContain('maxWait: 5000')
      expect(adapterSource).toContain('timeout: 15000')
    })

    test('19. SellBill adapter does NOT use stockLot.update (uses updateMany)', async () => {
      const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
      const sellSection = adapterSource.slice(adapterSource.indexOf('makeSellBillServiceDeps'))
      expect(sellSection).not.toContain('prismaTx.stockLot.update(')
      expect(sellSection).toContain('prismaTx.stockLot.updateMany(')
    })
  })

  describe('Phase 12: PR claims verification', () => {
    test('20. FIFO ordering preserved (FIFO_ORDER_BY)', async () => {
      const adapterSource = await Bun.file('src/lib/bill-service-prisma-adapters.ts').text()
      expect(adapterSource).toContain('FIFO_ORDER_BY')
    })

    test('21. SellSourceLot includes productId for CAS', async () => {
      const serviceSource = await Bun.file('src/lib/bill-services.ts').text()
      expect(serviceSource).toContain('productId: string')
    })
  })
})
