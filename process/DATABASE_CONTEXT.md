# Database Context — YH Stock System

> Durable database/stock-flow context. Exact schema fields must be read from current `prisma/schema.prisma` and approved migrations.
> Last reconciled: 2026-08-07

## 1. Canonical database sources

For any schema/data claim, use this order:

1. current `prisma/schema.prisma` on the exact branch/head
2. approved migration files and migration history
3. `process/CURRENT_STATE.md` for known schema/runtime gaps
4. current code/tests that read/write the models
5. Production read-only evidence when authorized and runtime truth is required

This document must not be used as a frozen field-by-field schema copy.

## 2. Provider rule

- Production database platform: **Supabase PostgreSQL**.
- Tracked Production `prisma/schema.prisma` provider must remain `postgresql`.
- Do **not** switch the tracked Production schema provider to SQLite for routine local testing.
- Alternate test databases must use isolated fixtures/test configuration that cannot alter the committed Production schema.
- Database URLs, passwords, tokens, and connection strings are secrets and must never appear in docs/source.

## 3. Core data domains

The current schema may include models across these domains. Exact model/field names must be verified from current schema:

- product/category master data
- customers/users/employees
- buy bills/items
- sell bills/items
- sorting bills/items
- stock transfers/items
- stock lots
- stock movement / ledger evidence
- physical count / adjustment data
- credit/payment data
- bonus data
- audit logs
- idempotency records

Do not assume a model/field is present or absent from an old document.

## 4. Stock/cost invariants

Unless a newer Owner-approved business rule says otherwise:

- Stock changes must be traceable to a business transaction or explicit adjustment/reversal.
- Stock/cost/history mutations must avoid silent partial writes.
- FIFO behavior and deterministic ordering must follow current `BUSINESS_RULES.md`, current implementation, and tests.
- Cancellation/reversal must preserve auditability and must not guess historical cost.
- Downstream usage must be considered before destructive reversal of source/output lots.
- Duplicate/retry-sensitive writes require durable protection where the current design specifies it.
- Current stock/cost totals are Production facts and must not be inferred from schema/docs.

## 5. Data mutation safety

### Read-only first

For incidents, reconciliation, migration planning, or Production discrepancies:

1. inspect schema/code
2. gather read-only evidence
3. classify Verified / Inference / Unknown
4. define expected invariants
5. stop for Owner gate before Production mutation where required

### Prohibited without explicit approval

- direct Production SQL mutation
- stock/cost correction
- destructive migration
- Production seed/reset
- migration execution
- ad-hoc deletion of business/audit history

Use current application/API/service paths for normal business operations rather than manual SQL shortcuts.

## 6. Schema drift handling

Code schema and Production schema can differ temporarily. If behavior suggests drift:

1. prove the exact field/table/index mismatch
2. identify which code path selects/writes the missing structure
3. avoid broad queries that accidentally depend on unapplied fields when a bounded compatibility fix is approved
4. treat migration as a separate Owner-gated action
5. verify pre/post invariants if migration is approved

Historical examples (such as `weightExpression`) are evidence of the pattern, not proof of current Production schema state.

## 7. Transaction and partial-write rules

Critical mutation flows should have an explicit atomicity/compensation design appropriate to the current implementation.

For each stock-affecting flow, verification should answer:

- What is read before mutation?
- What rows are created/updated/deleted?
- What is the transaction boundary?
- What happens after an intermediate failure?
- Is retry safe?
- Is concurrent execution safe?
- What audit/ledger evidence is written?
- How is cost evidence preserved?

If any answer is unknown for a risky incident, stop before Production experimentation.

## 8. Idempotency

Where current code supports request-level/durable idempotency:

- verify the key/state model from current schema/code
- verify duplicate and concurrent request behavior from tests
- do not assume UI button-disable alone is durable idempotency
- ambiguous commit acknowledgement must not automatically trigger another business write

ST-62 introduced durable stock-transfer idempotency; inspect current implementation and schema for exact behavior before relying on it.

## 9. Audit/history

Business-critical changes should remain reconstructable through the current bill/history/ledger/audit mechanisms.

Do not:

- hard-delete history merely to make totals look right
- remove AuditLog/ledger evidence casually
- rewrite source history when an auditable reversal/adjustment is the approved model

Exact current audit structures must be verified from schema/code.

## 10. Migration checklist routing

For an approved migration, follow `process/SAFETY_CHECKLIST.md` rather than embedding one-off migration instructions here.

Required concerns include:

- exact head and migration identity
- backup/recovery readiness
- pre-mutation counts/invariants
- independent SQL/schema review
- post-migration verification
- rollback/recovery plan
- Production evidence and write-back

## 11. What does not belong here

Do not maintain:

- exact current row counts
- dated “model X missing field Y” snapshots
- current Production user/account records
- current issue priorities
- sandbox-local DB paths
- SQLite-switch instructions
- raw SQL credentials
- historical schema copies presented as current

Historical versions remain available in Git history.

## Key takeaway

**`prisma/schema.prisma` + migrations + current code/tests define the intended current data model; Production evidence defines live reality. This file defines durable data/stock safety context, not a stale schema snapshot.**