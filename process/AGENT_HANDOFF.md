# Agent Handoff — YH Stock System

> Current handoff for any AI agent taking over work on the YH Stock System.
> Historical instructions remain available in Git history and must not be treated as current policy.
> Last reconciled: 2026-08-07

## 1. Start here

Read in this order before acting:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. task-relevant canonical docs:
   - `process/BUSINESS_RULES.md`
   - `process/DATABASE_CONTEXT.md`
   - `process/DEFINITION_OF_DONE.md`
   - `process/SAFETY_CHECKLIST.md`
5. related `knowledge/` records
6. current GitHub issue / PR / code / tests
7. Notion `AI Read First — YH Stock System` and current Owner decisions when Owner/business context is relevant

Do not use this file as a substitute for current state evidence.

## 2. Source of truth

| Source | Responsibility |
|---|---|
| GitHub | Code, tests, CI, technical policy/docs, exact technical evidence |
| Linear | Task state, priority, blockers, acceptance criteria, next gate |
| Notion | Durable Owner/business context, decisions, SOP/business memory, concise cross-system summaries |
| Production | Live runtime evidence only |

When sources conflict, follow `process/GOVERNANCE.md`.

## 3. Core operating principles

- Correct stock, cost, ledger, history, and auditability over speed.
- Read-only investigation first for stock/data/Production-impacting work.
- Prove root cause before editing a defect.
- Keep scope bounded; unrelated root causes belong in separate issues/PRs.
- Distinguish `Verified`, `Inference`, `Unknown`, `Not verified`, `Superseded`, `Blocked`, and `Needs Owner Decision`.
- Never claim Production verification without Production evidence.

## 4. Git workflow

### Autonomous within a clear approved task scope

An AI agent may:

- fetch/reload current context
- create a bounded branch from exact current `main`
- push the initial branch checkpoint
- create focused commits
- fast-forward push focused checkpoints
- open/update a Draft PR
- create/comment on a GitHub issue when no duplicate exists
- inspect CI and fix failures caused by the in-scope change
- update affected technical documentation/knowledge

### Owner approval required

Stop before:

- marking a PR Ready
- merge
- deploy
- Production connection/query/write
- Production data correction
- credential validation or rotation
- database migration
- rollback affecting `main` or Production
- direct push to `main`
- force-push/history rewrite
- repository visibility/settings/branch-protection changes
- closing GitHub/Linear work when closure is Owner-gated
- expanding scope into an unrelated issue/root cause

Direct push to `main` is prohibited. Changes reach `main` only through an Owner-approved PR merge.

## 5. Checkpoint policy for sandbox-hosted AI work

Sandbox/local state is ephemeral. GitHub remote branches are the persistent technical source of truth.

Before editing:

1. `git fetch origin`
2. verify exact `origin/main` SHA
3. check for duplicate branch/PR
4. create a bounded branch from exact current `main`
5. push the initial branch checkpoint

After each meaningful checkpoint, run the relevant minimum validation before push:

- credential/secret scan when available
- `git diff --check`
- lint/typecheck for changed scope
- targeted tests for changed behavior
- staged-diff review for `.env`, secrets, database dumps, customer data, or other sensitive artifacts

Full validation is not required for every checkpoint, but must pass before requesting Ready.

Emergency WIP checkpoints are allowed only when sandbox-reset risk is concrete and the staged diff passes secret/sensitive-data checks plus `git diff --check`. WIP must remain Draft and must not be represented as complete.

## 6. Files and data that must never be pushed

- `.env` or real environment values
- passwords, tokens, API keys, connection strings
- GitHub/auth credential files
- `db/custom.db`
- Production database dumps
- raw customer/sensitive rows
- `node_modules/`
- `.next/`, `dist/`, build output
- large raw logs
- full chat transcripts
- repository ZIP/patch as the primary persistent artifact

`.env.example` is allowed only with unusable placeholders.

## 7. Prisma / database rule

The tracked Production Prisma schema must remain PostgreSQL.

- `prisma/schema.prisma` provider must remain `postgresql`.
- Do not switch the tracked Production schema provider to SQLite for routine local testing.
- Tests needing an alternate database must use isolated fixtures or test-specific configuration that cannot alter the committed Production schema.
- No Production migration or direct SQL mutation without explicit Owner approval.
- Never run destructive reset/seed operations against Production.

Historical guidance that instructed agents to temporarily edit the tracked Prisma provider to SQLite is superseded.

## 8. Defect workflow

For a bug/incident:

1. capture the reproducible symptom/evidence
2. inspect actual code/state without mutation where practical
3. separate verified facts from hypotheses/unknowns
4. prove root cause
5. create a bounded fix
6. add a regression test that fails before and passes after
7. run targeted validation
8. run full validation before Ready
9. perform fresh exact-head independent review
10. update affected canonical docs/knowledge
11. keep PR Draft until Owner gate

If a partial write, data mismatch, unexpected 2xx/5xx, or unclear contract appears, stop the risky path and report evidence.

## 9. Feature workflow

For new behavior:

- Owner confirms the business rule where required.
- Acceptance criteria and failure modes must be explicit.
- Auth/permission behavior must be defined and tested when relevant.
- Stock/cost/history effects must be documented and verified.
- Release/rollback impact must be documented.
- Full validation + exact-head CI + review are required before Ready.

## 10. Validation baseline

Use the commands applicable to the current repository state and scope. The normal full gate includes:

```bash
bun install --frozen-lockfile
bun run db:generate
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

Also run targeted tests and the credential scanner required by the changed scope.

Never report a check as PASS if it was not actually run.

## 11. End-of-task report

Every task handoff should state:

1. Goal
2. Result
3. Verified discoveries
4. Errors/root causes
5. Files/functions changed
6. Tests/CI actually run and results
7. Production verification status
8. Documentation/knowledge updates
9. Remaining risks/unknowns
10. Next safe gate

If work is unfinished but no new Owner decision, missing input, or Safety Gate is required, provide the next executable step. If an Owner decision/approval is required, stop at that gate.

## 12. Canonical checkpoint summary

This section replaces the older mixed push/no-push instructions that previously appeared in this handoff.

- Feature/policy branch creation: autonomous within clear scope
- Focused checkpoint commit/push: autonomous after minimum validation
- Draft PR: autonomous
- In-scope CI repair: autonomous
- Mark Ready: Owner-gated
- Merge: Owner-gated
- Deploy: Owner-gated
- Production access/query/write: Owner-gated
- Migration: Owner-gated
- Direct main push: prohibited
- Force-push/history rewrite: Owner-gated and normally prohibited

For conflict resolution and authority order, `process/GOVERNANCE.md` wins.

## Key takeaway

**Reload current truth, work on a bounded remote branch, prove and test changes, keep release/Production actions behind Owner gates, and never alter the tracked Production Prisma schema to SQLite.**
