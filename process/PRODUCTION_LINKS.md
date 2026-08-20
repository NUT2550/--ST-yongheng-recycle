# Production Links — YH Stock System

> Durable links and routes reference. Current route / status snapshots must be verified from current code / tests on the exact branch / head.
> Last reconciled: 2026-08-20 (ST-76 Governance Reconciliation v2)

## 1. Application

| Item | URL |
|---|---|
| **Production app** | https://st-yongheng-recycle.vercel.app |
| **Login page** | https://st-yongheng-recycle.vercel.app/ (auto-redirect) |
| **API base** | https://st-yongheng-recycle.vercel.app/api |
| **Health check** | https://st-yongheng-recycle.vercel.app/ (must return 200 even without login) |

## 2. Source code

| Item | URL |
|---|---|
| **GitHub repo** | https://github.com/NUT2550/--ST-yongheng-recycle |
| **Default branch** | `main` (Vercel auto-deploys from merges into `main`; direct push to `main` is prohibited — see `process/GOVERNANCE.md`) |
| **Commit history** | https://github.com/NUT2550/--ST-yongheng-recycle/commits/main |

> ⚠️ The repo name has a `--` prefix (GitHub default when the name starts with a hyphen).

## 3. Vercel

| Item | Value |
|---|---|
| **Project name** | st-yongheng-recycle |
| **Dashboard URL** | https://vercel.com/dashboard (login with the Owner's GitHub account) |
| **Project URL** | bound to repo `NUT2550/--ST-yongheng-recycle` |
| **Auto-deploy** | every merge into `main` → Vercel build (direct push to `main` is prohibited; deploy is Owner-gated — see `process/SAFETY_CHECKLIST.md`) |
| **Build command** | `next build` (from `package.json` `build` script) |
| **Output mode** | `standalone` (from `next.config.ts`) |

## 4. Supabase

| Item | URL |
|---|---|
| **Project dashboard** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx |
| **SQL Editor (new query)** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/sql/new |
| **Table editor** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/editor |
| **Database backups** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/database/backups |
| **Auth settings** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/auth/users |
| **Project settings** | https://supabase.com/dashboard/project/wefqhunzjvsxciiwdhjx/settings |

### Project ref

```
wefqhunzjvsxciiwdhjx
```

> The Supabase project ref is a project identifier, not a secret. Connection strings, passwords, service-role keys, and `DATABASE_URL` values are secrets and must never appear in docs.

## 5. Local development (sandbox only)

| Item | URL / Path |
|---|---|
| **Local app** | http://localhost:3000 |
| **Local DB** | Use an isolated local SQLite or local PostgreSQL fixture. Do not assume a fixed sandbox path — determine the actual working directory from the current clone. Do not edit the tracked `prisma/schema.prisma` provider to SQLite for routine local testing. |
| **Caddy gateway** | http://localhost:81 (sandbox — proxy to port 3000) |

Local commands are sandbox-only. They do not authorize Production access. See `process/DEPLOYMENT_RUNBOOK.md` §10.

## 6. API routes (Production)

Base URL: `https://st-yongheng-recycle.vercel.app/api`

> The route list below is a discovery reference. Verify the exact current route set, method, and behavior from `src/app/api/**/route.ts` on the exact branch / head before relying on it.

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Login → token |
| GET | `/api/auth/me` | Verify current token |
| POST | `/api/auth/logout` | Logout (client-side clears token) |

### Bills
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/buy-bills` | Create BuyBill |
| GET | `/api/buy-bills` | List BuyBills (paginated) |
| POST | `/api/sell-bills` | Create SellBill (FIFO) |
| GET | `/api/sell-bills` | List SellBills |
| POST | `/api/sorting-bills` | Create SortingBill (FIFO source + add output) |
| GET | `/api/sorting-bills` | List SortingBills |
| DELETE | `/api/buy-bills/{id}` | Cancel BuyBill (soft delete + stock restore) |
| DELETE | `/api/sell-bills/{id}` | Cancel SellBill (soft delete + stock restore + credit delete) |
| DELETE | `/api/sorting-bills/{id}` | Cancel SortingBill (ST-70 atomic transaction) |

### Master data
| Method | Path |
|---|---|
| GET / POST | `/api/products` |
| GET / PATCH / DELETE | `/api/products/{id}` |
| GET / POST | `/api/customers` |
| GET / POST | `/api/employees` |
| GET / PATCH / DELETE | `/api/employees/{id}` |
| GET / POST | `/api/users` |
| GET / PATCH / DELETE | `/api/users/{id}` |

### Operations
| Method | Path |
|---|---|
| GET | `/api/stock` |
| GET | `/api/dashboard` |
| GET | `/api/credit` |
| POST | `/api/credit/{id}/pay` |
| GET | `/api/bonuses` |
| POST | `/api/bonuses` |
| GET / PATCH / DELETE | `/api/bonuses/{id}` |
| GET | `/api/bonus-calculation` |

### Import
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/excel/parse` | Parse Excel file → preview rows |
| POST | `/api/import/apply` | Apply an import batch |
| POST | `/api/import/check-duplicates` | Check duplicates during import |

> Import route existence and behavior must be verified from current code on the exact branch / head. ST-75 / PR #81 added import reliability + auth/session containment; current status is documented in `process/CURRENT_STATE.md`.

## 7. Notes

- Every API route (except `/api/auth/login`) requires `Authorization: Bearer <token>` header.
- Token is obtained from `POST /api/auth/login` and stored in `localStorage` under the key defined in `src/lib/auth-constants.ts`.
- Production verification of any mutating route requires explicit Owner approval — see `process/SAFETY_CHECKLIST.md` §E.
