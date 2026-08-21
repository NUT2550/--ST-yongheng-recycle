## Linked Issue

- Linear: ST-XX
- GitHub Issue: #XX
- Related PRs: #(if any)

## Goal and Bounded Scope

<!-- What does this PR achieve? What is intentionally out of scope? -->

## Proven Root Cause or Business Requirement

<!-- For a bug fix: what is the proven root cause? For a feature: what business rule? -->

## Files/Functions Changed

<!-- List each file and what changed -->

## Stock/Cost/History Impact

<!-- Does this change stock balances, cost calculations, or history display? If no, state "No impact". -->

## Auth/Permission Impact

<!-- Does this change auth behavior, permission checks, or error codes? If no, state "No impact". -->

## Tests Added

<!-- What regression tests were added? What would fail before the fix? -->

## Before-Fix Failure Evidence

<!-- Show that the test fails before the fix (or describe the old behavior) -->

## Validation and CI

- [ ] `bun run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `bun test` passes (full suite)
- [ ] `bun run build` passes (non-Production placeholders)
- [ ] Exact-head CI all green
- [ ] `git diff --check` passes

## Production Verification Status

<!-- Mark one: -->
- [ ] Not applicable (documentation-only or non-Production change)
- [ ] Not yet verified (code merged but Production check pending)
- [ ] Verified (attach HTTP status + response code evidence below)

<!-- If verified, paste evidence here. Do NOT claim "Production verified" without evidence. -->

## Documentation Updated

- [ ] `process/CURRENT_STATE.md` updated if state changed
- [ ] `process/BUSINESS_RULES.md` updated if business rule changed
- [ ] `process/FEATURE_INVENTORY.md` updated if feature status changed
- [ ] Affected docs reconciled against code

## Migration/Deploy/Rollback Requirements

- [ ] No migration required
- [ ] Production deploy is not required, or a separate explicit Owner Deploy approval is recorded before any Production deploy/promote action
- [ ] Rollback plan uses a bounded revert PR (no direct push to `main`), Owner-approved merge, then a separate explicit Owner Deploy approval for the manual Vercel Production deploy/promote step

<!-- If migration IS required, describe it here and note Owner approval status -->

## Remaining Risks

<!-- What is still uncertain or pending? -->

## Owner Approval Gates

<!-- State the applicable gates explicitly. Mark Ready, Merge, and Deploy are separate Owner decisions; Merge approval does not imply Deploy approval. -->

## Safety Checklist

- [ ] No `.env`, `db/custom.db`, tokens, or secrets in diff
- [ ] No schema/migration change without Owner approval
- [ ] No unrelated changes
- [ ] No `.skip` or `.only` in tests
- [ ] PR remains Draft until review passes
