# Governance — YH Stock System

> Canonical policy for resolving conflicts between AI instructions, repository documents, Notion context, and older handoff/runbook text.
>
> Effective: 2026-08-20 (ST-76 Governance Reconciliation v2 + separate Merge/Deploy gate decision)

## 1. Purpose

This file defines **which source wins when instructions conflict**. It does not replace domain-specific business rules, database rules, safety procedures, or task-specific evidence.

## 2. Authority hierarchy

When two instructions conflict, use this order:

1. **Current explicit Owner decision** for the specific task/risk.
2. **`AGENTS.md` + this `process/GOVERNANCE.md`** for AI operating policy, source-of-truth routing, Git workflow, and approval gates.
3. **Domain canonical documents** for their subject:
   - `process/BUSINESS_RULES.md` — business behavior and Owner-approved system rules
   - `process/DATABASE_CONTEXT.md` — schema/stock-flow/data constraints
   - `process/DEFINITION_OF_DONE.md` — completion gates
   - `process/SAFETY_CHECKLIST.md` — migration/deploy/runtime safety procedures
4. **`process/CURRENT_STATE.md` + current GitHub/CI/Production evidence** for current technical state. Runtime claims require runtime evidence. Exact current `main` SHA is read directly from GitHub rather than treated as self-updating text inside `CURRENT_STATE.md`.
5. **Linear** for task state, priority, blocker, acceptance criteria, concise current gate.
6. **Notion** for durable Owner/business context, cross-project decisions, policy summaries, and routing to canonical GitHub sources.
7. **Runbooks/templates/worklogs/historical pages** as secondary guidance only. If they conflict with a higher source, the higher source wins and the older statement is superseded.

A newer timestamp alone does **not** override a higher-authority source unless it records a current explicit Owner decision or verified current state.

## 3. Source-of-truth responsibilities

| Source | Canonical responsibility |
|---|---|
| GitHub | Code, tests, CI, technical docs, technical policy, exact evidence, PR/commit history, live branch head |
| Linear | Task state, priority, blocker, acceptance criteria, concise current gate |
| Notion | Owner/business context, durable decisions, SOP/business memory, cross-system index and summaries |
| Vercel / Production | Deployment/runtime evidence only; never infer live runtime state from code/docs alone |

Do not duplicate full technical policies into Notion. Notion should link to the canonical GitHub document and keep only the Owner/business meaning or durable decision.

## 4. Current Git / release action policy

### Autonomous within a clear approved task scope

AI agents may:

- fetch/reload current context
- create a bounded feature/policy branch from exact current `main`
- push an initial branch checkpoint
- create focused commits and fast-forward checkpoint pushes
- open/update a **Draft PR**
- create/comment on GitHub issues when no duplicate exists
- inspect CI and repair failures caused by the in-scope change
- update technical documentation/knowledge required by the same change
- trigger `@codex review` when review capacity is available

These actions do not authorize Production access or release.

### Explicit Owner approval required

AI agents must stop before:

- marking a PR Ready
- merging
- deploying
- Production connection/query/write
- Production data correction
- credential validation/rotation
- database migration
- rollback that affects `main`/Production
- direct push to `main`
- force-push or history rewrite
- repository visibility/settings/branch-protection changes
- closing GitHub/Linear issues when closure is an Owner gate
- expanding scope into an unrelated issue/root cause

### Merge and Deploy are separate gates

Owner decision 2026-08-20:

- **Merge approval does not authorize Deploy.**
- A merge to `main` must not automatically create/promote a Production deployment.
- Vercel Git-triggered deployment for `main` must be disabled through tracked project configuration or an approved Vercel setting.
- Non-`main` Preview deployments may remain enabled for review/testing when they do not mutate Production data.
- Production deployment occurs only after a **separate explicit Owner Deploy approval** using the approved manual deploy/promote path.
- A deployment that appears automatically after a merge is an unexpected release-side effect and must be recorded/stopped on; it is not retroactively authorized by the Merge approval.

## 5. Superseded legacy instructions

The following older instructions are **superseded** wherever they appear in historical pages, old PRs/issues, worklogs, or old revisions:

1. **Blanket prohibition on commit/push without Owner approval.**
   - Replaced by the autonomous checkpoint + Draft PR policy above.
   - Merge/deploy/Production remain Owner-gated.

2. **`git push origin main` as a normal deploy/release step.**
   - Direct main push is prohibited.
   - Changes reach `main` only through an Owner-approved PR merge.

3. **Treating a successful merge as implicit Production deployment approval.**
   - Superseded by the explicit separate Merge and Deploy gates above.
   - Automatic Git deployment from `main` is not an approved release path.

4. **Treating local sandbox files/patches/ZIPs as primary persistent artifacts.**
   - GitHub remote branch is the persistent technical source of truth.
   - Patch/ZIP may be secondary backup only after remote checkpointing and must contain no secrets/sensitive data.

5. **Changing the tracked Production `prisma/schema.prisma` provider to SQLite for routine local work.**
   - The tracked Production schema provider must remain `postgresql`.
   - Tests needing an alternate database must use an isolated fixture/test configuration that cannot be committed as the Production schema.

6. **Using historical status/risk lists as current truth without re-verification.**
   - Current state must be reloaded from GitHub/CI, `CURRENT_STATE.md`, and Production/Vercel evidence when relevant.

7. **Using `worklog.md` as the primary AI context source.**
   - `AGENTS.md` is the canonical AI entry point.
   - `worklog.md` is retained as historical evidence but is not a source of current truth.

## 6. Conflict-handling protocol

When an agent encounters conflicting or stale guidance:

1. Stop the conflicting action; do not guess.
2. Identify the exact conflicting sources/statements.
3. Apply the authority hierarchy above.
4. If a current Owner decision is still ambiguous, classify as `Needs Owner Decision` and stop at the gate.
5. Update the affected canonical document when the resolution is durable.
6. Mark older useful material as historical/superseded rather than silently treating it as current truth.
7. Write back a concise Notion summary only when the resolution affects future Owner/business context.

## 7. Documentation hygiene

- One canonical rule per subject; other documents should link/reference it instead of copying full policy text.
- Canonical docs describe **current truth**, not progress diaries.
- Preserve historical evidence in Git/PR/issues; do not keep obsolete current-state prose merely for history.
- Never store secrets, credentials, Production dumps, large raw logs, or full chat transcripts in GitHub/Notion.
- Separate `Verified`, `Inference`, `Unknown`, `Superseded`, `Blocked`, and `Needs Owner Decision` where uncertainty matters.
- Do not hardcode an “always current” Git `main` SHA into a file that can only change by creating another Git commit; store a last-reconciled baseline and resolve the live head from GitHub.

## 8. Required AI reading order for YH Stock System

1. `AGENTS.md` — mandatory entry point, safety rules, working method
2. `process/GOVERNANCE.md` (this file) — authority hierarchy, conflict resolution, Git/autonomy/release boundaries
3. `process/CURRENT_STATE.md` — last reconciled baseline, deployment identity, active risks, verified/unverified behavior; exact `main` SHA comes from GitHub
4. `process/PROJECT_OPERATING_CONTEXT.md` — project summary, tech stack, file structure
5. `process/BUSINESS_RULES.md` — bill number format, cancel behavior, FIFO, permissions
6. `process/DATABASE_CONTEXT.md` — Prisma schema, stock flow, forbidden operations
7. `knowledge/` — durable technical knowledge (incidents, invariants, decisions)
8. Task-specific code, tests, issues, PRs
9. Notion AI Read First / Owner decisions for durable Owner/business context

Notion remains required context, but it must not override current canonical GitHub technical policy unless it records a newer explicit Owner decision.

## 9. Key takeaway

**Owner decides risk/business gates; GitHub holds canonical technical policy/evidence and live branch identity; Notion holds durable Owner/business context; Vercel/Production holds deployment/runtime evidence. Merge and Deploy are separate Owner gates. When documents conflict, follow the authority hierarchy instead of guessing.**
