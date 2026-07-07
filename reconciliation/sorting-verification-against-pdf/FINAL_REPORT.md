# Sorting Verification Against PDF — Final Report

**Task 47**: Verify MetalTrack SortingBills Against Sorting PDF Source
**Status**: VERIFICATION ONLY — No production data modified.

## Summary

| # | Metric | Value |
|---|---|---:|
| 1 | PDF pages parsed | 9 |
| 2 | PDF sorting events found | 68 |
| 3 | PDF output rows found | 682 |
| 4 | MetalTrack SortingBills found | 134 |
| 5 | Matched exact count | 48 |
| 6 | Matched with small difference | 5 |
| 7 | PDF-only count | 15 |
| 8 | MetalTrack-only count | 81 |
| 9 | Needs owner review | 0 |
| 10 | Weight anomaly count | 3 |
| 11 | Product-name review count | 156 |
| 12 | ทองแดงท่อ Candy check | See below |
| 13 | Data ready for stock reconciliation | NO — sorting verification incomplete |
| 14 | What must be fixed before reconciliation | See below |
| 15 | Output folder | /home/z/my-project/reconciliation/sorting-verification-against-pdf |

## Match Results

| Status | Count |
|---|---:|
| MATCHED_EXACT | 48 |
| MATCHED_WITH_SMALL_DIFFERENCE | 5 |
| PDF_ONLY | 15 |
| METALTRACK_ONLY | 81 |
| NEED_OWNER_REVIEW | 0 |

## ทองแดงท่อ Candy Check

| Sale date | Bill no | Weight (kg) | PDF candidates | MT candidates | Recommendation |
|---|---|---:|---:|---:|---|
| 08/01/2569 | A2007349 | 2.9 | 0 | 0 | No matching sorting events found — may need to create sorting movement manually |
| 05/02/2569 | A2007395 | 53.2 | 0 | 0 | No matching sorting events found — may need to create sorting movement manually |
| 21/04/2569 | A2007502 | 56 | 0 | 0 | No matching sorting events found — may need to create sorting movement manually |
| 04/07/2569 | A2007621 | 22.6 | 0 | 0 | No matching sorting events found — may need to create sorting movement manually |

## What Must Be Fixed Before Reconciliation

1. **PDF-only events (15)**: These sorting events appear in the PDF but not in MetalTrack. Owner must decide whether to create SortingBills for them.
2. **MetalTrack-only events (81)**: These SortingBills exist in MetalTrack but not in the PDF. May be post-PDF events (after 27/06/2569) or duplicates.
3. **Weight anomalies (3)**: Events where output exceeds input or negative loss.
4. **Product name reviews (156)**: PDF product names that could not be confidently normalized.
5. **ทองแดงท่อ Candy**: 4 sales require sorting movement verification. No matching sorting events found in PDF or MetalTrack for ทองแดงใหญ่ → ทองแดงท่อ Candy movement.

## Safety Confirmation

- ✅ No production data modified
- ✅ No SortingBills created/updated/deleted
- ✅ No stock adjusted
- ✅ No product master changed

**No production data was modified.**
