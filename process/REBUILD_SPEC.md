# Rebuild Specification — YH Stock System

> Rebuild/reference contract, not a frozen copy of the July 2026 implementation.
> Last reconciled: 2026-08-07

## 1. Purpose

This document defines how to rebuild or restore YH Stock System capabilities **without treating an old feature/schema snapshot as current truth**.

Historical detailed route/schema tables are preserved in Git history. Before any rebuild, the agent must inspect the current repository and current Owner-approved rules.

## 2. Mandatory sources before rebuilding

Read and reconcile:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. `process/BUSINESS_RULES.md`
5. `process/DATABASE_CONTEXT.md`
6. `process/DEFINITION_OF_DONE.md`
7. `process/SAFETY_CHECKLIST.md`
8. `process/FEATURE_INVENTORY.md`
9. related `knowledge/` records
10. current issue/PR/code/tests
11. Notion current Owner decisions when business behavior is involved

Do not rebuild from this document alone.

## 3. Rebuild objective

A valid rebuild must preserve the Owner-approved business invariants and produce a system that is:

- auditable
- deterministic where business rules require it
- safe against partial stock/cost/history writes
- permission-aware
- testable
- recoverable
- deployable through the current PR/Owner-gated release workflow

Exact framework versions, route names, models, and UI structure should be taken from current canonical technical context unless the Owner explicitly approves a redesign.

## 4. Business domains that must be considered

Depending on approved scope:

- authentication/session/permissions
- product/category/customer/user/employee masters
- buy bills and stock creation
- sell bills and FIFO/cost deduction
- sorting/dismantling/transfer
- stock lots and inventory totals
- cancellation/reversal
- physical count/adjustment
- import/mapping/duplicate handling
- credit/receivable/payable
- bonus workflows
- history/audit trail
- dashboard/reporting

The current status of each domain must be freshly verified using `FEATURE_INVENTORY.md` methodology.

## 5. Non-negotiable rebuild invariants

Unless a newer explicit Owner decision supersedes them:

- stock/cost/ledger/history correctness over speed
- no silent partial write
- no ad-hoc Production data correction
- no direct main push
- no Production mutation/migration/deploy without Owner approval
- tracked Production Prisma provider remains `postgresql`
- secrets/credentials never enter source/docs
- business transactions are auditable; historical records are not casually hard-deleted
- unrelated root causes remain separate
- Production verification is distinct from code/CI verification

## 6. Required rebuild workflow

1. **Discover current state**
   - verify exact repository head
   - inspect existing implementation/tests
   - identify what actually needs rebuilding

2. **Confirm rules**
   - map the requested behavior to current Business Rules / Owner Decisions
   - mark ambiguity as `Needs Owner Decision`

3. **Define acceptance criteria and invariants**
   - happy path
   - failure modes
   - permissions
   - stock/cost/history effects
   - retry/idempotency where relevant

4. **Implement on a bounded branch**
   - reuse existing current components/patterns when safer than recreating
   - do not restore obsolete implementation merely because it existed historically

5. **Test**
   - regression/feature tests
   - failure-path tests
   - database/integration tests where needed
   - concurrency/idempotency tests for critical mutation flows when applicable

6. **Validate exact head**
   - targeted tests
   - full validation
   - credential scan
   - CI
   - independent exact-head review

7. **Release only through Owner gates**
   - Draft PR first
   - Owner approval for Ready/Merge/Deploy/Migration/Production verification as defined by governance

8. **Write back knowledge**
   - canonical docs only where current truth changed
   - Linear task state
   - Notion only durable Owner/business context

## 7. Data and migration rules

- Current database shape must be read from `prisma/schema.prisma`, `DATABASE_CONTEXT.md`, approved migrations, and Production evidence when authorized.
- Historical schema examples are not authoritative.
- Migration plans must include verification and recovery/rollback strategy.
- Do not run destructive reset/seed operations against Production.
- Do not switch the tracked Production Prisma schema to SQLite for routine local testing.

## 8. Rebuild evidence package

A rebuild task must report:

1. scope/objective
2. current-state evidence used
3. business rules/Owner decisions applied
4. files/functions changed
5. schema/migration impact
6. tests/CI actually run
7. independent review result
8. Production verification status
9. remaining risks/unknowns
10. next safe gate

## 9. Historical compatibility

If an old implementation/spec conflicts with current code, current canonical docs, or an Owner decision:

- do not blindly reproduce the historical behavior;
- identify the conflict;
- follow `process/GOVERNANCE.md`;
- preserve useful history in Git rather than keeping obsolete behavior in the current rebuild contract.

## Key takeaway

**Rebuild from current verified rules and evidence, not from a frozen historical copy of the system.**