import { createHash } from 'crypto'
import { decimal6 } from './st48-cost-engine'
import { assertNoLegacyAllowlist, type PlanRow } from './st48-revaluation-plan'

export interface AllowlistRow {
  lotId: string; productId: string; sourceType: string; sourceId: string | null
  expectedCurrentCostPerKg: string; expectedRemainingWeight: string; proposedCostPerKg: string
  derivationMethod: string; confidence: string
}
export interface RollbackRow {
  lotId: string; productId: string; expectedAppliedCostPerKg: string; rollbackCostPerKg: string
  expectedRemainingWeight: string; releaseOperationId: string
}
export interface CanonicalArtifact<T> { rows: T[]; bytes: string; sha256: string }

function canonical<T>(rows: T[]): CanonicalArtifact<T> {
  const bytes = `${JSON.stringify(rows, null, 2)}\n`
  return { rows, bytes, sha256: createHash('sha256').update(bytes, 'utf8').digest('hex') }
}

export function serializeAllowlist(planRows: readonly PlanRow[]): CanonicalArtifact<AllowlistRow> {
  assertNoLegacyAllowlist(planRows)
  const ids = planRows.map(row => row.lotId)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate allowlist lot ID')
  const rows = [...planRows].sort((a, b) => a.lotId.localeCompare(b.lotId)).map(row => {
    if (row.proposedCostPerKg === null) throw new Error(`Unresolved lot ${row.lotId}`)
    return {
      lotId: row.lotId, productId: row.productId, sourceType: row.sourceType, sourceId: row.sourceId,
      expectedCurrentCostPerKg: decimal6(row.currentCostPerKg), expectedRemainingWeight: decimal6(row.remainingWeight),
      proposedCostPerKg: decimal6(row.proposedCostPerKg), derivationMethod: row.derivationMethod, confidence: row.confidence,
    }
  })
  return canonical(rows)
}

export function serializeRollback(allowlist: readonly AllowlistRow[], releaseOperationId: string): CanonicalArtifact<RollbackRow> {
  if (!releaseOperationId) throw new Error('Missing release operation ID')
  const ids = allowlist.map(row => row.lotId)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate rollback lot ID')
  return canonical([...allowlist].sort((a, b) => a.lotId.localeCompare(b.lotId)).map(row => ({
    lotId: row.lotId, productId: row.productId, expectedAppliedCostPerKg: row.proposedCostPerKg,
    rollbackCostPerKg: row.expectedCurrentCostPerKg, expectedRemainingWeight: row.expectedRemainingWeight, releaseOperationId,
  })))
}

export function verifyArtifact(bytes: string, expectedSha256: string): void {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid SHA-256')
  const actual = createHash('sha256').update(bytes, 'utf8').digest('hex')
  if (actual !== expectedSha256) throw new Error('Artifact checksum mismatch')
  if (!bytes.endsWith('\n') || bytes.endsWith('\n\n')) throw new Error('Artifact must have exactly one trailing newline')
}

