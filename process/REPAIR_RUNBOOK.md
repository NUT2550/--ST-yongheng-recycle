# Repair Runbook — YH Stock System

> Current evidence-first defect / incident workflow. Historical one-off commands, stale local-path assumptions, and direct Production mutation examples remain in Git history only and must not be treated as current policy.
> Last reconciled: 2026-08-20 (ST-76 Governance Reconciliation v2)

## 1. Read before repair

Read in this order before any repair work:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. current Linear / GitHub issue and related PRs
5. task-relevant `BUSINESS_RULES.md`, `DATABASE_CONTEXT.md`, `SAFETY_CHECKLIST.md`
6. related `knowledge/` incidents / invariants / decisions
7. actual code / tests for the affected path on the exact branch / head
8. Notion Owner / business decisions when relevant

Do **not** rely on old local paths, worklogs, screenshots, or historical baselines as current truth without re-verification. The historical reference to `/home/z/my-project` is superseded — determine the actual working directory from the current clone / sandbox state.

## 2. Investigation first

For any defect or Production incident:

1. capture the exact symptom / evidence (HTTP response, error message, reproducible step, log excerpt without secrets)
2. identify environment / version / request context if available
3. inspect current code / state read-only first
4. classify every observation as one of:
   - `Verified`
   - `Inference`
   - `Unknown`
   - `Not verified`
5. prove the root cause before editing
6. identify whether there is one root cause or multiple unrelated issues

If multiple unrelated root causes exist, split them into separate issues / PRs. Do not bundle unrelated fixes.

## 3. Production safety

Production connection, query, write, migration, deploy, rollback, and data correction require **explicit Owner approval**. They are not executable by default.

If investigation finds any of the following, **stop the risky path and report evidence** — do not keep retrying Production operations to investigate:

- partial write
- stock / cost / history mismatch
- duplicate mutation
- unexpected 2xx / 4xx / 5xx relative to contract
- unclear data state
- unknown deployment identity

Do not retry a mutating Production operation to “see what happens”. Retrying a mutating operation to investigate an incident is prohibited.

## 4. Bounded fix workflow

After root cause is proven:

1. create / use a bounded branch from exact current `main`
2. create a regression test that fails before the fix and passes after (or document an equivalent evidence exception when a traditional test is not technically possible)
3. implement the smallest root-cause fix
4. run targeted tests for the changed behavior
5. inspect side effects against business / data invariants
6. update affected canonical docs / knowledge
7. push focused checkpoint(s) to the branch (Push-Early policy applies — see `process/AGENT_HANDOFF.md` §12)
8. keep the PR Draft until Owner approval
9. wait for exact-head CI before declaring any check green

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
- credential scan required by repository policy (ST-27)
- `git diff --check`
- exact-head CI
- fresh exact-head independent review

Never report a check as PASS if it was not actually run. State the exact reason when an environment prevents a check.

## 6. Authentication / permission defects

Verify each behavior separately:

- unauthenticated behavior (no token / invalid token / expired token)
- authenticated but unauthorized behavior (valid token, insufficient permission)
- authorized success behavior
- UI gating versus API enforcement
- no mutation before auth / permission rejection

Do not assume 401 and 403 share the same root cause. The current contract is `401 AUTH_REQUIRED` for missing / invalid / expired token and `403 PERMISSION_DENIED` for valid token lacking permission.

## 7. Stock / cost / history defects

Priorities:

1. preserve data integrity — stop the risky path on partial write or mismatch
2. prove current state read-only before any fix
3. identify source document / stock movement / lot relationships
4. verify atomicity, idempotency, rollback / compensation behavior
5. test concurrent / retry behavior when relevant
6. do not repair historical Production data without a separate approved remediation plan

Correctness over speed. Use the current application / API / service flow (e.g. `DELETE /api/{buy,sell,sorting}-bills/{id}` for cancellation) rather than ad-hoc Production SQL for normal operations.

## 8. Import / batch defects

Verify:

- duplicate-submit / retry behavior
- atomicity versus partial success
- idempotency
- auth loss during batch (401 containment, 403 containment, 429/5xx transient handling)
- clear progress / error state
- no silent duplicate / partial import
- performance separately from correctness

Do not retry a failed Production import on behalf of the Owner without approval. Ambiguous commit acknowledgement must not automatically trigger another business write.

## 9. Schema / database defects

- tracked `prisma/schema.prisma` stays PostgreSQL
- do not switch the tracked provider to SQLite for routine local testing
- no Production migration / direct SQL mutation without explicit Owner approval
- schema drift must be proven (exact field / table / index mismatch) before changing code or database
- use isolated test configuration / fixtures for alternate local databases
- never `prisma migrate reset` or seed against Production

## 10. Durable troubleshooting principles

These principles are durable across implementation changes:

- read-only investigation first
- separate Verified / Inference / Unknown / Not verified
- prove root cause before editing
- smallest root-cause fix
- regression test before / after
- targeted + full validation
- exact-head CI + independent review
- stop on partial write, data mismatch, unexpected response, or unclear contract
- distinguish 401 vs 403 vs 429/5xx behavior
- FIFO cost is derived from authoritative lot evidence, not guessed from current price
- cancellation must be atomic / fail-closed; do not guess historical cost
- stock changes must be traceable to a business transaction or approved adjustment

Specific route / function / model names must be verified from current code / tests on the exact branch / head.

## 11. Completion contract

A repair is not Done merely because code compiles or CI passes.

Use `process/DEFINITION_OF_DONE.md`. At minimum, applicable work requires:

- symptom evidence
- proven root cause
- bounded fix
- regression test (or documented equivalent evidence exception)
- targeted + full validation
- exact-head CI
- fresh exact-head independent review
- current documentation
- accurate Production verification status
- write-back only to sources whose canonical state changed
- observation period when stock integrity requires it

## 12. End-of-task report

Report:

1. Goal
2. Result
3. Verified discoveries
4. Root cause / errors
5. Files / functions changed
6. Tests / CI actually run (with results)
7. Production verification status
8. Documentation / knowledge updates
9. Remaining risks / unknowns
10. Next safe gate

If no new input / Owner decision / Safety Gate is required and work remains, provide the next executable step. Otherwise stop at the Owner gate.

## 13. Absolute prohibitions

- ❌ Direct Production database query / write as a default investigation step
- ❌ Direct `UPDATE "User"`, `UPDATE "StockLot"`, or any business-table mutation in Production
- ❌ Mutating Production API POST / PUT / PATCH / DELETE as a default smoke test
- ❌ Credential / environment variable mutation without Owner approval
- ❌ “Fix it directly” style instructions that bypass evidence-first escalation
- ❌ Stale absolute workspace path assumptions
- ❌ Direct SQL repair shortcut for normal business operations
- ❌ Retrying mutating Production operations to investigate incidents
- ❌ `prisma migrate reset` / seed against Production
- ❌ Switching tracked `prisma/schema.prisma` provider to SQLite and committing
- ❌ Mark Ready / merge / deploy / migration / rollback without explicit Owner approval

## Key takeaway

**Investigate current evidence first, prove root cause, make a bounded tested fix on a bounded branch, and never use stale local assumptions or Production experimentation as a shortcut. Production connection, query, write, migration, deploy, rollback, and credential changes all require explicit Owner approval.**
