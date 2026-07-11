# Fix Applied

## Root Cause

**Vercel production deployment is STALE.** The production serverless functions are running pre-Task-68 code:
- The Prisma client on Vercel does not know about the `businessType` column (generated before Task 68 schema change)
- The API route code on Vercel does not include the `businessType` query filter
- The History page UI on Vercel does not pass the `businessType` param

The DB is correct (businessType column exists, 3 records have correct values). The code on GitHub is correct. Only the Vercel deployment is lagging.

## Classification: Stale Deployment (NOT API/UI/DB mismatch)

| Layer | Status |
|---|---|
| Production DB | ✅ CORRECT — businessType column exists, 3 records have correct values |
| GitHub main code | ✅ CORRECT — commit 139139f includes all Task 68 changes |
| Local code | ✅ CORRECT — all 4 files have businessType logic |
| Vercel production deployment | ❌ STALE — running ~26-hour-old deployment (pre-Task-68) |

## Exact Fix Applied

### Step 1: Verified production DB (no changes needed)

Queried production Supabase DB directly:
- `businessType` column EXISTS on `StockTransfer` table ✅
- TRN-2569-00006: businessType = `แกะของ` ✅
- TRN-2569-00008: businessType = `คัดแยก` ✅
- TRN-2569-00009: businessType = `คัดแยก` ✅

**No DB changes were needed.** The DB was already correct from Task 68.

### Step 2: Pushed trigger commit to force Vercel rebuild

Added a comment to `src/app/api/stock-transfers/route.ts` and committed:
- Commit: `139139f` — "Task 69: Rebuild trigger for Vercel — ensure Prisma client regenerates with businessType"
- Pushed to GitHub main: `303bbf6..139139f main -> main`
- This forces Vercel to rebuild the project. The build script runs `prisma generate && next build`, which regenerates the Prisma client with the `businessType` field.

### Step 3: No code changes needed

All code (API filter, UI merge logic, TypeScript types) was already correct from Task 68. No additional code changes were required.

## Deployment Status

| Item | Value |
|---|---|
| Trigger commit pushed | ✅ `139139f` on GitHub main |
| Vercel auto-deploy triggered | ⏳ PENDING — Vercel has not yet deployed the new commit |
| Current production deployment age | ~94,524 seconds (~26.3 hours) — unchanged since before Task 68 |
| Production API still stale | ❌ YES — businessType missing, filter ignored |

## Owner Action Required

If Vercel does not auto-deploy within 15 minutes of the push:
1. Go to https://vercel.com/dashboard
2. Select the `--ST-yongheng-recycle` project
3. Check the "Deployments" tab for the latest build status
4. If the build failed or is stuck, click "Redeploy" with "Use existing build cache" turned OFF
5. Wait for build completion (2-5 minutes)
6. Refresh the production History page to verify

## What Does NOT Need to Change

- ❌ DB values — already correct
- ❌ Code (API/UI/types) — already correct on GitHub
- ❌ Stock quantities — unchanged
- ❌ Records — not recreated, not modified
