# Repair Runbook — YH Stock System

> Current defect/incident workflow. Historical one-off commands and stale local-path assumptions remain in Git history only.
> Last reconciled: 2026-08-07

## 1. Read before repair

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. current Linear/GitHub issue and related PRs
5. task-relevant `BUSINESS_RULES.md`, `DATABASE_CONTEXT.md`, `SAFETY_CHECKLIST.md`
6. related `knowledge/` incidents/invariants/decisions
7. actual code/tests for the affected path
8. Notion Owner/business decisions when relevant

Do not rely on old local paths, worklogs, screenshots, or historical baselines as current truth without re-verification.

## 2. Investigation first

For a defect or Production incident:

1. capture the exact symptom/evidence
2. identify environment/version/request context if available
3. inspect current code/state read-only first
4. separate:
   - Verified
   - Inference
   - Unknown
   - Not verified
5. prove the root cause before editing
6. identify whether there is one root cause or multiple unrelated issues

If multiple unrelated root causes exist, split them into separate issues/PRs.

## 3. Production safety

Production connection/query/write, migration, deploy, rollback, and data correction require explicit Owner approval.

If investigation finds:

- partial write
- stock/cost/history mismatch
- duplicate mutation
- unexpected 2xx/4xx/5xx relative to contract
- unclear data state
- unknown deployment identity

stop the risky path and report evidence. Do not keep retrying Production operations.

## 4. Bounded fix workflow

After root cause is proven:

1. create/use a bounded branch from exact current `main`
2. create a regression test that fails before the fix and passes after
3. implement the smallest root-cause fix
4. run targeted tests
5. inspect side effects against business/data invariants
6. update affected canonical docs/knowledge
7. push focused checkpoint(s) to the branch
8. keep the PR Draft

Do not expand scope to unrelated issues without Owner approval.

## 5. Validation

Before requesting Ready:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

Also run:

- task-specific targeted tests
- credential scan required by repo policy
- `git diff --check`
- exact-head CI
- fresh exact-head independent review

Never report a check as passed if it was not actually run.

## 6. Authentication/permission defects

Verify separately:

- unauthenticated behavior
- invalid/expired session behavior
- authenticated but unauthorized behavior
- authorized success behavior
- UI gating versus API enforcement
- no mutation before auth/permission rejection

Do not assume 401 and 403 share the same root cause.

## 7. Stock/cost/history defects

Priorities:

1. preserve data integrity
2. prove current state read-only
3. identify source document / stock movement / lot relationships
4. verify atomicity, idempotency, rollback/compensation behavior
5. test concurrent/retry behavior when relevant
6. do not repair historical Production data without a separate approved remediation plan

Correctness over speed.

## 8. Import/batch defects

Verify:

- duplicate-submit/retry behavior
- atomicity versus partial success
- idempotency
- auth loss during batch
- clear progress/error state
- no silent duplicate/partial import
- performance separately from correctness

Do not retry a failed Production import on behalf of Owner without approval.

## 9. Schema/database defects

- tracked `prisma/schema.prisma` stays PostgreSQL
- do not switch the tracked provider to SQLite
- no Production migration/direct SQL mutation without Owner approval
- schema drift must be proven before changing code or database
- use isolated test configuration/fixtures for alternate local databases

## 10. Completion contract

A repair is not Done merely because code compiles or CI passes.

Use `process/DEFINITION_OF_DONE.md`. At minimum, applicable work requires:

- symptom evidence
- proven root cause
- bounded fix
- regression test
- targeted/full validation
- exact-head CI
- independent review
- current documentation
- accurate Production verification status
- write-back
- observation period when stock integrity requires it

## 11. End-of-task report

Report:

1. Goal
2. Result
3. Verified discoveries
4. Root cause / errors
5. Files/functions changed
6. Tests/CI actually run
7. Production verification status
8. Documentation/knowledge updates
9. Remaining risks/unknowns
10. Next safe gate

If no new input/Owner decision/Safety Gate is required and work remains, provide the next executable step. Otherwise stop at the Owner gate.

## Key takeaway

**Investigate current evidence first, prove root cause, make a bounded tested fix, and never use stale local assumptions or Production experimentation as a shortcut.**
