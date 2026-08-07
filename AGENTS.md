# AGENTS.md — YH Stock System AI Entry Point

> **Read this file first. It is the mandatory entry point for all AI agents.**
> This file supersedes `CLAUDE.md` as the canonical AI entry point.
> `CLAUDE.md` is retained for backward compatibility but defers to this file.

## Project Identity

- **Name**: ยงเฮง มหาชัย รีไซเคิล (Yongheng Mahachai Recycle)
- **Purpose**: Stock management system for a scrap metal recycling shop
- **Tech**: Next.js 16 + TypeScript 5 + Prisma 6 + Supabase PostgreSQL + Vercel
- **Production**: https://st-yongheng-recycle.vercel.app
- **GitHub**: https://github.com/NUT2550/--ST-yongheng-recycle

## Governance and Conflict Resolution

- **`process/GOVERNANCE.md` is the canonical conflict-resolution and policy-precedence document.**
- If an older handoff, runbook, template, worklog, or Notion page conflicts with `AGENTS.md` or `process/GOVERNANCE.md`, follow the higher-authority current policy and treat the older statement as superseded.
- Current explicit Owner decisions still control task-specific business/risk gates.
- Do not resolve conflicting instructions by timestamp alone or by guessing.

## Required Reading Order

1. **`AGENTS.md`** (this file) — entry point, safety rules, working method
2. **`process/GOVERNANCE.md`** — authority hierarchy, conflict resolution, current Git/approval policy
3. **`process/CURRENT_STATE.md`** — current main SHA, active work, verified/unverified behavior
4. **`process/PROJECT_OPERATING_CONTEXT.md`** — durable project identity and routing context
5. **`process/BUSINESS_RULES.md`** — Owner-approved business behavior
6. **`process/DATABASE_CONTEXT.md`** — durable data/stock-flow constraints and schema-routing rules
7. **`knowledge/`** — durable technical knowledge (incidents, invariants, decisions)
8. Task-specific code, tests, issues, PRs, and docs
9. Notion `AI Read First — YH Stock System` / current Owner decisions when Owner/business context is relevant

## Source-of-Truth Responsibilities

| Source | Role | What it stores |
|---|---|---|
| **GitHub** | Code, tests, CI, technical evidence, durable technical memory | Repository files, PRs, issues, workflow runs |
| **Linear** | Task state, priority, current gate | ST-XX issue status, blockers, acceptance criteria, concise task decisions |
| **Notion** | Durable Owner/business context | Owner decisions, business/operational memory, SOPs, cross-system routing summaries |
| **Production** | Runtime evidence only — never inferred from code alone | Live behavior, deployment identity, HTTP/data evidence |

Do not copy every task update into every system. Write back only where canonical state changed.

## Safety Rules

1. **Correctness of stock, cost, ledger, and history over speed** — never rush a mutation
2. **Read-only first** — inspect before mutating
3. **No Production mutation without explicit Owner approval** — including cancel, sell, stock adjustment
4. **No direct SQL mutation** unless separately approved — use current application/API/service paths for normal operations
5. **No migration, merge, deploy, rollback, or permission changes** without explicit Owner approval
6. **Stop on partial write, data mismatch, unexpected 2xx/5xx, or unclear contract**
7. **Separate unrelated root causes** into separate issues/PRs
8. **Never commit `.env`, `db/custom.db`, tokens, passwords, or Production dumps**
9. **Git email must be** `207142776+NUT2550@users.noreply.github.com`
10. **Prisma provider must remain** `postgresql` in the tracked Production schema

## Required Working Method

1. **Reload exact current state** — fetch latest, verify HEAD SHA, read `CURRENT_STATE.md`
2. **Prove root cause before editing** — read actual code/evidence, do not guess
3. **Create bounded branch** from current `main`
4. **Add regression/acceptance evidence** appropriate to the change
5. **Run targeted and full validation** — applicable lint, tsc, tests, build, foundation/security checks
6. **Perform exact-head independent review** — re-open actual files, challenge every requirement
7. **Update canonical documentation** — only affected docs, current-truth replacement
8. **Write back by source responsibility** — GitHub for technical change/evidence; Linear for task state/gate; Notion only for durable Owner/business context that actually changed
9. **Distinguish code verification from Production verification** — never claim Production-verified without evidence

## Test Commands

```bash
bun install --frozen-lockfile     # Install dependencies
bun run db:generate               # Generate Prisma client
bun run lint                      # ESLint
npx tsc --noEmit                  # TypeScript typecheck
bun test                          # Full test suite
bun run build                     # Production build (use non-Production placeholders)
bash scripts/validate-foundation.sh  # Foundation validation
```

Run task-specific targeted tests and credential/security checks required by the changed scope.

CI environment variables may use isolated non-Production placeholders/fixtures. This does not authorize changing the tracked Production Prisma provider away from PostgreSQL.

## Completion Contract

See `process/DEFINITION_OF_DONE.md` for the full Task Completion Contract.

Every task must pass the applicable gates before being marked complete.

## End-of-Task Response Format

Every task response must include:

```
1. Goal — what was the objective
2. Result — what was achieved
3. Verified discoveries — proven facts from code/tests/Production
4. Errors and root causes / business rule applied
5. Files/functions — what changed
6. Tests/CI — what was actually run and results
7. Production verification status — verified / not verified / not applicable
8. Documentation/knowledge/write-back updates — only affected canonical sources
9. Remaining risks — what is still uncertain or pending
10. Next safe gate — what should happen next
```

## Git Conventions

- **Branch naming**: `st-XX-short-description`, `security/short-description`, or `policy/short-description`
- **Commit message**: `type(scope): description`
- **PR**: Draft until review passes; squash merge with exact-head guard unless the current approved workflow says otherwise
- **Force-push**: prohibited in normal workflow
- **Main push**: prohibited (merge via PR only)

## Push-Early Checkpoint Policy (Sandbox-Hosted Work)

> See `process/GOVERNANCE.md` for precedence and `process/AGENT_HANDOFF.md` §12 for the detailed checkpoint summary/procedure. `process/SAFETY_CHECKLIST.md` contains the release/Production safety view.

Sandbox workspace is ephemeral. Meaningful work should be pushed to a bounded GitHub branch as focused checkpoints after minimum applicable validation. GitHub remote branch is the persistent technical source of truth. Do not rely on local state, patches, ZIPs, or `public/` files as the primary artifact.

- **Autonomous within clear scope**: branch creation, focused checkpoint commit/push, Draft PR, in-scope CI repair, issue/PR status comment
- **Owner-gated**: mark Ready, merge, deploy, Production access/query/write, migration, credential action, history rewrite/force-push, repository settings, scope expansion
- **Emergency WIP**: allowed only under the current documented reset-risk conditions and must remain Draft/not-complete
- **Never push**: `.env`, secrets, credentials, `db/custom.db`, Production dumps, raw sensitive rows, `node_modules/`, build output, large raw logs/full chat transcripts