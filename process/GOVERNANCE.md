# Governance — YH Stock System

> Canonical policy for resolving conflicts between AI instructions, repository documents, Notion context, and older handoff/runbook text.
>
> Effective: 2026-08-07

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
4. **`process/CURRENT_STATE.md` + current GitHub/CI/Production evidence** for current technical state. Runtime claims require runtime evidence.
5. **Notion** for durable Owner/business context, cross-project decisions, policy summaries, and routing to canonical GitHub sources.
6. **Handoff/runbooks/templates/worklogs/historical pages** as secondary guidance only. If they conflict with a higher source, the higher source wins and the older statement is superseded.

A newer timestamp alone does **not** override a higher-authority source unless it records a current explicit Owner decision or verified current state.

## 3. Source-of-truth responsibilities

| Source | Canonical responsibility |
|---|---|
| GitHub | Code, tests, CI, technical docs, technical policy, exact evidence, PR/commit history |
| Linear | Task state, priority, blocker, acceptance criteria, concise current gate |
| Notion | Owner/business context, durable decisions, SOP/business memory, cross-system index and summaries |
| Production | Live runtime evidence only; never infer Production state from code/docs alone |

Do not duplicate full technical policies into Notion. Notion should link to the canonical GitHub document and keep only the Owner/business meaning or durable decision.

## 4. Current Git action policy

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

## 5. Superseded legacy instructions

The following older instructions are **superseded** wherever they appear in handoff/runbook/Notion text:

1. **Blanket prohibition on commit/push without Owner approval.**
   - Replaced by the autonomous checkpoint + Draft PR policy above.
   - Merge/deploy/Production remain Owner-gated.

2. **`git push origin main` as a normal deploy/release step.**
   - Direct main push is prohibited.
   - Changes reach `main` only through an Owner-approved PR merge.

3. **Treating local sandbox files/patches/ZIPs as primary persistent artifacts.**
   - GitHub remote branch is the persistent technical source of truth.
   - Patch/ZIP may be secondary backup only after remote checkpointing and must contain no secrets/sensitive data.

4. **Changing the tracked Production `prisma/schema.prisma` provider to SQLite for routine local work.**
   - The tracked Production schema provider must remain `postgresql`.
   - Tests needing an alternate database must use an isolated fixture/test configuration that cannot be committed as the Production schema.

5. **Using historical status/risk lists as current truth without re-verification.**
   - Current state must be reloaded from `CURRENT_STATE.md`, GitHub/CI, and Production evidence when relevant.

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

## 8. Required AI reading order for YH Stock System

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. task-relevant canonical domain docs
5. `knowledge/` records related to the task
6. task-specific code/tests/issues/PRs
7. Notion AI Read First / Owner decisions for durable Owner/business context

Notion remains required context, but it must not override current canonical GitHub technical policy unless it records a newer explicit Owner decision.

## 9. Cleanup rule for legacy documents

`process/AGENT_HANDOFF.md`, `process/SAFETY_CHECKLIST.md`, old Notion project checkpoints, and historical worklogs may contain valid history mixed with stale instructions. Until fully reconciled:

- use them as supporting references, not policy authority;
- any conflict with `AGENTS.md` or this file is automatically superseded;
- update/remove stale current-operation instructions when those files are next edited.

## Key takeaway

**Owner decides risk/business gates; GitHub holds canonical technical policy/evidence; Notion holds durable Owner/business context and links to GitHub. When documents conflict, follow the authority hierarchy instead of guessing.**
