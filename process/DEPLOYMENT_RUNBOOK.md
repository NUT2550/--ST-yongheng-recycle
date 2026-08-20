# Deployment Runbook — YH Stock System

> Current release/deployment handoff. Historical direct-main-push, auto-deploy-by-merge, and ad-hoc Production migration instructions remain in Git history only and must not be treated as current policy.
> Last reconciled: 2026-08-20 (ST-76 separate Merge/Deploy gate follow-up)

## 1. Authority

Read before any release work:

1. `AGENTS.md`
2. `process/GOVERNANCE.md`
3. `process/CURRENT_STATE.md`
4. `process/SAFETY_CHECKLIST.md`
5. current task issue/PR and exact-head CI

This runbook does **not** authorize merge, deploy, Production access, migration, rollback, credential action, or repository settings changes. Those remain Owner-gated per `process/GOVERNANCE.md` §4.

## 2. Release flow

Current flow:

```text
bounded branch from exact current main
→ Draft PR
→ targeted and full validation (lint / tsc / tests / build / foundation)
→ exact-head CI
→ fresh independent review
→ Owner Ready approval
→ Owner merge approval
→ approved PR merge into main (squash, head-guarded)
→ STOP: no Production deployment from merge alone
→ separate Owner Deploy approval
→ approved manual Vercel Production deploy/promote path
→ separately approved Production verification when applicable
→ observation / write-back when applicable
```

Direct push to `main` is prohibited. There is no staging branch.

### Enforced Vercel Git behavior

Tracked `vercel.json` must keep automatic Git deployment from `main` disabled:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

This preserves the ability to use non-`main` Preview deployments while ensuring a merge to `main` does **not** itself authorize or trigger a Production deployment.

Changing/removing this control, or changing the Vercel project setting to re-enable automatic `main` deployment, is a release-policy/settings change and requires explicit Owner approval.

## 3. Before requesting Ready

- [ ] Scope matches the issue / Owner intent.
- [ ] Root cause or business rule is proven / confirmed as applicable.
- [ ] Regression / feature tests exist for required behavior.
- [ ] Targeted tests pass.
- [ ] Full validation passes:

```bash
bun run lint
npx tsc --noEmit
bun test
bun run build
bash scripts/validate-foundation.sh
```

- [ ] Credential scan required by repository policy passes (ST-27).
- [ ] `git diff --check` passes.
- [ ] Staged diff contains no `.env`, secret, `db/custom.db`, Production dump, or other sensitive artifact.
- [ ] Exact-head CI passes (Foundation, Lint, TypeScript Typecheck, Unit Tests, Production Build, ST-27 Credential Scan).
- [ ] Fresh exact-head independent review is complete; no unresolved P0/P1 finding remains.
- [ ] Release / rollback / Production verification plan is documented.
- [ ] Tracked `prisma/schema.prisma` provider remains `postgresql`.
- [ ] If deployment behavior is in scope, tracked `vercel.json` still enforces `main: false` unless the Owner explicitly approved a different release model.

PR remains Draft until the Owner approves Ready.

## 4. Schema / database release work

The tracked Production Prisma schema must remain PostgreSQL.

- Do not switch the tracked `prisma/schema.prisma` provider to SQLite.
- Tests needing an alternate database must use isolated fixtures or test-specific configuration that cannot alter the committed Production schema.
- Migration requires explicit Owner approval for the specific task.
- Production query, write, or data correction requires explicit Owner approval.
- Follow `process/SAFETY_CHECKLIST.md` for migration and runtime gates.
- Never run `prisma migrate reset`, `prisma db push --force-reset`, or seed scripts against Production.
- Never use Supabase SQL Editor as a normal shortcut for tracked schema changes.

## 5. Merge

Merge is Owner-gated.

- Use the approved PR workflow only.
- Confirm the exact PR head before merge.
- Do not bypass branch protection.
- Do not force-push or rewrite history.
- Do not use `git push origin main` as a release step.
- Do not merge while required exact-head CI is pending or failing.
- **Merge approval ends at the Git merge. It does not authorize a Vercel Production deploy.**
- After merge, verify that no automatic `target=production` deployment was created from `main`. If one appears unexpectedly, stop and record it as a release-policy violation/side effect.

## 6. Deploy

Deploy is a **separate Owner gate after merge**.

Before requesting / performing deploy:

- [ ] merge identity is known and recorded
- [ ] exact `main` SHA to deploy is confirmed from GitHub
- [ ] explicit Owner Deploy approval names the intended release/commit
- [ ] expected Vercel project and Production target are known
- [ ] migration ordering (if any) is explicitly approved and completed first
- [ ] rollback plan is ready
- [ ] Production verification plan is ready and approved where mutation is involved

Approved deploy paths are manual/explicit Vercel actions such as a controlled Production deploy or promotion of a known deployment. Automatic Git deployment from `main` is not an approved release path.

After deploy:

- [ ] confirm Vercel deployment identity, Git SHA, target=`production`, and READY/success state
- [ ] confirm the production alias/domain points to the intended deployment when evidence is available
- [ ] run only the approved Production verification
- [ ] stop on any unexpected response / state
- [ ] record verified / not-verified status accurately — never claim Production verification that did not occur

## 7. Production verification

Production verification is **not** automatic. Default to non-mutating checks.

### Read-only checks (preferred)

Examples that do not require separate Production-write approval:

- deployment identity / version
- login page / auth behavior using an approved test path
- endpoint status / error contract (e.g. 401 without token, 403 with valid token lacking permission)
- page / runtime health
- read-only history / query verification

### Mutating checks (require separate explicit Owner approval)

Any test that creates, edits, cancels, transfers, sorts, imports, adjusts, or otherwise mutates Production data requires **separate explicit Owner approval for that exact verification**. This includes:

- creating test bills or stock movements
- Buy / Sell / Sorting smoke tests that write to Production
- cancel tests against Production bills
- Excel import against Production
- direct SQL writes
- any POST / PUT / PATCH / DELETE against Production endpoints

Read-only approval does **not** imply mutating approval. Each gate is separate.

## 8. Rollback

Rollback affecting `main`, deployment, database, or Production is Owner-gated.

- Prefer a reviewed revert through the PR / repository workflow.
- Do not directly push a revert to `main`.
- Do not rewrite history.
- Database recovery must use the task-specific approved recovery plan.
- Do not normalize destructive rollback SQL (e.g. `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`) as an automatic response to incidents.
- If safe rollback is uncertain, stop and request Owner decision rather than guessing.

## 9. Environment variables

Required environment variables (names only — never values in docs):

| Name | Used by | Required? |
|---|---|---|
| `DATABASE_URL` | `prisma/schema.prisma` + `src/lib/db.ts` | ✅ Prisma cannot connect without it |
| `JWT_SECRET` | `src/lib/auth.ts` | ✅ Auth throws on every request without it |

- Production values are stored only in Vercel environment variables and Supabase configuration.
- Local sandbox `.env` uses non-Production placeholders only.
- Never commit `.env`. `.gitignore` blocks `.env*`.
- `.env.example` may contain only unusable placeholders.

## 10. Local development commands (sandbox only)

These commands are for local sandbox development only. They do not authorize Production access.

```bash
bun install --frozen-lockfile
bun run db:generate
bun run dev          # Start dev server on port 3000
bun run lint
npx tsc --noEmit
bun test
bun run build        # Avoid in sandbox — prefer `bun run dev`
```

Local database setup (sandbox only — never Production):

- Use an isolated local SQLite or local PostgreSQL fixture.
- Do not edit the tracked `prisma/schema.prisma` provider to SQLite for routine local testing.
- `bun run db:push` only against the local sandbox database.

## 11. Evidence / write-back

Record as applicable:

- exact PR / head / merge identity
- exact Git `main` SHA at the time of the gate
- validation and CI actually run (not checks claimed without running)
- Vercel deployment identity / Git SHA / target when deploy is performed
- migration status
- deploy status
- Production verification status: verified / not verified / not applicable
- remaining risks / unknowns
- observation status
- next safe gate

Write back only to the source systems whose canonical state changed:

- GitHub for technical evidence / policy
- Linear for task state or gate
- Notion for durable Owner / business context (never raw logs, transcripts, or duplicate technical policy)

## 12. Absolute prohibitions

- ❌ Direct push to `main`
- ❌ Force-push or history rewrite
- ❌ Treat Merge approval as Deploy approval
- ❌ Automatic Git-triggered Production deployment from `main` as the normal release path
- ❌ `prisma migrate reset` or `prisma db push --force-reset` against Production
- ❌ Seed Production (`bun run prisma/seed.ts` is local only)
- ❌ Hard-delete bills, stock, or audit history in Production
- ❌ Direct stock / cost correction via SQL in Production
- ❌ Switch tracked `prisma/schema.prisma` provider to SQLite and commit
- ❌ Commit `.env`, `db/custom.db`, Production dumps, secrets, or credentials
- ❌ Deploy while required exact-head CI is pending or failing
- ❌ Mark Ready / merge / deploy without the corresponding explicit Owner approval
- ❌ Treat read-only Production verification as authorization for mutating Production verification

## Key takeaway

**Merge and Deploy are separate Owner gates. A validated PR may be merged only with Merge approval; Production changes only after a separate Deploy approval through an explicit Vercel action. `main` Git auto-deploy must remain disabled.**
