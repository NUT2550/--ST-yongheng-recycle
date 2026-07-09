# Task 69: Debug Task 68 Classification Fix Not Visible on Production UI

**Production classification display fix in progress. Stock quantities were not changed.**

## 1. Root Cause

**Vercel production deployment is STALE** — running a ~26-hour-old deployment from before Task 68.

Task 68 pushed commit `303bbf6` to GitHub main with all classification fix code (schema field, API filter, UI merge logic). However, Vercel did NOT auto-deploy this commit. The production serverless functions are still running pre-Task-68 code:
- Prisma client on Vercel does not know about `businessType` column → field is MISSING from API responses
- API route on Vercel does not include `businessType` query filter → all calls return same 6 unfiltered records
- History page on Vercel does not pass `businessType` param → both tabs fetch same unfiltered list

## 2. Stale Deployment (NOT API/UI/DB Mismatch)

| Layer | Status | Details |
|---|---|---|
| Production DB | ✅ CORRECT | businessType column exists; 3 records have correct values (00006=แกะของ, 00008=คัดแยก, 00009=คัดแยก) |
| GitHub main code | ✅ CORRECT | Commit `139139f` includes all Task 68 changes (5 files) |
| Local code | ✅ CORRECT | All 4 files verified to have businessType logic |
| Vercel production | ❌ STALE | Deployment age ~26.3 hours; businessType missing from API; filter ignored |

## 3. Exact Fix Applied

### Step 1: Verified production DB — no changes needed

| Bill Number | businessType | Expected | Status |
|---|---|---|---|
| TRN-2569-00006 | แกะของ | แกะของ | ✅ MATCH |
| TRN-2569-00008 | คัดแยก | คัดแยก | ✅ MATCH |
| TRN-2569-00009 | คัดแยก | คัดแยก | ✅ MATCH |

**No DB changes were needed** — the DB was already correct from Task 68.

### Step 2: Pushed trigger commit to force Vercel rebuild

- Added a comment to `src/app/api/stock-transfers/route.ts`
- Committed as `139139f` — "Task 69: Rebuild trigger for Vercel"
- Pushed to GitHub main: `303bbf6..139139f main -> main`
- This forces Vercel to rebuild. The build script (`prisma generate && next build`) regenerates the Prisma client with the `businessType` field.

### Step 3: No code changes needed

All code was already correct from Task 68. No additional code changes were required.

## 4. Deployment Status

| Item | Value |
|---|---|
| Trigger commit on GitHub | ✅ `139139f` pushed to main |
| Vercel auto-deploy | ⏳ PENDING — Vercel has not yet deployed the new commit |
| Current production deployment age | ~94,524s (~26.3 hours) — unchanged |
| Production API still stale | ❌ YES — businessType missing, filter ignored |

**Owner action required:** If Vercel does not auto-deploy within 15 minutes:
1. Go to https://vercel.com/dashboard → select the project
2. Check "Deployments" tab for build status
3. If failed/stuck, click "Redeploy" with cache cleared
4. Wait 2-5 minutes for build, then refresh production

## 5. Production API Verification

### Before fix (current stale state):

| Endpoint | Total | businessType in response | Status |
|---|---:|---|---|
| `?businessType=คัดแยก` | 6 | MISSING | ❌ Filter ignored — returns all 6 records |
| `?businessType=แกะของ` | 6 | MISSING | ❌ Filter ignored — returns all 6 records |
| No filter | 6 | MISSING | ⚠️ Returns all 6 (UI should not use unfiltered) |
| `/api/sorting-bills` | 135 | n/a | ✅ Correct — SortingBills unchanged |

### Expected after Vercel deploys commit 139139f:

| Endpoint | Expected Total | businessType in response | Expected Status |
|---|---:|---|---|
| `?businessType=คัดแยก` | 2 | present (= คัดแยก) | ✅ Returns only 00008, 00009 |
| `?businessType=แกะของ` | 4 | present (null or แกะของ) | ✅ Returns 00010, 00006, 00005, 00002 |
| No filter | 6 | present | ✅ Returns all 6 |
| `/api/sorting-bills` | 135 | n/a | ✅ Unchanged |

## 6. Where Each Bill Appears Now (DB-level, correct)

| Bill Number | businessType | คัดแยก tab (expected) | แกะของ tab (expected) | Double-counted? |
|---|---|---|---|---|
| TRN-2569-00006 | แกะของ | ❌ No | ✅ YES | No |
| TRN-2569-00008 | คัดแยก | ✅ YES | ❌ No | No |
| TRN-2569-00009 | คัดแยก | ✅ YES | ❌ No | No |

**Note:** These are the DB-level correct values. The production UI will display correctly ONCE Vercel deploys commit `139139f`. Until then, the production UI will still show all 3 records in the แกะของ tab (stale behavior).

## 7. Confirmation

| Invariant | Status |
|---|---|
| No stock changed | ✅ CONFIRMED (552312.3 kg unchanged) |
| No duplicate records created | ✅ CONFIRMED (each target appears exactly once) |
| No records recreated | ✅ CONFIRMED (no records created or deleted) |
| No BuyBills modified | ✅ CONFIRMED (158 unchanged) |
| No SellBills modified | ✅ CONFIRMED (18 unchanged) |
| No StockLots created/modified | ✅ CONFIRMED (1115 unchanged) |
| No SortingBills created/modified | ✅ CONFIRMED (144 unchanged) |
| No products changed | ✅ CONFIRMED (113 unchanged) |
| DB businessType values correct | ✅ CONFIRMED (00006=แกะของ, 00008=คัดแยก, 00009=คัดแยก) |
| GitHub code correct | ✅ CONFIRMED (commit 139139f on main) |
| Vercel production deployment | ⏳ PENDING (owner needs to verify/redeploy via Vercel dashboard) |

## 8. All StockTransfers by businessType (DB-level)

| businessType | Count | Records |
|---|---:|---|
| null | 7 | TRN-2569-00010, TRN-2569-00007, TRN-2569-00005, TRN-2569-00004, TRN-2569-00002, TRN-2569-00003, TRN-2569-00001 |
| คัดแยก | 2 | TRN-2569-00009, TRN-2569-00008 |
| แกะของ | 1 | TRN-2569-00006 |

## 9. Output Files

All in `debug/task68-production-visibility-fix/`:
1. `PRODUCTION_DEPLOYMENT_CHECK.md` — Vercel deployment status and GitHub state
2. `PRODUCTION_DB_BUSINESS_TYPE_CHECK.csv` — DB values for 3 target records
3. `PRODUCTION_API_CHECK.csv` — Production API responses (stale)
4. `UI_CODE_CHECK.md` — Local/GitHub code verification (correct)
5. `FIX_APPLIED.md` — Root cause and fix details
6. `SAFETY_CHECK.csv` — All invariants PASS
7. `FINAL_REPORT.md` — This file

---

**Production classification display fix in progress. Stock quantities were not changed.**

**Next step:** Owner needs to verify Vercel deployment of commit `139139f`. Once deployed, the production History page will correctly show TRN-2569-00008 and TRN-2569-00009 in the คัดแยก tab, and TRN-2569-00006 in the แกะของ tab.
