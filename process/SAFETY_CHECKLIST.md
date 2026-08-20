# Production Safety Checklist — YH Stock System

> Explicit gates for pre-PR, pre-Ready, pre-merge, deploy, Production read-only verification, Production write verification, migration, and rollback.
> Historical direct-main-push, direct-migration-execution, and mutating smoke-test instructions remain in Git history only and must not be treated as current policy.
> Last reconciled: 2026-08-20 (ST-76 Governance Reconciliation v2)

## 1. Authority and scope

Read first:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. task-specific issue / PR and affected domain docs (`BUSINESS_RULES.md`, `DATABASE_CONTEXT.md`, `DEPLOYMENT_RUNBOOK.md`, `REPAIR_RUNBOOK.md`)

This checklist defines **gates**, not authorizations. It never grants approval by itself. Every gate marked Owner-gated requires an explicit Owner approval message for the specific task / action.

The following always require explicit Owner approval:

- Production connection / query / write
- Production data correction
- database migration
- marking PR Ready
- merge
- deploy
- rollback affecting `main` or Production
- credential validation / rotation
- direct main push
- force-push / history rewrite
- repository visibility / settings / branch-protection changes

## A. Universal pre-PR / pre-Ready safety

Applies to every change before the PR is marked Ready.

- [ ] exact scope matches the issue / Owner intent
- [ ] exact PR head SHA is recorded
- [ ] `git diff origin/main..HEAD` re-read; every changed file is in-scope
- [ ] changed files are docs / policy / code only — no `.env`, `db/custom.db`, Production dumps, secrets, credentials, `node_modules/`, build output
- [ ] credential scan required by repository policy passes (ST-27)
- [ ] `git diff --check` passes
- [ ] tracked `prisma/schema.prisma` provider remains `postgresql` (if schema touched)
- [ ] targeted tests for changed behavior pass
- [ ] full validation passes:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

- [ ] exact-head CI passes (Foundation, Lint, TypeScript Typecheck, Unit Tests, Production Build, ST-27 Credential Scan)
- [ ] fresh exact-head independent review is complete; no unresolved P0/P1 finding remains
- [ ] release / rollback / verification plan is documented where applicable

PR remains Draft until Owner approval.

## B. Pre-merge

- [ ] Owner merge approval received for this exact PR
- [ ] exact-head identity confirmed (the SHA Owner approved is the SHA being merged)
- [ ] required CI on exact head is green
- [ ] independent review complete; blocker / high findings resolved or explicitly Owner-gated
- [ ] no concurrent force-push / history rewrite on the branch
- [ ] no direct push to `main` — merge through the PR workflow only

## C. Deploy

Deploy is Owner-gated. Deploy approval is separate from merge approval.

- [ ] explicit Owner deploy approval received for this task
- [ ] merge identity (commit SHA on `main`) is known and recorded
- [ ] expected deployment target is known
- [ ] no schema assumption — if schema changed, migration ordering is explicitly approved and completed first
- [ ] rollback plan is ready
- [ ] Production verification plan is ready and approved where mutation is involved

After deploy:

- [ ] confirm deployment identity / status
- [ ] run only the approved Production verification
- [ ] stop on unexpected response / state
- [ ] record verified / not-verified status accurately

## D. Production read-only verification

Production read-only verification is Owner-gated. It does not authorize any mutation.

- [ ] explicit Owner Production-read approval received for this task
- [ ] non-mutating checks only — no business transaction created, edited, cancelled, transferred, sorted, imported, or adjusted
- [ ] no test bills, no test stock movements, no test credit entries, no test bonus records
- [ ] no AuditLog / StockLot SQL mutation
- [ ] no cleanup of synthetic Production bills (none should exist)
- [ ] do not create “ลองสร้าง bill จริง 1 รายการ” as a default action
- [ ] record evidence: deployment identity, HTTP status, read-only query result, page / runtime health
- [ ] stop on unexpected response / state

Examples of read-only verification:

- deployment identity / version
- login page render
- `401 AUTH_REQUIRED` for no / invalid token
- `403 PERMISSION_DENIED` for valid token lacking permission
- read-only history / stock page render
- read-only API GET behavior

## E. Production write verification

Production write verification requires **separate explicit Owner approval**. Read-only approval (D) does **not** imply write approval.

- [ ] explicit Owner Production-write approval received for this exact verification (task-specific)
- [ ] exact test inputs defined first (which bills, which products, which weights)
- [ ] expected stock / cost / history effects written down before execution
- [ ] cleanup / compensation plan defined first and approved
- [ ] one controlled execution only unless separately approved
- [ ] stop on unexpected response / state
- [ ] verify resulting ledger / history / audit evidence
- [ ] do not hard-delete cleanup data — use approved cancellation / reversal flows

Default mutating smoke tests (Buy / Sell / Sorting bill creation, cancel tests, Excel import against Production) are **not** authorized by this checklist. Each requires task-specific Owner approval.

## F. Migration

Migration is Owner-gated. Migration approval is separate from Ready / merge / deploy approval.

- [ ] explicit Owner migration approval received for this task
- [ ] exact PR / head SHA recorded
- [ ] migration purpose and affected tables / columns / indexes documented
- [ ] migration SQL independently reviewed
- [ ] backup / recovery capability verified before mutation
- [ ] pre-migration counts / invariants captured read-only
- [ ] `prisma/schema.prisma` provider remains `postgresql`
- [ ] no `.env`, secrets, credentials, database dumps in the diff
- [ ] required CI / validation on the exact head passes
- [ ] rollback / recovery plan documented and approved

### Migration design expectations

Prefer safe, bounded, backward-compatible changes. Any destructive or non-additive operation requires explicit risk review and Owner approval specific to that operation.

Never:

- run `prisma migrate reset` against Production
- run `prisma db push --force-reset` against Production
- seed Production as a shortcut
- change Production stock / cost / history through ad-hoc SQL
- infer that a migration succeeded without verification evidence

### During migration

- [ ] confirm the approved environment and exact migration before execution
- [ ] execute only the approved migration
- [ ] stop on any unexpected error, row-count change, lock / problem, or schema mismatch
- [ ] do not improvise a second mutation to “fix” an unexpected state
- [ ] preserve error / evidence without copying credentials or sensitive Production data into docs / chat

If the result is partial, ambiguous, or inconsistent, classify it as a Production incident and stop for Owner decision.

### After migration

- [ ] verify expected schema changes read-only
- [ ] compare pre / post counts and task-specific invariants
- [ ] verify backward compatibility where applicable
- [ ] confirm no unintended stock / cost / history mutation
- [ ] record exact evidence in the task / PR
- [ ] update affected canonical documentation

## G. Stop conditions (Red flags)

Stop and escalate on any of:

- partial write
- stock / cost / history mismatch
- unexpected 2xx / 4xx / 5xx relative to contract
- authentication / authorization behavior that differs from expectation
- schema mismatch or missing column
- duplicate mutation / retry ambiguity
- failed rollback / compensation
- unknown Production deployment identity
- audit evidence missing where required
- need to expand scope to another root cause
- any instruction to direct-push `main`, force-push, rewrite history, run destructive SQL, or perform a Production mutation without explicit Owner approval

Do not continue experimenting in Production after a red flag. Do not retry mutating Production operations to investigate incidents.

## H. Rollback

Rollback must be pre-planned and Owner-approved when it affects `main`, deployment, database, or Production state.

### Code rollback

- Prefer a reviewed revert through the repository / PR workflow.
- Do not force-push or rewrite history.
- Do not directly push a revert to `main`.

### Database rollback / recovery

- Use only the task-specific approved rollback or backup / recovery plan.
- Never improvise destructive SQL (`DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, `DELETE FROM`).
- Do not normalize destructive rollback SQL as an automatic response to incidents.
- Verify schema / data invariants after recovery.

If safe rollback is uncertain, stop and request Owner decision rather than guessing.

## I. Sandbox checkpoint safety

For sandbox-hosted AI work, follow `process/AGENT_HANDOFF.md` §12 (canonical Push-Early Checkpoint Policy) and `process/GOVERNANCE.md`:

- branch + focused checkpoint pushes are autonomous within clear scope
- Draft PR remains the working integration surface
- GitHub remote branch is persistent technical state
- merge / deploy / Production remain Owner-gated

Never push:

- `.env` or real secret values
- credentials / tokens / connection strings
- `db/custom.db`
- Production database dumps
- raw customer / sensitive rows
- build output or dependency directories
- large raw logs / full chat transcripts

## J. Prisma provider rule

The tracked Production schema must remain PostgreSQL.

- [ ] `prisma/schema.prisma` provider = `postgresql`
- [ ] Local / test work does not edit the tracked Production provider to SQLite
- [ ] Alternate test databases use isolated test configuration / fixtures
- [ ] Any schema change is reconciled with the approved migration and docs

Historical instructions to temporarily switch the tracked provider to SQLite are superseded.

## K. Completion evidence

A release / Production task is not complete until its applicable evidence is recorded:

- exact head / merge identity
- CI / validation results actually run (not checks claimed without running)
- migration status (if applicable)
- deploy status (if applicable)
- Production verification status: verified / not verified / not applicable
- remaining risks / unknowns
- observation requirement / status
- next safe gate
- source-specific write-back only where canonical state changed (GitHub technical evidence, Linear task state / gate, Notion durable Owner / business context)

## Key takeaway

**No direct main push. No implicit Production permission. No ad-hoc Production mutation. No mutating smoke test by default. No destructive rollback SQL as an automatic response. No tracked Prisma-provider switch to SQLite. Every risky step is evidence-driven and Owner-gated, with separate approval for Ready / merge / deploy / Production-read / Production-write / migration / rollback.**
