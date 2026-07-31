# RESTART_HANDOFF.md — ST-71 Restart Source of Truth

> **This file is the canonical restart context for ST-71.**
> If the Z.AI workspace, terminal history, or AI memory resets, this file
> plus `process/CURRENT_STATE.md` and the linked GitHub issues contain
> everything needed to resume safely.
>
> **Do not mutate any repository state until Phase 1 state verification
> is complete after resume.**

---

## 1. Handoff identity

| Field | Value |
|---|---|
| Generated (Asia/Bangkok) | 2026-07-30 23:30 +07 |
| Repository | `NUT2550/--ST-yongheng-recycle` |
| Current main SHA | `c1f714af13a54d47e3c85eda11af14fd4efb1379` |
| Working branch | `st-71-core-closure` |
| Exact branch head (before this commit) | `1e9944e7a8b455a812a2398642f0faa6a977b456` |
| Related PR | #62 (Draft, open) |
| Prepared because | Z.AI workspace may reset overnight |

---

## 2. Current project status

- **ST-71 core engineering work is COMPLETE** (PRs #51–#59 merged)
- **Linear ST-71**: Done (core engineering work complete)
- **GitHub Issue #50**: OPEN (closure pending PR #62 merge)
- **PR #62**: DRAFT, unmerged — closure documentation
- **Closure documentation still requires Owner release approval**:
  `APPROVED — RELEASE ST-71 CLOSURE DOCUMENTATION`
- **No Production 403 verification has passed** (secret not configured)
- **Branch protection is NOT configured** on `main`

---

## 3. Completed technical work (PRs #51–#59)

| PR | Merge SHA | Delivered capability |
|---|---|---|
| #51 | `132d21e` | 401/403 auth separation for Buy/Sell/Transfer cancel (shared `resolveHistoryEditAuth` helper) |
| #52 | `19d6171` | Reliability foundation: AGENTS.md, DoD, PR template, production-smoke workflow |
| #53 | `b81da4a` | CI Foundation Validation enforcement + 26 regression tests |
| #54 | `f77f138` | Knowledge directory + 6 seed records + 3 templates |
| #55 | `e836b9f` | Knowledge semantic validation (15 rules, bounded YAML parser) |
| #56 | `97eabee` | Cancel route auth-wiring static coverage (39 tests, 81 expectations) |
| #57 | `172929d` | Static cancellation business-logic contract coverage (53 tests, 321 expectations) + adversarial mutation resistance |
| #58 | `22fb3cb` | PostgreSQL runtime cancellation harness (21 tests, 104 expectations) + CAS concurrency guard + 3-stage rollback proof |
| #59 | `c1f714a` | CURRENT_STATE reconciliation after PR #58 merge |

**Key technical achievements**:
- Auth separation: 401 (no/invalid token) vs 403 (missing `history.edit`) — verified
- Static cancellation contracts: 53 tests covering Buy/Sell/Transfer source-code patterns
- PostgreSQL runtime: 21 tests proving successful/duplicate/downstream/rollback/concurrent behavior
- CAS concurrency: `updateMany` + `isCancelled: false` + `count !== 1` — race window closed
- Rollback: proven at 3 fault-injection stages (afterClaim, beforeReversal, beforeAudit)
- Adversarial mutation resistance: 0 escapes across 28+ mutations

---

## 4. Current open work

| Tracker | ID | Title | State |
|---|---|---|---|
| Linear ST-72 ↔ GitHub #60 | ST-72 / #60 | Configure and verify main branch protection | Open |
| Linear ST-73 ↔ GitHub #61 | ST-73 / #61 | Verify authenticated Production 403 cancellation authorization | Open |
| PR #62 | #62 | docs(st-71): record core closure and follow-up ownership | Draft, unmerged |

**PR #62 scope**: documentation-only update to `process/CURRENT_STATE.md` (+27/−10). Records core closure status, follow-up issue links, accepted residual risks.

---

## 5. Exact next approved gate

**Approved next command**:
```
APPROVED — RELEASE ST-71 CLOSURE DOCUMENTATION
```

**Before releasing, verify**:
1. Cross-links in `process/CURRENT_STATE.md` include ST-72/#60 and ST-73/#61 ✅ (already present)
2. Exact-head CI reruns if the file changes (this handoff commit changes files — CI must rerun)
3. PR #62 remains Draft until exact-head review passes
4. Merge uses exact-head guard (verify `head.sha` matches approved SHA before `PUT /merge`)
5. GitHub #50 closes ONLY after documentation merge succeeds
6. Linear ST-71 marks complete ONLY after GitHub #50 closes

**Merge sequence**:
1. Mark PR #62 Ready (GraphQL `markPullRequestReadyForReview`)
2. Exact-head guard: verify `head.sha` = approved head
3. Squash merge: `PUT /pulls/62/merge` with `merge_method: squash`
4. Verify `main` points to merge commit
5. Close Issue #50 as completed
6. Preserve Linear ST-71 as Done (already Done — do not change)
7. Add Linear closure comment with merge commit + follow-up links
8. Update Notion Command Center
9. Keep ST-72/ST-73 and #60/#61 open

---

## 6. Production 403 state

| Field | Value |
|---|---|
| Required secret name | `STAFF_TOKEN_NO_HISTORY_EDIT` |
| Secret configured? | NO (0 repository secrets as of 2026-07-30 23:30 +07) |
| Secret value ever stored in repo? | NO — never retrieved, decoded, or committed |
| Authenticated Production 403 run completed? | NO |
| Expected HTTP status | 403 |
| Expected stable code | `PERMISSION_DENIED` |
| Test ID (use ONLY this) | `nonexistent-smoke-test-id` |
| Workflow | `.github/workflows/production-smoke.yml` (manual dispatch) |
| Owner of this work | ST-73 / GitHub #61 |

**Do NOT repeat secret checks** until the Owner states setup has changed. Repeated polling is unnecessary and wasteful.

**Setup requirements** (for ST-73):
- Temporary non-admin `staff` account (role=`staff`, active, no `history.edit`)
- Authenticate via normal login flow, extract JWT from response
- Store JWT as GitHub Actions encrypted secret `STAFF_TOKEN_NO_HISTORY_EDIT`
- Never paste JWT into chat, Linear, GitHub comments, Notion, source, or logs
- Cleanup: delete secret + disable account within 24 hours

---

## 7. Branch-protection state

| Field | Value |
|---|---|
| `main` protected? | NO (`protected: false` via API) |
| Classic branch protection? | NONE (HTTP 404) |
| Repository ruleset targeting `main`? | NONE (empty array `[]`) |
| Owner of this work | ST-72 / GitHub #60 |

**AI must NOT change branch protection** without explicit Owner authorization. This is an Owner UI administration action.

**Required universal checks** (when configured):
- `Foundation Validation`
- `Lint`
- `TypeScript Typecheck`
- `Production Build`
- `Unit Tests`

**Required approvals**: 0 (single-maintainer repository — 1 would deadlock)

**Do NOT require** (path-filtered or manual):
- ST-70 PostgreSQL Concurrency Tests
- ST-71 PostgreSQL Runtime Tests
- Production Smoke Test

---

## 8. Validation evidence (PR #62 head `1e9944e`)

| Check | Evidence | Result |
|---|---|---|
| Exact reviewed head | `1e9944e7a8b455a812a2398642f0faa6a977b456` | ✅ |
| CI run (pull_request) | 30560876958 | success |
| Foundation Validation | job 90933249655 | success |
| Lint | job 90933249756 | success |
| TypeScript Typecheck | job 90933249865 | success |
| Production Build | job 90933249651 | success |
| Unit Tests | job 90933249760 | success (1054/1054 pass, 3296 expect()) |
| Knowledge Semantic Validation | local | ALL CHECKS PASSED (6 records) |
| git diff --check | local | 0 whitespace errors |
| Changed files | 1 (`process/CURRENT_STATE.md`, +27/−10) | ✅ |

**Note**: If this handoff commit adds `process/RESTART_HANDOFF.md`, CI must rerun on the new head. The new head SHA will be recorded in the PR #62 comment after push.

---

## 9. Safety boundaries

**Do NOT**:
- Access Production
- Call cancellation endpoints
- Retrieve, decode, or display any credential
- Create or configure secrets
- Perform direct SQL mutation
- Run migrations
- Change application code
- Mutate branch protection
- Close follow-up issues (#60, #61)
- Merge PR #62 without exact-head Owner-approved release gate
- Force push
- Delete evidence branches or issue comments
- Mark ST-71 Done until PR #62 merges AND Issue #50 closes

---

## 10. Resume procedure

**Tomorrow, the first action must be**:

1. Read `AGENTS.md`
2. Read `process/CURRENT_STATE.md`
3. Read `process/RESTART_HANDOFF.md` (this file)
4. Fetch PR #62: `GET /repos/NUT2550/--ST-yongheng-recycle/pulls/62`
5. Fetch Issues #50, #60, #61
6. Fetch Linear ST-71, ST-72, ST-73
7. Verify current main SHA = `c1f714af13a54d47e3c85eda11af14fd4efb1379`
8. Verify PR #62 head matches the latest pushed head
9. Report whether handoff evidence still matches
10. **Do NOT mutate anything** until mismatch analysis is complete

**Exact resume command**:
```
RESUME FROM process/RESTART_HANDOFF.md — VERIFY STATE BEFORE ACTION
```

---

## 11. Known state inconsistencies

These inconsistencies exist as of 2026-07-30 23:30 +07. **Do NOT silently correct them tonight.**

1. **Linear ST-71 is Done** while GitHub #50 remains open.
   - This is expected: Owner marked ST-71 Done before GitHub closure.
   - Resolution: close GitHub #50 after PR #62 merges. Preserve Linear ST-71 as Done.

2. **PR #62 remains Draft** despite ST-71 core completion.
   - This is by design: closure documentation must be reviewed and merged with separate Owner approval.
   - Resolution: Owner issues `APPROVED — RELEASE ST-71 CLOSURE DOCUMENTATION`, then merge.

3. **Closure reconciliation is incomplete** until PR #62 merges and GitHub #50 closes.
   - CURRENT_STATE.md says "Core Complete" but Issue #50 is still open.
   - This is a known transient state documented in this handoff.
   - Resolution: merge PR #62 → close #50 → update Linear.

4. **Branch protection absent** despite CURRENT_STATE.md referencing it as a follow-up.
   - This is tracked in ST-72 / GitHub #60.
   - Resolution: Owner configures via GitHub UI per #60 checklist.

5. **`STAFF_TOKEN_NO_HISTORY_EDIT` not configured** despite workflow referencing it.
   - This is tracked in ST-73 / GitHub #61.
   - Resolution: Owner creates temporary staff account + configures secret per #61 checklist.

---

## Quick reference

| What | Where |
|---|---|
| This handoff | `process/RESTART_HANDOFF.md` |
| Current state | `process/CURRENT_STATE.md` |
| AI entry point | `AGENTS.md` |
| Completion contract | `process/DEFINITION_OF_DONE.md` |
| Core issue | GitHub #50 |
| Branch protection follow-up | Linear ST-72 / GitHub #60 |
| Production 403 follow-up | Linear ST-73 / GitHub #61 |
| Closure documentation PR | GitHub #62 |
| Production smoke workflow | `.github/workflows/production-smoke.yml` |
| PostgreSQL runtime workflow | `.github/workflows/st71-postgres-runtime.yml` |

---

*This file is self-contained. No workspace memory, terminal history, or local notes are required to resume.*
