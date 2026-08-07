# Project Operating Context — YH Stock System

> Durable project context only. Dynamic technical state belongs in `process/CURRENT_STATE.md` and current GitHub/CI/Production evidence.
> Last reconciled: 2026-08-07

## 1. Project identity

- **Project**: YH Stock System — ระบบสต็อกของ บริษัท ยงเฮง มหาชัย รีไซเคิล
- **Business purpose**: รองรับงานรับซื้อ ขาย คัดแยก/ย้ายสต็อก ตรวจประวัติ และการควบคุม stock/cost/ledger ให้ตรวจย้อนหลังได้
- **Repository**: `NUT2550/--ST-yongheng-recycle`
- **Production app**: `https://st-yongheng-recycle.vercel.app`
- **Primary stack**: Next.js + TypeScript + Prisma + Supabase PostgreSQL + Vercel

This document intentionally does **not** list current feature status, current users, current issue priorities, current PR heads, Production row counts, or current risks. Those values change too often and become stale.

## 2. Required routing

Before work:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. task-relevant domain docs
5. current issue/PR/code/tests
6. Notion `AI Read First — YH Stock System` and current Owner decisions when relevant

When documents conflict, follow `process/GOVERNANCE.md`.

## 3. Source-of-truth responsibilities

| Source | Responsibility |
|---|---|
| GitHub | code, tests, CI, technical docs/policy, exact technical evidence |
| Linear | task state, priority, blockers, acceptance criteria, current gate |
| Notion | durable Owner/business context, decisions, SOP/business memory, concise routing summaries |
| Production | live runtime/data evidence only |

Do not copy a live task list into this file. Do not infer Production state from this file.

## 4. Stable technical invariants

- Production database technology is PostgreSQL via Supabase.
- The tracked Production Prisma schema must remain `postgresql`.
- Alternate test databases, if required, must use isolated test configuration/fixtures and must not require editing the tracked Production provider to SQLite.
- Secrets and credentials must never be committed or copied into documentation.
- Stock/cost/history correctness and auditability take priority over speed.
- Production mutations, migrations, merge, deploy, and other Owner-gated operations follow `AGENTS.md` + `process/GOVERNANCE.md`.

## 5. Stable business/engineering domains

The system may contain or evolve across these domains. Exact implementation status must be verified from current code and `CURRENT_STATE.md`:

- authentication and permissions
- product/customer/user masters
- buy bills and stock creation
- sell bills and FIFO/cost deduction
- sorting / dismantling / transfer flows
- stock lots and inventory views
- bill cancellation/reversal
- physical count / stock adjustment
- credit/receivable/payable workflows
- employee/bonus workflows
- import workflows
- history/audit trail
- dashboard/reporting

## 6. Canonical domain documents

- `process/BUSINESS_RULES.md` — Owner-approved behavior that affects the system
- `process/DATABASE_CONTEXT.md` — schema/stock-flow/data constraints
- `process/DEFINITION_OF_DONE.md` — completion gates
- `process/SAFETY_CHECKLIST.md` — migration/deploy/Production safety
- `process/DEPLOYMENT_RUNBOOK.md` — release/deploy process
- `process/REPAIR_RUNBOOK.md` — evidence-first defect workflow
- `process/FEATURE_INVENTORY.md` — durable feature map and verification method, not a stale status snapshot
- `process/REBUILD_SPEC.md` — rebuild/reference specification; verify against current code before use

## 7. What does not belong here

Do not store:

- dated “current status” snapshots
- issue priority lists
- branch/PR SHAs expected to remain current
- Production row counts
- user-role assumptions that can change in the database
- sandbox-local paths
- instructions to direct-push `main`
- instructions to switch tracked Prisma schema to SQLite
- raw logs, progress diary, full chat transcript

Historical versions remain available in Git history.

## Key takeaway

**This file explains what the project is and how to route context. For what is true right now, reload `CURRENT_STATE.md`, GitHub/CI, Linear, and Production evidence as applicable.**