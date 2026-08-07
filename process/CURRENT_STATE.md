# Current State — YH Stock System

> Concise current technical state only. No progress diary. No historical issue list.
> Last reconciled: 2026-08-07

## Version identity

| Item | Current evidence |
|---|---|
| **Current `main`** | `9d6a416a866a3eeb6ece2e7354efb4a1bc855881` — squash merge of PR #79 (`fix(st-75): stop import flow on expired session + 403`) |
| **Previous main** | `2acae10c4ea1e970ee10d8ab4f4ccf69f88e6f7c` — ST-27 credential remediation |
| **Production URL** | https://st-yongheng-recycle.vercel.app |
| **Production deployment for current main** | Vercel status was `pending` at the 2026-08-07 governance-cleanup check; do not claim current-main Production verification until rechecked |
| **Governance cleanup PR** | #80, Draft, branch `policy/governance-reconciliation`; not merged |

`main` advanced by one commit from `2acae10...` to `9d6a416...` via merged PR #79. PR #80 was created from the previous main and must be synchronized/revalidated before any Ready/Merge request.

## Current active work visible in GitHub

### ST-75 — Excel import auth/session containment and remaining import reliability

- GitHub issue **#78** remains open.
- PR **#79** is merged into `main`.
- Verified code change from PR #79:
  - production frontend uses `classifyAuthResponse()`
  - 401 = session expired → clear token/user and close/reset import dialog
  - 403 = permission denied → do not clear valid token
  - 429/5xx = transient → do not clear auth state
  - purchase and sales detailed-import flows received the same containment pattern
- PR #79 explicitly leaves broader ST-75 scope open: AbortController/cancellation, partial-success reporting, durable idempotency, import performance, and Production verification.

Do not mark ST-75 complete from PR #79 alone.

### ST-63 — stock-transfer performance/concurrency follow-up

- PR **#77** remains open.
- It contains measurement/batching work and explicitly states that real PostgreSQL latency improvement and concurrent-request safety were not yet proven at the recorded checkpoint.
- Keep separate from ST-75 and governance cleanup.

### Governance reconciliation

- PR **#80** remains Draft.
- Purpose: clean stale/conflicting GitHub + Notion operating instructions before introducing a new optimized/agentic rule set.
- Documentation-only scope; no Production mutation, migration, deploy, or application-code change in this PR.

### Other open PRs

- PR **#73** is still open and appears to be a README revision without a verified current linked issue/gate in this cleanup. Treat as untriaged/secondary until separately reviewed; do not let it define current project state.

## Current governance baseline

Until PR #80 is merged, the repository `main` still contains the previously merged Push-Early policy from PR #76. On the governance-cleanup branch, the intended reconciled hierarchy is:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. this `process/CURRENT_STATE.md`
4. task-relevant canonical domain docs
5. current code/tests/issues/PRs
6. Notion `AI Read First — YH Stock System` / current Owner decisions when relevant

No direct main push. Merge/deploy/Production/migration remain Owner-gated.

## Current known durable technical facts

- Production database platform: Supabase PostgreSQL.
- Tracked `prisma/schema.prisma` Production provider must remain `postgresql`.
- ST-27 removed exposed Production DB credential values from tracked files and added credential scanning; the exposed credential had already been rotated.
- ST-62 durable stock-transfer idempotency was merged before ST-27.
- `add_weight_expression.sql` was explicitly **not** run during ST-62 and later schema-mismatch fixes; do not assume it has been applied unless newly verified.
- Historical July documentation that says Excel import is absent is stale: current repository has detailed purchase/sales import flows, and ST-75 is actively fixing their reliability/auth behavior.

## Production verification status

### Verified from current GitHub evidence

- PR #79 merged to `main` at `9d6a416...`.
- The merge commit states no Production access was performed as part of the fix.

### Not verified in this cleanup

- Whether Vercel deployment of `9d6a416...` has completed successfully.
- Whether PR #79 behavior has been exercised in Production after deploy.
- Current Production database schema/row counts.
- Whether `add_weight_expression.sql` has since been applied outside the evidence inspected here.

Do not infer any of these from code alone.

## Current safety/stop conditions

- No Production retry/data correction for ST-75 on behalf of Owner.
- No schema migration or Production write without explicit Owner approval.
- Stop on partial import, duplicate creation, auth-state ambiguity, unexpected 2xx/4xx/5xx, or mismatch between UI result and backend/history state.
- Keep unrelated root causes in separate issues/PRs.

## Next safe gates

1. **Governance cleanup PR #80**: finish stale-document cleanup, synchronize with current `main`, re-run exact-head checks, remain Draft until Owner review.
2. **ST-75 / #78**: continue only under its own scope/gates; PR #79 solved containment, not the entire import reliability problem.
3. **ST-63 / PR #77**: continue separately with the performance/concurrency validation defined there.

## References

- `AGENTS.md`
- `process/GOVERNANCE.md`
- `process/DEFINITION_OF_DONE.md`
- `process/SAFETY_CHECKLIST.md`
- GitHub issue #78 / PR #79 (ST-75)
- GitHub PR #77 (ST-63)
- GitHub PR #80 (governance cleanup)

## Key takeaway

**Current `main` is `9d6a416...`; ST-75 remains open beyond the merged auth-containment fix; governance cleanup is still Draft and must be rebased/synchronized before Ready. Production state beyond explicit evidence is not assumed.**