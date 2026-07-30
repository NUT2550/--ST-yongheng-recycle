---
id: ERR-STXX-SHORT-ID
type: incident
status: verified
area: example-area
title: One-line summary of the incident
date: YYYY-MM-DD
issue: ST-XX
pr: 0
commit: abc123
tags:
  - example
---

## Symptom

What the user or system observed. Be specific about error messages, HTTP status codes, and affected features.

## Root Cause

The proven root cause. Not a guess — must be backed by code inspection, test evidence, or Production verification.

## Fix

What was changed to resolve the root cause (not just the symptom).

## Files/Functions Affected

- `src/lib/example.ts` — `exampleFunction()` — what changed

## Regression Test

- `tests/example.test.ts` — `test that would fail before the fix and pass after`

## Prevention Control

What prevents this from recurring (CI check, invariant, code review checklist).

## Remaining Unknowns

- Anything not yet proven or still uncertain
