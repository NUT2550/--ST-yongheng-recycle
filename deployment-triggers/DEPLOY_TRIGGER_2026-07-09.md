# Deployment Trigger — 2026-07-09

## Purpose
Trigger Vercel production deployment with a verified Git author email.

## Background
Previous commits (303bbf6, 139139f, 82d8b97) were authored with `noreply@zai.dev`,
which Vercel could not match to a GitHub account, blocking the deployment.

This commit is authored with the owner's GitHub-verified email to unblock Vercel.

## Code Changes
None — this is a documentation-only trigger file. No application logic, database,
or stock changes are involved.

## Expected After Deploy
- Production API `/api/stock-transfers?businessType=คัดแยก` returns TRN-2569-00008, TRN-2569-00009
- Production API `/api/stock-transfers?businessType=แกะของ` returns TRN-2569-00006 (excludes 00008/00009)
- Production History page คัดแยก tab shows TRN-2569-00008 and TRN-2569-00009
- Production History page แกะของ tab shows TRN-2569-00006
