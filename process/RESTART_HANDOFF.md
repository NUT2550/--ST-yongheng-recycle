# RESTART_HANDOFF.md — General Restart Template

> **This file provides the canonical restart context for any AI agent resuming work on YH Stock System.**
>
> If the Z.AI workspace, terminal history, or AI memory resets, this file
> plus `process/CURRENT_STATE.md` and `AGENTS.md` contain everything
> needed to resume safely.
>
> **Do not mutate any repository state until Phase 1 state verification
> is complete after resume.**

---

## 1. Restart identity

| Field | Value |
|---|---|
| Repository | `NUT2550/--ST-yongheng-recycle` |
| Current main SHA | Check: `git log --oneline -1 origin/main` (see `process/CURRENT_STATE.md` for last known) |
| Working branch | Determine from Linear/GitHub PR — do not assume |
| Last updated | 2026-08-20 (ST-76 Governance Reconciliation v2) |

## 2. Phase 1: State verification (mandatory before any mutation)

1. **Fetch and verify remote:**
   ```bash
   git fetch origin
   git rev-parse origin/main
   ```
   Compare with `process/CURRENT_STATE.md`.

2. **Read canonical entry point:**
   - `AGENTS.md` — mandatory AI entry point
   - `process/GOVERNANCE.md` — authority hierarchy
   - `process/CURRENT_STATE.md` — current state

3. **Determine current task:**
   - Check Linear for current task assignment, priority, and gate
   - Check GitHub PRs for any active Draft PRs
   - Do NOT assume old local state is current

4. **Verify no stale local workspace:**
   - If resuming from a sandbox reset, clone fresh
   - Do NOT trust local patches, ZIPs, or `public/` files as primary artifacts

## 3. Phase 2: Resume work

After state verification:

1. **Confirm the task scope** from the Linear ticket or Owner instruction
2. **Create or checkout a bounded branch** from current `main`
3. **Follow AGENTS.md working method** (read-only first, prove root cause, etc.)
4. **Push early checkpoints** — GitHub remote is the persistent source of truth

## 4. Historical reference

> 📜 **Historical note (superseded 2026-08-20):** This file was previously ST-71-specific (generated 2026-07-30 with SHA `c1f714af`). ST-71 is complete. This file is now a general restart template for any task.

## 5. Key references

- `AGENTS.md` — AI entry point, safety rules, working method
- `process/GOVERNANCE.md` — authority hierarchy, conflict resolution
- `process/CURRENT_STATE.md` — current main/Production SHA, verified behavior
- `process/DEFINITION_OF_DONE.md` — completion gates
- `knowledge/` — durable technical knowledge (incidents, invariants, decisions)
