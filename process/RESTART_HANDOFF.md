# Restart Handoff — YH Stock System

> Generic restart/resume routing only. Historical ST-71-specific restart details are preserved in Git history.
> Last updated: 2026-08-07

## Purpose

If an AI workspace/session/local checkout resets, do **not** resume from a dated branch/SHA/task snapshot in this file.

Restart from current canonical evidence instead.

## Mandatory restart sequence

1. Read `AGENTS.md`.
2. Read `process/GOVERNANCE.md`.
3. Fetch current `main` and verify exact SHA.
4. Read `process/CURRENT_STATE.md`.
5. Inspect the current task's Linear issue and GitHub issue/PR/branch.
6. Read task-relevant canonical docs and knowledge records.
7. Read Notion `AI Read First — YH Stock System` and current Owner decisions when Owner/business context matters.
8. Compare any surviving local workspace against the remote branch before trusting it.
9. Classify differences as Verified / Inference / Unknown / Superseded / Blocked.
10. Resume only the bounded current task; do not revive closed historical work automatically.

## Remote-first persistence rule

GitHub remote branch/PR is the persistent technical state for active repository work.

Do not treat these as primary source of truth after a reset:

- local commits not on remote
- patch/ZIP backups
- sandbox filesystem paths
- terminal history
- old chat summaries
- dated restart handoffs
- old branch/PR SHAs embedded in documentation

If meaningful unpushed work is discovered locally, verify it before deciding whether it is still relevant. Never assume it should be applied to current `main`.

## Safety after restart

Before any mutation:

- verify current task scope and Owner gates;
- verify exact branch/head;
- check for duplicate/current PRs;
- inspect current code/tests rather than relying on historical implementation notes;
- do not access Production, migrate, deploy, merge, force-push, or rewrite history without the required Owner approval;
- do not expose/reuse stale credentials from old workspace artifacts.

## Handoff evidence to reconstruct

For the current task, rebuild context from:

- task objective / acceptance criteria
- current issue/PR status
- exact branch/head
- proven facts/root cause
- changed files/functions
- tests/CI actually run
- Production verification status
- remaining risks/unknowns
- next safe gate

This evidence belongs primarily in the task/PR and current canonical docs, not as a permanent dated snapshot here.

## Historical note

The previous version of this file was a detailed ST-71 restart snapshot dated 2026-07-30 with specific PRs, SHAs, branch-protection state, and Production 403 status. Those details are historical and many were later completed/superseded. Use Git history if audit evidence is needed.

## Key takeaway

**After a reset, reconstruct from current remote/canonical sources. Never resume blindly from a dated restart snapshot.**