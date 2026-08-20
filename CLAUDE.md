# CLAUDE.md — AI Entry Point (Legacy Compatibility)

> **⚠️ This file is retained for backward compatibility only.**
>
> **The canonical AI entry point is `AGENTS.md`.**
> Read `AGENTS.md` first. This file defers to it.
>
> For conflict resolution and authority hierarchy, see `process/GOVERNANCE.md`.

## Project Identity

- **Name**: ยงเฮง มหาชัย รีไซเคิล (Yongheng Mahachai Recycle)
- **Tech**: Next.js 16 + Prisma 6 + Supabase PostgreSQL + TypeScript
- **Deploy**: Vercel at https://st-yongheng-recycle.vercel.app
- **GitHub**: https://github.com/NUT2550/--ST-yongheng-recycle

## Canonical AI Reading Order

1. `AGENTS.md` — mandatory entry point, safety rules, working method
2. `process/GOVERNANCE.md` — authority hierarchy, conflict resolution
3. `process/CURRENT_STATE.md` — current main SHA, Production SHA
4. Task-specific code, tests, issues, PRs
5. `knowledge/` — durable technical knowledge

> `worklog.md` is retained as historical evidence but is **not** a source of current truth. Do not use it as the primary context source.

## Safety Rules (Summary)

- Never commit `.env`, secrets, tokens, or Production dumps
- Git email must be `207142776+NUT2550@users.noreply.github.com`
- Prisma provider must remain `postgresql` in production schema
- No direct push to `main` — merge via Owner-approved PR only
- No force-push or history rewrite
- No Production mutation without explicit Owner approval
- No migration/deploy/rollback without explicit Owner approval

> Full safety rules and working method: see `AGENTS.md`.
> Full authority hierarchy and conflict resolution: see `process/GOVERNANCE.md`.
