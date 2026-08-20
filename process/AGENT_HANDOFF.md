# Agent Handoff — YH Stock System

> Durable generic handoff contract for any AI agent taking over work on YH Stock System. Historical live-task / worklog / dated-feature-state snapshots remain available in Git history and must not be treated as current policy.
> Last reconciled: 2026-08-20 (ST-76 Governance Reconciliation v2)

## 1. Start here

Read in this order before acting:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. current `origin/main` exact SHA — verify with `git fetch origin && git rev-parse origin/main`
5. current Linear issue / GitHub issue / PR for the assigned task
6. task-relevant canonical domain docs:
   - `process/BUSINESS_RULES.md`
   - `process/DATABASE_CONTEXT.md`
   - `process/DEFINITION_OF_DONE.md`
   - `process/SAFETY_CHECKLIST.md`
   - `process/DEPLOYMENT_RUNBOOK.md`
   - `process/REPAIR_RUNBOOK.md`
7. related `knowledge/` records
8. current code / tests / CI on the exact branch / head
9. Notion `AI Read First — YH Stock System` and current Owner decisions when Owner / business context is relevant

Do **not** use this file as a substitute for current state evidence. Do **not** trust an old workspace, chat transcript, worklog, or local patch as current truth without re-verification.

## 2. Source of truth

| Source | Responsibility |
|---|---|
| GitHub | code, tests, CI, technical policy / docs, exact technical evidence, PR / commit history |
| Linear | task state, priority, blockers, acceptance criteria, current gate |
| Notion | durable Owner / business context, decisions, SOP / business memory, concise cross-system summaries |
| Production | live runtime / data evidence only — never inferred from code alone |

When sources conflict, follow `process/GOVERNANCE.md` authority hierarchy.

### Persistent execution state

The **GitHub remote branch / PR** is the persistent execution state. The local workspace is ephemeral — sandbox resets, terminal history loss, and AI memory loss do not lose work that has been pushed to a remote branch.

Do not treat old local patches, ZIPs, `public/` files, terminal scrollback, or chat transcripts as the current source of truth. Always re-verify from `git fetch origin` + `process/CURRENT_STATE.md` + the relevant GitHub PR / issue.

## 3. Core operating principles

- Correctness of stock, cost, ledger, history, and auditability over speed.
- Read-only investigation first for stock / data / Production-impacting work.
- Prove root cause before editing a defect.
- Keep scope bounded; unrelated root causes belong in separate issues / PRs.
- Distinguish `Verified`, `Inference`, `Unknown`, `Not verified`, `Superseded`, `Blocked`, and `Needs Owner Decision`.
- Never claim Production verification without Production evidence.
- Never treat a dated annotation as current truth without re-verification.

## 4. Git workflow

### Autonomous within a clear approved task scope

An AI agent may:

- fetch / reload current context
- create a bounded branch from exact current `main`
- push the initial branch checkpoint
- create focused commits
- fast-forward push focused checkpoints
- open / update a Draft PR
- create / comment on a GitHub issue when no duplicate exists
- inspect CI and fix failures caused by the in-scope change
- update affected technical documentation / knowledge

These actions do **not** authorize Production access, merge, deploy, or release.

### Owner approval required

Stop before:

- marking a PR Ready
- merge
- deploy
- Production connection / query / write
- Production data correction
- credential validation or rotation
- database migration
- rollback affecting `main` or Production
- direct push to `main`
- force-push / history rewrite
- repository visibility / settings / branch-protection changes
- closing GitHub / Linear work when closure is Owner-gated
- expanding scope into an unrelated issue / root cause

Direct push to `main` is prohibited. Changes reach `main` only through an Owner-approved PR merge.

## 5. Checkpoint policy for sandbox-hosted AI work

Sandbox / local state is ephemeral. GitHub remote branches are the persistent technical source of truth.

Before editing:

1. `git fetch origin`
2. verify exact `origin/main` SHA
3. check for duplicate branch / PR
4. create a bounded branch from exact current `main`
5. push the initial branch checkpoint

After each meaningful checkpoint, run the relevant minimum validation before push:

- credential / secret scan when available
- `git diff --check`
- lint / typecheck for changed scope
- targeted tests for changed behavior
- staged-diff review for `.env`, secrets, database dumps, customer data, or other sensitive artifacts

Full validation is **not** required for every checkpoint, but must pass before requesting Ready.

Emergency WIP checkpoints are allowed only when sandbox-reset risk is concrete and the staged diff passes secret / sensitive-data checks plus `git diff --check`. WIP must remain Draft and must not be represented as complete.

The full canonical Push-Early Checkpoint Policy is in §12 below.

## 6. Files and data that must never be pushed

- `.env` or real environment values
- passwords, tokens, API keys, connection strings
- GitHub / auth credential files
- `db/custom.db`
- Production database dumps
- raw customer / sensitive rows
- `node_modules/`
- `.next/`, `dist/`, build output
- large raw logs
- full chat transcripts
- repository ZIP / patch as the primary persistent artifact

`.env.example` is allowed only with unusable placeholders.

## 7. Prisma / database rule

The tracked Production Prisma schema must remain PostgreSQL.

- `prisma/schema.prisma` provider must remain `postgresql`.
- Do not switch the tracked Production schema provider to SQLite for routine local testing.
- Tests needing an alternate database must use isolated fixtures or test-specific configuration that cannot alter the committed Production schema.
- No Production migration or direct SQL mutation without explicit Owner approval.
- Never run destructive reset / seed operations against Production.

Historical guidance that instructed agents to temporarily edit the tracked Prisma provider to SQLite is superseded.

## 8. Defect workflow

For a bug / incident:

1. capture the reproducible symptom / evidence
2. inspect actual code / state without mutation where practical
3. separate verified facts from hypotheses / unknowns
4. prove root cause
5. create a bounded fix
6. add a regression test that fails before and passes after (or document an equivalent evidence exception when a traditional test is not technically possible)
7. run targeted validation
8. run full validation before Ready
9. perform fresh exact-head independent review
10. update affected canonical docs / knowledge
11. keep PR Draft until Owner gate

If a partial write, data mismatch, unexpected 2xx / 5xx, or unclear contract appears, stop the risky path and report evidence. Do not retry mutating Production operations to investigate.

## 9. Feature workflow

For new behavior:

- Owner confirms the business rule where required.
- Acceptance criteria and failure modes must be explicit.
- Auth / permission behavior must be defined and tested when relevant.
- Stock / cost / history effects must be documented and verified.
- Release / rollback impact must be documented.
- Full validation + exact-head CI + review are required before Ready.

## 10. Validation baseline

Use the commands applicable to the current repository state and scope. The normal full gate includes:

```bash
bun install --frozen-lockfile
bun run db:generate
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

Also run targeted tests and the credential scanner required by the changed scope.

Never report a check as PASS if it was not actually run. State the exact reason when an environment prevents a check.

## 11. End-of-task report / handoff package

Every task handoff should state:

1. Goal
2. Result
3. Verified discoveries
4. Errors / root causes
5. Files / functions changed
6. Tests / CI actually run and results
7. Production verification status (verified / not verified / not applicable)
8. Documentation / knowledge updates
9. Remaining risks / unknowns
10. Next safe gate

The handoff package should contain:

- objective
- exact head SHA
- diff scope
- tests actually run
- Production status
- remaining risks
- next gate

If work is unfinished but no new Owner decision, missing input, or Safety Gate is required, provide the next executable step. If an Owner decision / approval is required, stop at that gate.

## 12. Push-Early Checkpoint Policy (Sandbox-Hosted AI Work)

> **Effective:** Upon merge of PR #76
> **Approved by:** Owner (pending merge)
> **Applies to:** Z.AI work on YH Stock System repo (sandbox environment)
> **Canonical location:** This section is the canonical full text. `process/SAFETY_CHECKLIST.md` §I and `AGENTS.md` contain summaries that must be kept in sync with this section.

### Principle

Sandbox workspace is **ephemeral** — `/home/z/*`, `public/*`, local commits, and patch files can be lost without warning when the sandbox resets (observed 2026-08-05). All meaningful work must be pushed to GitHub as focused checkpoints immediately after minimum validation. GitHub remote branch is the persistent source of truth.

### Logical checkpoints

Break work into short, focused checkpoints. After each checkpoint passes minimum validation, commit + push immediately. Do **not** accumulate multiple checkpoints locally.

### Branch workflow (before editing files)

1. `git fetch origin`
2. Verify exact current `origin/main` SHA
3. Check for duplicate branch / PR
4. Create feature branch from exact main:
   - General work: `st-XX-short-description`
   - Security work: `security/short-description`
   - Policy / docs: `policy/short-description`
5. Push empty branch as first remote checkpoint
6. Then begin implementation

### Minimum validation before normal checkpoint push

Run the relevant subset:

- Credential / secret scan (if scanner exists)
- `git diff --check`
- Lint for changed scope
- TypeScript / typecheck for changed scope
- Targeted tests for changed code
- Verify staged diff has no `.env`, secret, database dump, or sensitive artifact

Full build / full test is **not** required for every checkpoint, but **must** pass before requesting PR Ready.

❌ Never report a check as PASS if it was not actually run.

### Emergency WIP checkpoint (when reset risk is imminent)

Emergency WIP is allowed **only** when there is concrete evidence that sandbox reset is imminent (e.g., explicit Owner warning, dev server process termination observed, or workspace files disappearing). The evidence must be stated in the WIP commit comment.

If sandbox reset is imminent and minimum validation is incomplete, an emergency WIP checkpoint is allowed **only if**:

- ✅ Secret scan passes
- ✅ Staged diff has no credential or sensitive data
- ✅ `git diff --check` passes

Commit format: `wip(st-XX): preserve validated partial progress`

- Push to feature branch only
- PR must remain Draft
- Add a comment listing which validations are still pending
- ❌ Never claim the checkpoint is complete
- Must complete missing validation + fix WIP in next session

**Never push** code that:

- Contains a secret
- Does not compile due to this change
- Has destructive behavior without guards
- Has unreviewed migration SQL

### Autonomous actions (no Owner approval needed per task with clear scope)

- Reload current context (fetch, read docs)
- Fresh clone
- Create feature branch from exact current main
- Push initial remote branch checkpoint
- Create focused commits
- Push checkpoint fast-forward
- Open Draft PR
- Create GitHub issue (when no duplicate found)
- Comment status in GitHub issue / PR
- Check CI status
- Fix failures caused by in-scope work
- Push focused follow-up commits
- Update PR body to match current exact head

### Actions still requiring explicit Owner approval

❌ Do **not** perform until Owner sends specific approval message:

- Mark PR Ready
- Merge
- Deploy
- Production connection / query / write
- Credential validation
- Database migration
- Git history rewrite
- Force-push
- Direct main push
- Close GitHub issue / PR
- Close Linear issue
- Change repository visibility
- Change branch protection
- Change repository settings
- Rotate credentials
- Expand scope to other issues

### Files that must NEVER be pushed

- `.env` or env file with real values
- Passwords, tokens, API keys, connection strings
- `db/custom.db`
- Production database dumps
- Customer data or raw sensitive rows
- `node_modules/`
- `.next/`, `dist/`, build output
- Raw logs of significant size
- Full chat transcript
- Local credential files
- GitHub auth token
- Patch / ZIP containing repository or sensitive artifacts
- Local progress diary duplicating GitHub content

`.env.example` is allowed only with placeholders that cannot be used as real credentials.

### Authentication rules

If GitHub auth is missing or expired:

- Stop before creating meaningful local work
- Request Owner to perform GitHub device login
- ❌ Never request PAT / token in chat
- ❌ Never create patch / ZIP as primary workaround
- After auth succeeds: create remote branch **before** starting implementation

If `workflow` permission is missing:

- Do not push changes to `.github/workflows/*`
- Quarantine workflow changes separately
- Other work can proceed when safe
- Report to Owner to request permission

### CI rules

After every push:

- Check CI on exact head
- Failure from in-scope work → fix + push focused follow-up (autonomous)
- Infrastructure failure → rerun once (autonomous)
- Pre-existing unrelated failure → document evidence, do **not** fix out of scope
- PR must remain Draft until full validation + independent review pass

### Source-of-truth rules

- **GitHub** = code, technical docs, exact commits, tests, CI, detailed evidence
- **Linear** = task status, priority, blocker, acceptance criteria, branch / PR links, next gate
- **Notion** = durable Owner decisions, policy, high-level project checkpoint

❌ Never write raw logs, secrets, command transcripts, or duplicate progress diary into Notion / Linear.

### Patch / ZIP is secondary only

Patch / ZIP files may be created as a **backup copy** only **after** work is pushed to GitHub. They must never be the primary artifact. Do not rely on `public/` directory for delivery — Preview Panel access is not guaranteed.

### Rollback

- On branch (not main): `git revert <commit>` if a checkpoint introduces a problem
- On main (after merge, requires Owner approval): `git revert` on main → Vercel auto-redeploy

### No Production impact

This policy does not authorize any Production access. Production connection, query, write, migration, deploy, and credential validation remain Owner-gated.

## Key takeaway

**Reload current truth from GitHub + `CURRENT_STATE.md` + the relevant PR / issue. Work on a bounded remote branch. Prove and test changes. Push focused checkpoints under the Push-Early policy. Keep Ready / Merge / Deploy / Production / Migration / Rollback / Credential / Repository-settings behind explicit Owner gates. Never alter the tracked Production Prisma schema to SQLite. Never trust an old workspace, chat transcript, or worklog as current truth.**
