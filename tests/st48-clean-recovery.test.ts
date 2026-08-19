import { describe, expect, test } from 'bun:test'
import { computeProductWeightedAverage, reconstructSortingCost, type CostObservation } from '../src/lib/st48-cost-engine'
import { buildRevaluationPlan, ST48_LEGACY_GUARDS, type CandidateLot, type EvidenceAdapter, type PlanRow } from '../src/lib/st48-revaluation-plan'
import { serializeAllowlist, serializeRollback, verifyArtifact } from '../src/lib/st48-artifacts'
import {
  APPLY_MODE_ENABLED, ROLLBACK_MODE_ENABLED, applyRevaluation, executeRevaluationTransaction,
  executeRollbackTransaction, rollbackRevaluation, type AuditInput, type DurableOperation,
  type ExecutionConfig, type ExecutorAdapter, type PersistedLot, type TransactionClient,
} from '../src/lib/st48-executor'

const d = (day: number) => new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`)
const observation = (overrides: Partial<CostObservation> = {}): CostObservation => ({ productId: 'p1', referenceWeight: 1, costPerKg: 10, occurredAt: d(1), valid: true, ...overrides })

describe('ST-48 quantity-weighted cost engine', () => {
  test('uses quantity-weighted average and differs from simple average', () => {
    const result = computeProductWeightedAverage('p1', [observation({ referenceWeight: 1, costPerKg: 10 }), observation({ referenceWeight: 9, costPerKg: 20 })])!
    expect(result.weightedAverage).toBe(19)
    expect(result.weightedAverage).not.toBe(15)
    expect(result.weightedNumerator).toBe(190)
  })
  test('isolates same product and excludes invalid evidence', () => {
    const result = computeProductWeightedAverage('p1', [observation(), observation({ productId: 'p2', costPerKg: 999 }), observation({ referenceWeight: 0 }), observation({ costPerKg: -1 }), observation({ cancelled: true }), observation({ proposedCorrection: true })])!
    expect(result.observationCount).toBe(1); expect(result.excludedRowCount).toBe(5); expect(result.weightedAverage).toBe(10)
  })
  test('returns null when all rows are invalid', () => expect(computeProductWeightedAverage('p1', [observation({ valid: false })])).toBeNull())
  test('preserves six-decimal boundary precision', () => expect(computeProductWeightedAverage('p1', [observation({ referenceWeight: 3, costPerKg: 1.123456 })])!.weightedAverage).toBe(1.123456))
  test('reports statistics, date range and low confidence', () => {
    const result = computeProductWeightedAverage('p1', [observation({ costPerKg: 10, occurredAt: d(2) }), observation({ costPerKg: 20, occurredAt: d(1) })])!
    expect(result.median).toBe(15); expect(result.min).toBe(10); expect(result.max).toBe(20); expect(result.dateRange.from).toContain('01-01'); expect(result.confidence).toBe('LOW')
  })
  test('is deterministic', () => {
    const rows = [observation({ referenceWeight: 7, costPerKg: 11 }), observation({ referenceWeight: 3, costPerKg: 17 })]
    expect(computeProductWeightedAverage('p1', rows)).toEqual(computeProductWeightedAverage('p1', [...rows].reverse()))
  })
})

describe('ST-48 honest sorting reconstruction', () => {
  const base = { sortingBillId: 's1', sourceProductId: 'p0', consumedQuantity: 100, consumedTotalCost: 1000, outputQuantity: 95, lossWeight: 5, gainWeight: 0, allocationRule: 'PROPORTIONAL_OUTPUT_WEIGHT' as const, hasExactSourceLayers: true }
  test('labels exact only with exact source layers', () => expect(reconstructSortingCost(base)?.method).toBe('EXACT_SOURCE_COST'))
  test('labels document reconstruction honestly', () => expect(reconstructSortingCost({ ...base, hasExactSourceLayers: false })?.method).toBe('DETERMINISTIC_SORTING_RECONSTRUCTION'))
  test('handles positive gain deterministically', () => expect(reconstructSortingCost({ ...base, consumedQuantity: 100, outputQuantity: 102, lossWeight: 0, gainWeight: 2 })?.costPerKg).toBeCloseTo(9.803922, 6))
  test('rejects zero output', () => expect(reconstructSortingCost({ ...base, outputQuantity: 0 })).toBeNull())
  test('rejects missing cost and inconsistent loss/gain', () => { expect(reconstructSortingCost({ ...base, consumedTotalCost: null })).toBeNull(); expect(reconstructSortingCost({ ...base, outputQuantity: 90 })).toBeNull() })
})

function candidate(overrides: Partial<CandidateLot> = {}): CandidateLot {
  return { lotId: 'lot-1', productId: 'p1', sourceType: 'BUY', sourceId: 'b1', remainingWeight: 10, currentCostPerKg: 0, ...overrides }
}
function evidence(lots: CandidateLot[], overrides: Partial<EvidenceAdapter> = {}): EvidenceAdapter {
  return { loadCandidates: async () => lots, loadExactSource: async () => null, loadSorting: async () => null, loadProductHistory: async productId => [observation({ productId })], ...overrides }
}

describe('ST-48 plan and legacy policy', () => {
  test('uses exact source before history', async () => expect((await buildRevaluationPlan(evidence([candidate()], { loadExactSource: async () => ({ costPerKg: 12, confidence: 'HIGH' }) }))).rows[0].derivationMethod).toBe('EXACT_SOURCE_COST'))
  test('falls back to same-product weighted history', async () => expect((await buildRevaluationPlan(evidence([candidate()]))).rows[0].derivationMethod).toBe('PRODUCT_HISTORICAL_WEIGHTED_AVERAGE'))
  test('unresolved evidence requires owner decision', async () => expect((await buildRevaluationPlan(evidence([candidate()], { loadProductHistory: async () => [] }))).unresolved).toHaveLength(1))
  test('guards exactly four legacy lots', () => { expect(ST48_LEGACY_GUARDS).toHaveLength(4); expect(new Set(ST48_LEGACY_GUARDS.map(row => row.lotId)).size).toBe(4) })
  test('classifies valid legacy and excludes it from allowlist', async () => {
    const guard = ST48_LEGACY_GUARDS[0]; const plan = await buildRevaluationPlan(evidence([candidate({ lotId: guard.lotId, productId: guard.productId, remainingWeight: guard.expectedRemainingWeight })]))
    expect(plan.legacy).toHaveLength(1); expect(plan.allowlist).toHaveLength(0)
  })
  test('stops on legacy product, weight or cost drift', async () => {
    const guard = ST48_LEGACY_GUARDS[0]
    await expect(buildRevaluationPlan(evidence([candidate({ lotId: guard.lotId, productId: 'wrong', remainingWeight: guard.expectedRemainingWeight })]))).rejects.toThrow('product drift')
    await expect(buildRevaluationPlan(evidence([candidate({ lotId: guard.lotId, productId: guard.productId, remainingWeight: 99 })]))).rejects.toThrow('weight drift')
    await expect(buildRevaluationPlan(evidence([candidate({ currentCostPerKg: 1 })]))).rejects.toThrow('Cost drift')
  })
  test('does not silently exclude unknown lot', async () => expect((await buildRevaluationPlan(evidence([candidate({ lotId: 'unknown' })]))).allowlist).toHaveLength(1))
})

function planRow(index: number): PlanRow { return { ...candidate({ lotId: `lot-${String(index).padStart(3, '0')}`, productId: `p-${index}`, sourceId: `src-${index}`, remainingWeight: index + 1 }), proposedCostPerKg: 10 + index / 10, derivationMethod: 'PRODUCT_HISTORICAL_WEIGHTED_AVERAGE', confidence: 'MEDIUM', weightedEvidence: null } }

describe('ST-48 canonical artifacts', () => {
  test('sorts rows, preserves key order and one newline', () => {
    const artifact = serializeAllowlist([planRow(2), planRow(1)])
    expect(artifact.rows[0].lotId).toBe('lot-001'); expect(artifact.bytes.endsWith('\n')).toBe(true); expect(artifact.bytes.endsWith('\n\n')).toBe(false)
    expect(Object.keys(artifact.rows[0])[0]).toBe('lotId')
  })
  test('produces stable checksum and byte changes alter it', () => {
    const first = serializeAllowlist([planRow(1)]); const second = serializeAllowlist([planRow(1)])
    expect(first.sha256).toBe(second.sha256); expect(first.sha256).not.toBe(serializeAllowlist([{ ...planRow(1), remainingWeight: 3 }]).sha256)
    verifyArtifact(first.bytes, first.sha256)
  })
  test('builds one-to-one rollback and rejects duplicate IDs', () => {
    const allow = serializeAllowlist([planRow(1), planRow(2)]); const rollback = serializeRollback(allow.rows, 'st48-fixture-release')
    expect(rollback.rows.map(row => row.lotId)).toEqual(allow.rows.map(row => row.lotId))
    expect(() => serializeAllowlist([planRow(1), planRow(1)])).toThrow('Duplicate')
  })
  test('legacy cannot enter allowlist', () => {
    const guard = ST48_LEGACY_GUARDS[0]
    expect(() => serializeAllowlist([{ ...planRow(1), lotId: guard.lotId }])).toThrow('Legacy')
  })
})

interface State { lots: PersistedLot[]; operations: DurableOperation[]; audits: AuditInput[]; failAt?: 'update' | 'audit' | 'verify' }
function memoryAdapter(initialLots: PersistedLot[], identity = 'test-db'): { adapter: ExecutorAdapter; state: State } {
  const state: State = { lots: structuredClone(initialLots), operations: [], audits: [] }
  const txClient = (working: State): TransactionClient => ({
    findOperation: async requestId => working.operations.find(row => row.requestId === requestId) ?? null,
    createOperation: async operation => { working.operations.push(structuredClone(operation)) },
    completeOperation: async requestId => { working.operations.find(row => row.requestId === requestId)!.status = 'COMPLETED' },
    loadLots: async ids => { if (working.failAt === 'verify' && working.audits.length > 0) return []; return working.lots.filter(row => ids.includes(row.id)).map(row => structuredClone(row)) },
    loadRevaluationEvidence: async (lotId, releaseOperationId) => {
      const audit = working.audits.find(row => row.action === 'REVALUE' && row.entityId === lotId && JSON.parse(row.details).operationId === releaseOperationId)
      if (!audit) return null
      const details = JSON.parse(audit.details) as { productId: string; sourceType: string; sourceId: string | null }
      return { productId: details.productId, sourceType: details.sourceType, sourceId: details.sourceId }
    },
    updateLotCost: async (id, expected, proposed) => { if (working.failAt === 'update') throw new Error('update failure'); const lot = working.lots.find(row => row.id === id); if (!lot || lot.costPerKg !== expected) throw new Error('atomic guard'); lot.costPerKg = proposed },
    createAudit: async input => { if (working.failAt === 'audit') throw new Error('audit failure'); working.audits.push(structuredClone(input)) },
  })
  return { state, adapter: { databaseIdentity: async () => identity, transaction: async work => {
    const working = structuredClone(state)
    try { const result = await work(txClient(working)); Object.assign(state, working); return result } catch (error) { throw error }
  } } }
}
function fixture(count = 49) {
  const rows = Array.from({ length: count }, (_, index) => planRow(index + 1)); const allow = serializeAllowlist(rows); const rollback = serializeRollback(allow.rows, 'st48-fixture-release')
  const lots = allow.rows.map(row => ({ id: row.lotId, productId: row.productId, source: row.sourceType, sourceId: row.sourceId, remainingWeight: Number(row.expectedRemainingWeight), costPerKg: 0 }))
  const config: ExecutionConfig = { apply: true, artifactBytes: allow.bytes, artifactSha256: allow.sha256, rollbackBytes: rollback.bytes, rollbackSha256: rollback.sha256, ownerApprovalReference: 'owner-fixture-approval', expectedApprovalReference: 'owner-fixture-approval', expectedDatabaseIdentity: 'test-db', releaseOperationId: 'st48-fixture-release', expectedRowCount: count, actor: { id: 'tester' } }
  return { allow, rollback, lots, config }
}

describe('ST-48 disabled transactional executors', () => {
  test('public apply and rollback gates remain disabled with dry-run default', async () => {
    const { adapter } = memoryAdapter([]); expect(APPLY_MODE_ENABLED).toBe(false); expect(ROLLBACK_MODE_ENABLED).toBe(false)
    expect((await applyRevaluation(adapter)).dryRun).toBe(true); expect((await rollbackRevaluation(adapter)).dryRun).toBe(true)
  })
  test('isolated executor applies a 49-row fixture and changes cost only', async () => {
    const f = fixture(); const { adapter, state } = memoryAdapter(f.lots); const before = structuredClone(state.lots)
    const result = await executeRevaluationTransaction(adapter, f.config)
    expect(result.rowCount).toBe(49); expect(state.operations[0].status).toBe('COMPLETED'); expect(state.audits).toHaveLength(50)
    state.lots.forEach((lot, index) => { expect(lot.remainingWeight).toBe(before[index].remainingWeight); expect(lot.productId).toBe(before[index].productId); expect(lot.costPerKg).not.toBe(0) })
  })
  test('rejects checksum, approval, identity, operation and row-count errors', async () => {
    const f = fixture(2); const { adapter } = memoryAdapter(f.lots)
    await expect(executeRevaluationTransaction(adapter, { ...f.config, artifactSha256: '0'.repeat(64) })).rejects.toThrow('checksum')
    await expect(executeRevaluationTransaction(adapter, { ...f.config, ownerApprovalReference: 'wrong' })).rejects.toThrow('approval')
    await expect(executeRevaluationTransaction(memoryAdapter(f.lots, 'wrong').adapter, f.config)).rejects.toThrow('identity')
    await expect(executeRevaluationTransaction(adapter, { ...f.config, releaseOperationId: 'bad' })).rejects.toThrow('operation ID')
    await expect(executeRevaluationTransaction(adapter, { ...f.config, expectedRowCount: 3 })).rejects.toThrow('row count')
  })
  test('rejects missing lot, cost/weight/product/source drift', async () => {
    const f = fixture(2)
    await expect(executeRevaluationTransaction(memoryAdapter(f.lots.slice(1)).adapter, f.config)).rejects.toThrow('Missing')
    for (const [field, value, message] of [['costPerKg', 1, 'Cost drift'], ['remainingWeight', 999, 'Weight drift'], ['productId', 'wrong', 'Product'], ['source', 'wrong', 'Source']] as const) {
      const lots = structuredClone(f.lots); Object.assign(lots[0], { [field]: value }); await expect(executeRevaluationTransaction(memoryAdapter(lots).adapter, f.config)).rejects.toThrow(message)
    }
  })
  test('durable duplicate operation is rejected', async () => {
    const f = fixture(2); const harness = memoryAdapter(f.lots); await executeRevaluationTransaction(harness.adapter, f.config)
    await expect(executeRevaluationTransaction(harness.adapter, f.config)).rejects.toThrow('already exists')
  })
  test('update, audit and verification failures roll back entire transaction', async () => {
    const f = fixture(2)
    for (const failAt of ['update', 'audit', 'verify'] as const) { const harness = memoryAdapter(f.lots); harness.state.failAt = failAt; await expect(executeRevaluationTransaction(harness.adapter, f.config)).rejects.toThrow(); expect(harness.state.lots.every(row => row.costPerKg === 0)).toBe(true); expect(harness.state.operations).toHaveLength(0); expect(harness.state.audits).toHaveLength(0) }
  })
  test('rollback succeeds exactly once and preserves weight/source', async () => {
    const f = fixture(3); const harness = memoryAdapter(f.lots); await executeRevaluationTransaction(harness.adapter, f.config)
    const rollbackConfig = { apply: true, rollbackBytes: f.rollback.bytes, rollbackSha256: f.rollback.sha256, ownerApprovalReference: 'rollback-approval', expectedApprovalReference: 'rollback-approval', expectedDatabaseIdentity: 'test-db', releaseOperationId: 'rollback-st48-fixture-release', originalReleaseOperationId: 'st48-fixture-release', expectedRowCount: 3, actor: { id: 'tester' } }
    await executeRollbackTransaction(harness.adapter, rollbackConfig); expect(harness.state.lots.every(row => row.costPerKg === 0)).toBe(true)
    await expect(executeRollbackTransaction(harness.adapter, rollbackConfig)).rejects.toThrow('already exists')
  })
  test('rollback rejects source drift against the original revaluation evidence', async () => {
    const f = fixture(2); const harness = memoryAdapter(f.lots); await executeRevaluationTransaction(harness.adapter, f.config)
    harness.state.lots[0].sourceId = 'changed-after-revaluation'
    await expect(executeRollbackTransaction(harness.adapter, { apply: true, rollbackBytes: f.rollback.bytes, rollbackSha256: f.rollback.sha256, ownerApprovalReference: 'rollback-approval', expectedApprovalReference: 'rollback-approval', expectedDatabaseIdentity: 'test-db', releaseOperationId: 'rollback-st48-fixture-release', originalReleaseOperationId: 'st48-fixture-release', expectedRowCount: 2, actor: { id: 'tester' } })).rejects.toThrow('source drift')
    expect(harness.state.operations).toHaveLength(1); expect(harness.state.lots.every(row => row.costPerKg !== 0)).toBe(true)
  })
})
