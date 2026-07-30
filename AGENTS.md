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

## Required Reading Order

1. **`AGENTS.md`** (this file) — entry point, safety rules, working method
2. **`process/CURRENT_STATE.md`** — current main SHA, Production SHA, active issues, verified/unverified behavior
3. **`process/PROJECT_OPERATING_CONTEXT.md`** — project summary, tech stack, file structure
4. **`process/BUSINESS_RULES.md`** — bill number format, cancel behavior, FIFO, permissions, stable error codes
5. **`process/DATABASE_CONTEXT.md`** — Prisma schema, stock flow, forbidden operations
6. **`knowledge/`** — durable technical knowledge (incidents, invariants, decisions)
7. Task-specific code, tests, and docs

## Source-of-Truth Responsibilities

| Source | Role | What it stores |
|---|---|---|
| **GitHub** | Code, tests, CI, technical evidence, durable technical memory | Repository files, PRs, issues, workflow runs |
| **Linear** | Task state, priority, current gate, concise decisions | ST-XX issue status, comments, relations |
| **Notion** | Owner/business context, durable operational decisions | AI Read First, Command Center, business rules context |
| **Production** | Runtime evidence only — never inferred from code alone | Live behavior, deployment identity, HTTP responses |

## Safety Rules

1. **Correctness of stock, cost, ledger, and history over speed** — never rush a mutation
2. **Read-only first** — inspect before mutating
3. **No Production mutation without explicit Owner approval** — including cancel, sell, stock adjustment
4. **No direct SQL mutation** unless separately approved — use API routes
5. **No migration, merge, deploy, rollback, or permission changes** without explicit Owner approval
6. **Stop on partial write, data mismatch, unexpected 2xx/5xx, or unclear contract**
7. **Separate unrelated root causes** into separate issues/PRs
8. **Never commit `.env`, `db/custom.db`, tokens, passwords, or Production dumps**
9. **Git email must be** `207142776+NUT2550@users.noreply.github.com`
10. **Prisma provider must remain** `postgresql` in production schema

## Required Working Method

1. **Reload exact current state** — fetch latest, verify HEAD SHA, read `CURRENT_STATE.md`
2. **Prove root cause before editing** — read actual code, do not guess
3. **Create bounded branch** from current `main`
4. **Add a regression test** that would fail before the fix and pass after
5. **Run targeted and full validation** — lint, tsc, tests, build
6. **Perform exact-head independent review** — re-open actual files, challenge every requirement
7. **Update canonical documentation** — only affected docs, current-truth replacement
8. **Write back to GitHub, Linear, and Notion** — concise, evidence-based
9. **Distinguish code verification from Production verification** — never claim Production-verified without evidence

## Test Commands

```bash
bun install --frozen-lockfile     # Install dependencies
bun run db:generate               # Generate Prisma client
bun run lint                      # ESLint
npx tsc --noEmit                  # TypeScript typecheck
bun test                          # Full test suite
bun test tests/st70-*.test.ts     # Targeted ST-70 tests
bun run build                     # Production build (use non-Production placeholders)
bash scripts/validate-foundation.sh  # Foundation validation (required files, safety checks)
```

CI environment variables (non-Production):
- `JWT_SECRET=ci-dummy-jwt-secret-not-for-production-use-only`
- `DATABASE_URL=file:/tmp/ci-dummy.db`

## Completion Contract

See `process/DEFINITION_OF_DONE.md` for the full Task Completion Contract.

Every task must pass the applicable gates before being marked complete.

## End-of-Task Response Format

Every task response must include:

```
1. Goal — what was the objective
2. Result — what was achieved
3. Verified discoveries — proven facts from code/tests/Production
4. Errors and root causes — what went wrong and why
5. Files/functions — what changed
6. Tests/CI — what was run and results
7. Production verification status — verified / not verified / not applicable
8. Documentation/knowledge updates — what docs were updated
9. Remaining risks — what is still uncertain or pending
10. Next safe gate — what should happen next
```

## Git Conventions

- **Branch naming**: `st-XX-short-description` (e.g., `st-71-reliability-foundation`)
- **Commit message**: `type(scope): description` (e.g., `fix(st-71): enforce 401/403 separation`)
- **PR**: Draft until review passes; squash merge with head guard
- **Force-push**: prohibited
- **Main push**: prohibited (merge via PR only)
