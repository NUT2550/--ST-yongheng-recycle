# Deployment Runbook — YH Stock System

> Current release/deployment handoff. Historical direct-main-push instructions remain in Git history only.
> Last reconciled: 2026-08-07

## 1. Authority

Read before release work:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. `process/SAFETY_CHECKLIST.md`
5. current task issue/PR and exact-head CI

This runbook does not authorize merge, deploy, Production access, migration, or rollback.

## 2. Release flow

Current flow:

```text
bounded branch
→ Draft PR
→ targeted/full validation
→ exact-head CI
→ independent review
→ Owner approval
→ PR merge to main
→ approved deploy path
→ Production verification
→ observation/write-back when applicable
```

Direct push to `main` is prohibited.

## 3. Before requesting Ready

- [ ] Scope matches the issue/Owner intent.
- [ ] Root cause/business rule is proven/confirmed as applicable.
- [ ] Regression/feature tests exist for required behavior.
- [ ] Targeted tests pass.
- [ ] Full validation passes:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

- [ ] Credential scan required by repo policy passes.
- [ ] `git diff --check` passes.
- [ ] Exact-head CI passes.
- [ ] Fresh independent review is complete.
- [ ] Release/rollback/Production verification plan is documented.
- [ ] No unresolved P0/P1 finding remains.

PR remains Draft until Owner approval.

## 4. Schema/database release work

The tracked Production Prisma schema remains PostgreSQL.

- Do not switch tracked `prisma/schema.prisma` to SQLite.
- Migration requires explicit Owner approval.
- Production query/write requires explicit Owner approval.
- Follow `process/SAFETY_CHECKLIST.md` for migration and runtime gates.
- Do not use `prisma migrate reset` or seed Production.

## 5. Merge

Merge is Owner-gated.

- Use the approved PR workflow.
- Confirm exact PR head before merge.
- Do not bypass branch protection.
- Do not force-push/history-rewrite.
- Do not use `git push origin main` as a release step.

## 6. Deploy

Deploy is Owner-gated.

Before deploy:

- [ ] merge identity is known
- [ ] expected deployment target is known
- [ ] migration ordering (if any) is explicitly approved
- [ ] rollback plan is ready
- [ ] Production verification plan is ready

After deploy:

- [ ] confirm deployment identity/status
- [ ] run approved Production verification
- [ ] stop on unexpected response/state
- [ ] record verified/not-verified status accurately

## 7. Production verification

Prefer non-mutating verification.

Any test that creates, edits, cancels, transfers, sorts, adjusts, or otherwise mutates Production data requires explicit Owner approval for that exact verification.

Never create test bills or stock movements in Production by default.

## 8. Rollback

Rollback affecting `main`, deployment, database, or Production is Owner-gated.

- Prefer reviewed revert through the PR/repository workflow.
- Do not directly push a revert to `main`.
- Do not rewrite history.
- Database recovery must use the approved task-specific recovery plan.
- If rollback safety is unclear, stop for Owner decision.

## 9. Evidence/write-back

Record as applicable:

- exact PR/head/merge identity
- validation and CI actually run
- migration status
- deploy status
- Production verification status
- remaining risks
- observation status
- next safe gate

Write back only to the source systems whose canonical state changed: GitHub for technical evidence/policy, Linear for task state or gate, and Notion for durable Owner/business context.

## Key takeaway

**Release happens through validated PR + Owner approval, never by direct main push; Production and migration remain explicit Owner gates.**
