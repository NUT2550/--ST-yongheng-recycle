# Sorting Owner Review Pack — Index

**Task 48**: Create Owner Review Lists From Sorting Verification Task 47
**Status**: REVIEW / REPORT ONLY — No production data modified.

## Files in This Pack

| # | File | Description | Items |
|---|---|---|---:|
| 1 | PDF_ONLY_15_OWNER_REVIEW.csv + .md | PDF events not in MetalTrack | 15 |
| 2 | METALTRACK_ONLY_AFTER_2026_06_27.csv | MT events after 27/06/2569 (likely OK) | 7 |
| 3 | METALTRACK_ONLY_ON_OR_BEFORE_2026_06_27_NEEDS_REVIEW.csv | MT events on/before 27/06/2569 | 74 |
| 4 | METALTRACK_ONLY_81_SUMMARY.md | Summary of all 81 MT-only events | — |
| 5 | WEIGHT_ANOMALY_07012569_DETAIL.csv + .md | Weight anomaly: 34.2→126.4 kg | 1 |
| 6 | UNIQUE_PRODUCT_NAME_REVIEW.csv + .md | Unique OCR product names | 35 |
| 7 | CANDY_COPPER_CURRENT_SCOPE_REVIEW.csv + .md | Candy copper scope check | 4 (1 current) |

## Recommended Owner Review Order

1. **PDF-only 15 events** — decide: create in MetalTrack / ignore / PDF parse error
2. **MetalTrack-only on/before 27/06/2569** (74 events) — decide: keep / delete / merge / correct
3. **07/01/2569 weight anomaly** — review original PDF, decide if MT data is wrong or PDF parsing grouped rows incorrectly
4. **Candy copper current-scope** (04/07/2569, 22.6 kg) — decide: create sorting movement / exclude
5. **Unique product-name review** (35 names) — confirm suggested normalizations

## Summary Counts

| Metric | Count |
|---|---:|
| PDF-only events | 15 |
| MetalTrack-only total | 81 |
| MetalTrack-only after 27/06/2569 | 7 |
| MetalTrack-only on/before 27/06/2569 | 74 |
| Real weight anomalies | 1 |
| Unique product names needing review | 35 |
| Candy copper current-scope rows | 1 (of 4 total) |

**No production data was modified.**
