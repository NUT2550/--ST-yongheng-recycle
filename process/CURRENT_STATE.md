# Current State — YH Stock System

> **Concise, current, dated. No progress diaries. No raw logs.**
> Last updated: 2026-07-30

## Version Identity

> **Update this section after every merge to main.**
> Run `git log --oneline -1 origin/main` to get the current main SHA.

| Item | Value |
|---|---|
| **Current main SHA** | Check: `git log --oneline -1 origin/main` |
| **Current Production SHA** | Check: GitHub deployment API or Vercel dashboard |
| **Last verified Production SHA** | `132d21e13ccf5b9ccb9fbd5bc9235b1ee563a733` (verified 2026-07-30, ST-71 P0) |
| **Production URL** | https://st-yongheng-recycle.vercel.app |
| **Production deployment state** | success (as of 2026-07-30) |

## Active Issues

| Issue | Status | Summary |
|---|---|---|
| **ST-71 / Issue #50** | In Progress | Reliability foundation + regression prevention. P0 cancel auth released (PR #51). Broader scope pending. |
| **ST-70 / PR #49** | Closed | Sorting cancellation atomic + duplicate-safe. Production verified (Phases 1-3). |
| **ST-71 P0 / PR #51** | Merged | 401/403 separation for Buy/Sell/Transfer cancel. Production 401 verified. |

## Recently Completed

| Incident | PR | Merge SHA | Production Verified |
|---|---|---|---|
| ST-70 (sorting cancel) | #49 | `de9848e1f3` | ✅ Phases 1-3 (incident read-only, history, controlled cancellation) |
| ST-71 P0 (cancel auth) | #51 | `132d21e` | ✅ 401 AUTH_REQUIRED (8/8 Production checks). ❌ 403 PERMISSION_DENIED (no staff credentials in sandbox) |

## Current Verified Behavior

- ✅ **Login + JWT auth** — works in Production (ST-10 tests + ST-70 unauth gate verification)
- ✅ **401 AUTH_REQUIRED** — all 4 cancel routes (Buy, Sell, Transfer, Sorting) return 401 for no/invalid token
- ✅ **Sorting cancellation** — atomic, duplicate-safe, cost evidence, CAS delete (ST-70 Production verified)
- ✅ **Combined sorting history** — server-side merge, deterministic ordering, bounded pagination (ST-70 Phase 2 verified)
- ✅ **401/403 separation** — shared `resolveHistoryEditAuth` helper in `src/lib/cancel-auth.ts` (ST-71 automated tests)
- ✅ **FIFO cost** — deterministic ordering `dateAdded ASC → createdAt ASC → id ASC` (ST-39 tests)
- ✅ **StockMovement ledger** — reversal identity, idempotency keys (ST-47 tests)

## Current Unverified Behavior

- ❌ **403 PERMISSION_DENIED** — not tested in Production (no staff credentials in sandbox; verified by automated tests only)
- ❌ **Buy bill cancel** — not tested in Production (no regression test)
- ❌ **Sell bill cancel** — not tested in Production (no regression test)
- ❌ **Transfer cancel** — not tested in Production (no regression test)
- ❌ **Dashboard** — no automated test, not Production-verified
- ❌ **Stock page** — no automated test, not Production-verified
- ❌ **Post-deploy smoke test** — no automated workflow

## Active Blockers and Risks

| Risk | Priority | Status |
|---|---|---|
| Buy/Sell/Transfer cancel have no regression tests | P0 | Identified, not yet implemented |
| 403 PERMISSION_DENIED not Production-verified | P1 | Requires Owner to test with staff account |
| Route-level HTTP integration tests missing | P1 | Test infrastructure limitation (`server-only` guard) |
| No AGENTS.md (until this PR) | P1 | Being implemented in this PR |
| No knowledge/ directory | P2 | Deferred to separate phase |
| No post-deploy smoke workflow | P1 | Being implemented in this PR |
| weightExpression migration not run | P0 | Pending Owner decision |

## Pending Owner Decisions

1. **weightExpression migration** — `prisma/migrations/add_weight_expression.sql` ready but NOT run. Owner decision required.
2. **403 Production verification** — Owner should test cancel routes with a staff account (no `history.edit`).
3. **ST-71 broader scope** — AGENTS.md, Definition of Done, PR template, smoke workflow (this PR). Knowledge/ system deferred.

## Next Safe Work Item

Review and merge this reliability foundation PR (AGENTS.md, CURRENT_STATE.md, DEFINITION_OF_DONE.md, PR template, smoke workflow).

## References

- `AGENTS.md` — AI entry point
- `process/DEFINITION_OF_DONE.md` — Task Completion Contract
- `process/BUSINESS_RULES.md` — Section 8.5: Stable Error Codes
- `src/lib/cancel-auth.ts` — Shared 401/403 auth helper
- `tests/st71-cancel-auth-regression.test.ts` — 11 regression tests
- PR #49 (ST-70), PR #51 (ST-71 P0), Issue #50 (ST-71)
