# Definition of Done — Task Completion Contract

> Every task must pass the applicable gates below before being marked complete.
> "It compiles" or "CI passed" is never sufficient evidence of completion.

## 1. Defect Fix

A defect fix is Done when ALL of the following are satisfied:

| Gate | Requirement |
|---|---|
| Symptom | Reproducible symptom or evidence documented |
| Root cause | Proven root cause (not assumed) — from code, tests, or Production evidence |
| Fix | Bounded fix that addresses the root cause, not just the symptom |
| Regression test | A test that would FAIL before the fix and PASS after |
| Targeted tests | All tests directly related to the changed code pass |
| Full validation | `bun run lint` + `npx tsc --noEmit` + `bun test` + `bun run build` all pass |
| Exact-head CI | All required CI checks pass on the exact PR head SHA |
| Documentation | Affected canonical docs updated to current truth |
| Independent review | Fresh exact-head review performed and findings resolved |
| Production verification | Critical workflows verified in Production (if applicable) |
| Write-back | GitHub PR + Linear + Notion updated with evidence |
| Observation period | 24h observation for stock-integrity changes (if applicable) |

## 2. Feature Work

A feature is Done when ALL of the following are satisfied:

| Gate | Requirement |
|---|---|
| Business rule | Confirmed by Owner and documented in `process/BUSINESS_RULES.md` |
| Acceptance criteria | Defined and met |
| Tests | Unit + integration tests covering happy path + failure modes |
| Failure modes | Documented error codes and behaviors |
| Permissions | Auth/permission contract defined and tested |
| Stock/cost/history effects | Documented and verified |
| Documentation | Updated canonical docs + `FEATURE_INVENTORY.md` |
| Release plan | Merge method, deploy trigger, rollback plan documented |
| Validation | Full validation + exact-head CI pass |
| Production verification | Performed for critical workflows |

## 3. Documentation-Only Change

A documentation-only change is Done when ALL of the following are satisfied:

| Gate | Requirement |
|---|---|
| Reconciled | Content verified against current code/tests/state |
| No unsupported claims | No "Production verified" without evidence; no "completed" without tests |
| Superseded content | Old content clearly marked `📜 Historical note (superseded YYYY-MM-DD)` |
| Internal links | All links point to real repository paths |
| No secrets | No tokens, passwords, DATABASE_URL, or Production dumps |

## 4. Not Done Conditions

A task is NOT Done if ANY of the following are true:

- CI passed only once but no regression test was added
- Code merged but Production not verified where required
- Partial or unexplained Production state
- Documentation contradicts code
- Unresolved P0/P1 finding from independent review
- Owner approval gate skipped
- Root cause not proven (only symptom addressed)
- "Production verified" claimed without HTTP/DB evidence
- Tests are `.skip` or `.only` without documented reason
- No write-back to GitHub/Linear/Notion
