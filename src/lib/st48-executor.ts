import { verifyArtifact, type AllowlistRow, type RollbackRow } from './st48-artifacts'
import { ST48_LEGACY_GUARDS } from './st48-revaluation-plan'

export const APPLY_MODE_ENABLED = false
export const ROLLBACK_MODE_ENABLED = false
const EPSILON = 0.000001

export interface PersistedLot {
  id: string; productId: string; source: string; sourceId: string | null
  remainingWeight: number; costPerKg: number
}
export interface DurableOperation {
  requestId: string; operationType: string; sourceEntityId: string | null; status: string
}
export interface AuditInput {
  action: string; entityType: string; entityId: string; userId?: string; userName?: string; details: string
}
export interface TransactionClient {
  findOperation(requestId: string): Promise<DurableOperation | null>
  createOperation(operation: DurableOperation): Promise<void>
  completeOperation(requestId: string): Promise<void>
  loadLots(ids: readonly string[]): Promise<PersistedLot[]>
  loadRevaluationEvidence(lotId: string, releaseOperationId: string): Promise<{ productId: string; sourceType: string; sourceId: string | null } | null>
  updateLotCost(lotId: string, expectedCost: number, proposedCost: number): Promise<void>
  createAudit(input: AuditInput): Promise<void>
}
export interface ExecutorAdapter {
  databaseIdentity(): Promise<string>
  transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T>
}
export interface ExecutionConfig {
  apply: boolean
  artifactBytes: string
  artifactSha256: string
  rollbackBytes: string
  rollbackSha256: string
  ownerApprovalReference: string
  expectedApprovalReference: string
  expectedDatabaseIdentity: string
  releaseOperationId: string
  expectedRowCount: number
  actor: { id?: string; name?: string }
}
export interface ExecutionResult { applied: boolean; dryRun: boolean; operationId?: string; rowCount?: number; reason?: string }

function parseRows<T>(bytes: string): T[] {
  const value: unknown = JSON.parse(bytes)
  if (!Array.isArray(value)) throw new Error('Artifact root must be an array')
  return value as T[]
}
function number(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Invalid artifact decimal')
  return parsed
}
function uniqueIds(rows: readonly { lotId: string }[], label: string): void {
  if (new Set(rows.map(row => row.lotId)).size !== rows.length) throw new Error(`Duplicate ${label} lot ID`)
}
function verifyConfig(config: ExecutionConfig): void {
  if (!config.apply) throw new Error('Explicit apply flag required')
  if (!config.releaseOperationId || !/^st48-[a-z0-9-]+$/.test(config.releaseOperationId)) throw new Error('Invalid deterministic release operation ID')
  if (!config.ownerApprovalReference || config.ownerApprovalReference !== config.expectedApprovalReference) throw new Error('Owner approval reference mismatch')
  if (!Number.isInteger(config.expectedRowCount) || config.expectedRowCount <= 0) throw new Error('Invalid expected row count')
}
function assertAllowlistShape(allowlist: readonly AllowlistRow[], rollback: readonly RollbackRow[], config: ExecutionConfig): void {
  uniqueIds(allowlist, 'allowlist'); uniqueIds(rollback, 'rollback')
  if (allowlist.length !== config.expectedRowCount || rollback.length !== allowlist.length) throw new Error('Artifact row count mismatch')
  const legacy = new Set(ST48_LEGACY_GUARDS.map(row => row.lotId))
  if (allowlist.some(row => legacy.has(row.lotId))) throw new Error('Legacy lot included')
  for (const row of allowlist) {
    const undo = rollback.find(candidate => candidate.lotId === row.lotId)
    if (!undo || undo.productId !== row.productId || undo.expectedAppliedCostPerKg !== row.proposedCostPerKg ||
      undo.rollbackCostPerKg !== row.expectedCurrentCostPerKg || undo.expectedRemainingWeight !== row.expectedRemainingWeight ||
      undo.releaseOperationId !== config.releaseOperationId) throw new Error(`Rollback mismatch for ${row.lotId}`)
  }
}
function assertPersisted(row: AllowlistRow, lot: PersistedLot, expectedCost: number): void {
  if (lot.id !== row.lotId || lot.productId !== row.productId) throw new Error(`Product/lot drift for ${row.lotId}`)
  if (lot.source !== row.sourceType || lot.sourceId !== row.sourceId) throw new Error(`Source drift for ${row.lotId}`)
  if (Math.abs(lot.remainingWeight - number(row.expectedRemainingWeight)) > EPSILON) throw new Error(`Weight drift for ${row.lotId}`)
  if (Math.abs(lot.costPerKg - expectedCost) > EPSILON) throw new Error(`Cost drift for ${row.lotId}`)
}

export async function executeRevaluationTransaction(adapter: ExecutorAdapter, config: ExecutionConfig): Promise<ExecutionResult> {
  verifyConfig(config)
  verifyArtifact(config.artifactBytes, config.artifactSha256)
  verifyArtifact(config.rollbackBytes, config.rollbackSha256)
  const allowlist = parseRows<AllowlistRow>(config.artifactBytes)
  const rollback = parseRows<RollbackRow>(config.rollbackBytes)
  assertAllowlistShape(allowlist, rollback, config)
  if (await adapter.databaseIdentity() !== config.expectedDatabaseIdentity) throw new Error('Database identity mismatch')
  return adapter.transaction(async tx => {
    if (await tx.findOperation(config.releaseOperationId)) throw new Error('Release operation already exists')
    await tx.createOperation({ requestId: config.releaseOperationId, operationType: 'ST48_COST_REVALUATION', sourceEntityId: config.artifactSha256, status: 'IN_PROGRESS' })
    const lots = await tx.loadLots(allowlist.map(row => row.lotId))
    if (lots.length !== allowlist.length) throw new Error('Missing or extra persisted lots')
    const map = new Map(lots.map(lot => [lot.id, lot]))
    for (const row of allowlist) {
      const lot = map.get(row.lotId); if (!lot) throw new Error(`Missing lot ${row.lotId}`)
      const before = number(row.expectedCurrentCostPerKg); const after = number(row.proposedCostPerKg)
      assertPersisted(row, lot, before)
      await tx.updateLotCost(row.lotId, before, after)
      await tx.createAudit({ action: 'REVALUE', entityType: 'STOCK_LOT', entityId: row.lotId, userId: config.actor.id, userName: config.actor.name,
        details: JSON.stringify({ operationId: config.releaseOperationId, approvalReference: config.ownerApprovalReference, allowlistSha256: config.artifactSha256, rollbackSha256: config.rollbackSha256, beforeCostPerKg: row.expectedCurrentCostPerKg, afterCostPerKg: row.proposedCostPerKg, remainingWeight: row.expectedRemainingWeight, productId: row.productId, sourceType: row.sourceType, sourceId: row.sourceId }) })
    }
    const verified = await tx.loadLots(allowlist.map(row => row.lotId))
    if (verified.length !== allowlist.length) throw new Error('Post-write row-count drift')
    for (const row of allowlist) {
      const lot = verified.find(candidate => candidate.id === row.lotId)
      if (!lot) throw new Error(`Post-write missing lot ${row.lotId}`)
      assertPersisted(row, lot, number(row.proposedCostPerKg))
    }
    await tx.createAudit({ action: 'COMPLETE', entityType: 'ST48_REVALUATION', entityId: config.releaseOperationId, userId: config.actor.id, userName: config.actor.name,
      details: JSON.stringify({ operationId: config.releaseOperationId, rowCount: allowlist.length, allowlistSha256: config.artifactSha256, rollbackSha256: config.rollbackSha256, approvalReference: config.ownerApprovalReference }) })
    await tx.completeOperation(config.releaseOperationId)
    return { applied: true, dryRun: false, operationId: config.releaseOperationId, rowCount: allowlist.length }
  })
}

export async function applyRevaluation(adapter: ExecutorAdapter, config?: ExecutionConfig): Promise<ExecutionResult> {
  if (!config || !config.apply) return { applied: false, dryRun: true, reason: 'Dry-run default' }
  if (!APPLY_MODE_ENABLED) return { applied: false, dryRun: true, reason: 'APPLY MODE DISABLED' }
  return executeRevaluationTransaction(adapter, config)
}

export interface RollbackConfig extends Omit<ExecutionConfig, 'artifactBytes' | 'artifactSha256' | 'rollbackBytes' | 'rollbackSha256'> {
  rollbackBytes: string; rollbackSha256: string; originalReleaseOperationId: string
}
export async function executeRollbackTransaction(adapter: ExecutorAdapter, config: RollbackConfig): Promise<ExecutionResult> {
  if (!config.apply) throw new Error('Explicit rollback flag required')
  verifyArtifact(config.rollbackBytes, config.rollbackSha256)
  if (config.releaseOperationId !== `rollback-${config.originalReleaseOperationId}`) throw new Error('Invalid rollback operation ID')
  if (config.ownerApprovalReference !== config.expectedApprovalReference) throw new Error('Owner approval reference mismatch')
  const rows = parseRows<RollbackRow>(config.rollbackBytes); uniqueIds(rows, 'rollback')
  if (rows.length !== config.expectedRowCount || rows.some(row => row.releaseOperationId !== config.originalReleaseOperationId)) throw new Error('Rollback artifact mismatch')
  if (await adapter.databaseIdentity() !== config.expectedDatabaseIdentity) throw new Error('Database identity mismatch')
  return adapter.transaction(async tx => {
    const original = await tx.findOperation(config.originalReleaseOperationId)
    if (!original || original.status !== 'COMPLETED') throw new Error('Original release is not completed')
    if (await tx.findOperation(config.releaseOperationId)) throw new Error('Rollback operation already exists')
    await tx.createOperation({ requestId: config.releaseOperationId, operationType: 'ST48_COST_REVALUATION_ROLLBACK', sourceEntityId: config.originalReleaseOperationId, status: 'IN_PROGRESS' })
    const lots = await tx.loadLots(rows.map(row => row.lotId)); if (lots.length !== rows.length) throw new Error('Missing rollback lots')
    for (const row of rows) {
      const lot = lots.find(candidate => candidate.id === row.lotId); if (!lot || lot.productId !== row.productId) throw new Error(`Rollback product drift for ${row.lotId}`)
      const evidence = await tx.loadRevaluationEvidence(row.lotId, config.originalReleaseOperationId)
      if (!evidence || evidence.productId !== row.productId || lot.source !== evidence.sourceType || lot.sourceId !== evidence.sourceId) throw new Error(`Rollback source drift for ${row.lotId}`)
      if (Math.abs(lot.remainingWeight - number(row.expectedRemainingWeight)) > EPSILON) throw new Error(`Rollback weight drift for ${row.lotId}`)
      const applied = number(row.expectedAppliedCostPerKg); const previous = number(row.rollbackCostPerKg)
      if (Math.abs(lot.costPerKg - applied) > EPSILON) throw new Error(`Rollback cost drift for ${row.lotId}`)
      await tx.updateLotCost(row.lotId, applied, previous)
      await tx.createAudit({ action: 'ROLLBACK', entityType: 'STOCK_LOT', entityId: row.lotId, userId: config.actor.id, userName: config.actor.name,
        details: JSON.stringify({ rollbackOperationId: config.releaseOperationId, originalReleaseOperationId: config.originalReleaseOperationId, beforeCostPerKg: row.expectedAppliedCostPerKg, afterCostPerKg: row.rollbackCostPerKg, remainingWeight: row.expectedRemainingWeight, productId: row.productId, rollbackSha256: config.rollbackSha256, approvalReference: config.ownerApprovalReference }) })
    }
    const verified = await tx.loadLots(rows.map(row => row.lotId))
    for (const row of rows) {
      const lot = verified.find(candidate => candidate.id === row.lotId)
      if (!lot || Math.abs(lot.costPerKg - number(row.rollbackCostPerKg)) > EPSILON || Math.abs(lot.remainingWeight - number(row.expectedRemainingWeight)) > EPSILON) throw new Error(`Rollback verification failed for ${row.lotId}`)
    }
    await tx.createAudit({ action: 'COMPLETE', entityType: 'ST48_REVALUATION_ROLLBACK', entityId: config.releaseOperationId, userId: config.actor.id, userName: config.actor.name,
      details: JSON.stringify({ rollbackOperationId: config.releaseOperationId, originalReleaseOperationId: config.originalReleaseOperationId, rowCount: rows.length, rollbackSha256: config.rollbackSha256, approvalReference: config.ownerApprovalReference }) })
    await tx.completeOperation(config.releaseOperationId)
    return { applied: true, dryRun: false, operationId: config.releaseOperationId, rowCount: rows.length }
  })
}

export async function rollbackRevaluation(adapter: ExecutorAdapter, config?: RollbackConfig): Promise<ExecutionResult> {
  if (!config || !config.apply) return { applied: false, dryRun: true, reason: 'Dry-run default' }
  if (!ROLLBACK_MODE_ENABLED) return { applied: false, dryRun: true, reason: 'ROLLBACK MODE DISABLED' }
  return executeRollbackTransaction(adapter, config)
}
