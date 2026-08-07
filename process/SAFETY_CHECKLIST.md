# Production Safety Checklist — YH Stock System

> Current checklist for migration, release, deploy, Production verification, and rollback.
> Historical direct-main-push and ad-hoc Production instructions remain in Git history only.
> Last reconciled: 2026-08-07

## 1. Authority and gates

Read first:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. task-specific issue/PR and affected domain docs

The following require explicit Owner approval:

- Production connection/query/write
- Production data correction
- database migration
- marking PR Ready
- merge
- deploy
- rollback affecting `main` or Production
- credential validation/rotation
- direct main push
- force-push/history rewrite

This checklist never grants approval by itself.

## 2. Before any migration

- [ ] Owner explicitly approved the migration for this task.
- [ ] Exact PR/head SHA is recorded.
- [ ] Migration purpose and affected tables/columns are documented.
- [ ] Migration SQL has been independently reviewed.
- [ ] Rollback/recovery plan is documented.
- [ ] Backup/recovery capability is verified before mutation.
- [ ] Relevant pre-migration counts/invariants are captured read-only.
- [ ] `prisma/schema.prisma` provider is `postgresql`.
- [ ] No `.env`, secrets, credentials, database dumps, or customer data are present in the diff.
- [ ] Required CI/validation on the exact head passes.

### Migration design expectations

Prefer safe, bounded, backward-compatible changes. Any destructive or non-additive operation requires explicit risk review and Owner approval specific to that operation.

Never:

- run `prisma migrate reset` against Production
- seed Production as a shortcut
- change Production stock/cost/history through ad-hoc SQL
- infer that a migration succeeded without verification evidence

## 3. During migration

- [ ] Confirm the approved environment and exact migration before execution.
- [ ] Execute only the approved migration.
- [ ] Stop on any unexpected error, row-count change, lock/problem, or schema mismatch.
- [ ] Do not improvise a second mutation to “fix” an unexpected state.
- [ ] Preserve error/evidence without copying credentials or sensitive Production data into docs/chat.

If the result is partial, ambiguous, or inconsistent, classify it as a Production incident and stop for Owner decision.

## 4. After migration

- [ ] Verify expected schema changes read-only.
- [ ] Compare pre/post counts and task-specific invariants.
- [ ] Verify backward compatibility where applicable.
- [ ] Confirm no unintended stock/cost/history mutation.
- [ ] Record exact evidence in the task/PR.
- [ ] Update affected canonical documentation.

Do not proceed to release merely because SQL returned success.

## 5. Before requesting PR Ready

- [ ] Root cause/business requirement is documented.
- [ ] Scope is bounded to the issue.
- [ ] Regression/feature tests cover required behavior and failure modes.
- [ ] Targeted tests pass.
- [ ] Full validation passes:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

- [ ] Credential scanner required by repository policy passes.
- [ ] `git diff --check` passes.
- [ ] Exact-head CI passes.
- [ ] Fresh exact-head independent review is complete.
- [ ] No unresolved P0/P1 finding remains.
- [ ] Release and rollback impact is documented.
- [ ] Production verification plan is explicit for critical workflows.

PR stays Draft until the Owner approves Ready.

## 6. Merge and deploy workflow

Direct push to `main` is prohibited.

Current flow:

1. validated feature/policy branch
2. Draft PR
3. exact-head CI + independent review
4. Owner approval to mark Ready / merge
5. Owner-approved PR merge into `main`
6. deploy only under the approved release path
7. Production verification
8. observation period when required
9. task/knowledge write-back

Never use `git push origin main` as a normal release step.

## 7. Production smoke/verification rules

Production verification must be task-specific and minimize mutation.

### Read-only checks are preferred

Examples:

- deployment identity/version
- login/auth behavior using approved test path
- endpoint status/error contract
- page/runtime health
- read-only history/query verification

### Mutating smoke tests

Any test that creates, edits, cancels, transfers, sorts, adjusts, or otherwise changes Production data requires explicit Owner approval for that test.

Do not create “test bills” or Production stock movements by default.

For approved mutating verification:

- [ ] exact test inputs and cleanup/compensation plan are defined first
- [ ] expected stock/cost/history effects are written down
- [ ] one controlled execution only unless separately approved
- [ ] stop on unexpected response/state
- [ ] verify resulting ledger/history/audit evidence
- [ ] do not hard-delete cleanup data

## 8. Red flags — stop immediately

Stop and escalate on:

- partial write
- stock/cost/history mismatch
- unexpected 2xx/4xx/5xx relative to contract
- authentication/authorization behavior that differs from expectation
- schema mismatch or missing column
- duplicate mutation/retry
- failed rollback/compensation
- unknown Production deployment identity
- audit evidence missing where required
- any need to expand scope to another root cause

Do not continue experimenting in Production after a red flag.

## 9. Rollback

Rollback must be pre-planned and Owner-approved when it affects `main`, deployment, database, or Production state.

### Code rollback

- Prefer a reviewed revert through the repository/PR workflow.
- Do not force-push or rewrite history.
- Do not directly push a revert to `main`.

### Database rollback/recovery

- Use only the task-specific approved rollback or backup/recovery plan.
- Never improvise destructive SQL.
- Verify schema/data invariants after recovery.

If safe rollback is uncertain, stop and request Owner decision rather than guessing.

## 10. Sandbox checkpoint safety

For sandbox-hosted AI work, follow `process/AGENT_HANDOFF.md` §12 and `process/GOVERNANCE.md`:

- branch + focused checkpoint pushes are autonomous within clear scope
- Draft PR remains the working integration surface
- GitHub remote branch is persistent technical state
- merge/deploy/Production remain Owner-gated

Never push:

- `.env` or real secret values
- credentials/tokens/connection strings
- `db/custom.db`
- Production dumps or raw sensitive rows
- build output or dependency directories
- large raw logs/full chat transcripts

## 11. Prisma provider rule

The tracked Production schema must remain PostgreSQL.

- [ ] `prisma/schema.prisma` provider = `postgresql`
- [ ] Local/test work does not edit the tracked Production provider to SQLite.
- [ ] Alternate test databases use isolated test configuration/fixtures.
- [ ] Any schema change is reconciled with the approved migration and docs.

Historical instructions to temporarily switch the tracked provider to SQLite are superseded.

## 12. Completion evidence

A release/Production task is not complete until its applicable evidence is recorded:

- exact head/merge identity
- CI/validation results actually run
- migration status (if applicable)
- deploy status (if applicable)
- Production verification status: verified / not verified / not applicable
- remaining risks/unknowns
- observation requirement/status
- next safe gate
- GitHub/Linear/Notion write-back where applicable

## Key takeaway

**No direct main push, no implicit Production permission, no ad-hoc Production mutation, and no tracked Prisma-provider switch to SQLite. Every risky step is evidence-driven and Owner-gated.**
