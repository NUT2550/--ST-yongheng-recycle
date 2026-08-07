# Definition of Done — Task Completion Contract

> Every task must pass the applicable gates below before being represented as complete.
> “It compiles” or “CI passed” alone is not sufficient.
> Last reconciled: 2026-08-07

## 1. General completion rules

A task is complete only when the evidence required by its scope exists and unresolved risk is classified honestly.

Always distinguish:

- `Verified`
- `Inference`
- `Unknown / Not verified`
- `Blocked`
- `Needs Owner Decision`
- `Superseded`

Never claim Production verification from code/CI alone.

## 2. Defect fix

A defect fix is Done when all applicable gates are satisfied:

| Gate | Requirement |
|---|---|
| Symptom | Reproducible symptom or evidence documented |
| Root cause | Proven, not assumed |
| Scope | Bounded to the proven root cause |
| Fix | Addresses root cause, not only symptom |
| Regression test | Would fail before fix and pass after fix, or equivalent evidence when a traditional test is not technically possible and the exception is documented |
| Targeted tests | Relevant changed behavior passes |
| Full validation | Applicable lint/typecheck/tests/build/foundation/security checks pass |
| Exact-head CI | Required checks pass on exact PR head |
| Independent review | Fresh exact-head review performed; blocker/high findings resolved or explicitly Owner-gated |
| Documentation | Affected canonical docs updated to current truth |
| Production verification | Required only when the task/release contract needs runtime proof; must use real Production evidence |
| Observation | Required when a current business/safety rule calls for it (for example stock-integrity risk) |
| Write-back | Updated only in the source systems whose canonical state actually changed |

## 3. Feature work

A feature is Done when all applicable gates are satisfied:

| Gate | Requirement |
|---|---|
| Business rule | Owner-confirmed when behavior requires an Owner decision |
| Acceptance criteria | Explicit and met |
| Failure modes | Defined and tested where applicable |
| Permissions | Auth/permission contract defined and tested where applicable |
| Stock/cost/history effects | Documented and verified where applicable |
| Tests | Happy path + relevant failure/edge/concurrency/idempotency coverage |
| Documentation | Affected canonical docs updated; do not maintain duplicate status snapshots |
| Validation | Full applicable validation + exact-head CI |
| Review | Fresh exact-head independent review |
| Release plan | Merge/deploy/migration/rollback requirements stated |
| Production verification | Performed when critical/runtime acceptance requires it |

## 4. Documentation/policy-only change

A documentation/policy change is Done when:

- content is reconciled against current evidence;
- authority/source-of-truth ownership is clear;
- stale current-looking claims are removed, replaced, or clearly marked Historical/Superseded;
- duplicate policy is reduced to links/summary where practical;
- internal links/paths are valid;
- no secrets/credentials/Production dumps are added;
- exact-head diff is re-read;
- applicable CI/credential checks pass;
- no application/Production effect is falsely claimed.

For governance cleanup, preserving old text in Git history is sufficient; current canonical docs should describe current truth rather than carrying a progress diary.

## 5. Write-back by source responsibility

Do **not** write every task into every system.

| If this changed | Write back to |
|---|---|
| Code/tests/technical policy/evidence | GitHub |
| Task status/priority/blocker/current gate | Linear |
| Durable Owner/business decision, cross-project context, SOP/business memory | Notion |
| Live runtime fact | Record evidence in the task/PR; Production remains the runtime source |

Notion must not receive raw logs, shell transcripts, duplicate technical policy, or routine progress merely to satisfy a checklist.

If a task changes no durable Notion context, **no Notion write-back is required**.

## 6. Emergency incident exception

During an active Production incident, the Owner may explicitly authorize an expedited path. The exact allowed deferrals must be stated for that incident.

The expedited path does not automatically authorize:

- Production mutation
- migration
- deploy
- merge
- credential action
- destructive rollback

Those actions still follow current Owner gates in `AGENTS.md` + `process/GOVERNANCE.md`.

Root cause/evidence may be recorded incrementally during containment, but no unsupported “fixed/verified” claim is allowed.

## 7. Not Done conditions

A task is not Done if any applicable condition remains:

- root cause is still only a hypothesis
- unresolved partial/unexplained data state
- required regression/failure evidence is absent
- required CI failed or is stale relative to current head
- canonical docs contradict current implementation/evidence
- unresolved blocker/high finding without explicit Owner disposition
- required Owner gate was skipped
- Production verified is claimed without Production evidence
- tests use `.skip`/`.only` to hide required coverage without an explicit documented exception
- current task state is not written back to its canonical tracker
- duplicate/stale policy was introduced into another system

## 8. End-of-task evidence summary

Report at least:

1. Goal
2. Result
3. Verified discoveries
4. Root cause/business rule applied
5. Files/functions changed
6. Tests/CI actually run
7. Production verification status
8. Canonical documentation/write-back changes
9. Remaining risks/unknowns
10. Next safe gate

## Key takeaway

**Done means proven, reviewed, and written back to the correct source of truth — not copied into every tool.**