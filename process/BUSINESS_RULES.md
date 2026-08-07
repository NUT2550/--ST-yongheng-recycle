# Business Rules — YH Stock System

> Durable Owner/business behavior only. Current implementation status belongs in `process/CURRENT_STATE.md`, exact code/tests, and current Owner decisions.
> Last reconciled: 2026-08-07

## 1. How to use this document

This file answers **what the system is supposed to do from the business/Owner perspective**.

It must not be used to claim:

- that a feature is currently implemented;
- that Production schema is ready;
- that a route currently returns a specific result;
- that a migration has been applied;
- that a historical implementation is still current.

For those claims, reload `CURRENT_STATE.md`, current code/tests, GitHub/CI, and Production evidence when authorized.

Current explicit Owner decisions in Notion `Decisions` can supersede this file for their specific subject and should then be reconciled back here when durable.

## 2. Bill identity

Business bills should have a stable, human-readable identifier suitable for operations and audit.

Current approved format family:

`{TYPE}-{BUDDHIST_YEAR}-{SEQUENCE_5_DIGITS}`

Examples:

- `BUY-2569-00001`
- `SELL-2569-00012`
- `SORT-2569-00003`

Rules:

- year uses Buddhist Era (Gregorian year + 543);
- sequence is zero-padded to 5 digits;
- sequence resets by year;
- identifiers must be unique;
- generation must be concurrency-safe enough for the actual write path — do not rely on a historical algorithm description if current code has changed.

## 3. Cancellation and reversal

### General rule

Business transactions are not casually hard-deleted to “fix” history.

A supported cancellation/reversal must:

- preserve auditability;
- record who performed the action and when;
- preserve/restore stock and cost according to the original transaction evidence;
- fail closed if downstream usage makes a safe reversal impossible;
- avoid partial stock/cost/history mutation;
- use the current application/service flow rather than ad-hoc Production SQL for normal operations.

### Buy cancellation

A buy bill may be cancelled only when the stock created by that bill can be reversed safely under the current business logic.

If stock from the bill has already been consumed in a way that prevents a correct reversal, cancellation must be blocked rather than guessing.

### Sell cancellation

A sell cancellation must restore the stock/cost effect using authoritative evidence from the original sale/reversal model and preserve audit history.

### Sorting cancellation

Owner-approved safety intent:

- cancellation must be atomic/fail-closed;
- output stock created by the sorting transaction must be intact enough for a safe reversal;
- if output has downstream usage, ambiguous state, conflicting evidence, or concurrent mutation, cancellation must stop instead of forcing the result;
- original/source cost must come from authoritative historical evidence, not a guessed current lot cost or a user-entered analysis price;
- bonus/ledger/audit effects associated with the cancelled transaction must be reconciled as part of the approved cancellation model.

Exact error codes, service functions, and transaction implementation are technical contracts and must be verified from current code/tests.

## 4. Product category and alias rules

### Core rule

**Different material categories are different products. Do not auto-match across material categories.**

- No fuzzy/automatic cross-category aliasing.
- If category/product identity is uncertain, require review instead of guessing.
- Alias/mapping must never move stock into the wrong material category.

Known business distinctions:

### Steel can vs aluminium can
- `กระป๋อง, ปี๊บ` = steel/tin-can category
- `อลูมิเนียมกระป๋อง` = aluminium category
- never map them together

### Cast aluminium vs cast iron
- `อลูมิเนียมหล่อ` / `เนียมแข็ง` = aluminium
- `เหล็กหล่อ 40/80` = steel/cast iron
- never map them together

### Copper cable vs aluminium cable
- `สายไฟไม่ปอก` = copper cable context
- `สายไฟอลูมิเนียมไม่ปอก` = aluminium cable
- never map them together

### Circuit board
- `แผงวงจร/พวงแผงวงจร` = PCB/electronics context
- do not map it to unrelated metal products merely because a matching name is similar
- if the canonical category does not yet exist, require Owner/product-master decision rather than misclassifying it

## 5. Weight-expression rules

Business users may enter arithmetic expressions for weight where the approved UI/workflow supports it.

Allowed expression intent:

- numbers and decimals
- `+ - * / ( )`
- deterministic safe parsing
- division by zero and incomplete/invalid expressions must be rejected
- never use `eval()` or `new Function()`

Audit intent:

- the stock/accounting weight is the evaluated numeric value;
- where expression storage is enabled, preserve the original expression separately so history can explain how the final weight was obtained;
- plain numeric input does not need a redundant expression value.

Whether expression fields are currently present in Production is a technical/schema state question, not a business rule. Verify before use.

## 6. FIFO and stock-cost rules

Business intent: **oldest eligible stock is consumed first**.

- sell/sort/transfer flows that use FIFO must consume eligible lots in deterministic oldest-first order;
- each lot keeps authoritative cost evidence appropriate to the current data model;
- transaction-level cost must be derived from the actual lots/evidence consumed, not guessed from current price;
- selling/consuming more than available stock is prohibited unless a newer explicit Owner rule changes that behavior;
- stock/cost conservation and auditability take priority over convenience.

Exact tie-break ordering and implementation details must be verified from current code/tests.

## 7. Credit rules

- `RECEIVABLE` = money customer owes the business, generally originating from a credit sale.
- `PAYABLE` = money the business owes the seller/supplier, generally originating from a credit purchase.
- credit entries must remain linked/reconcilable to their business source where the current model supports it;
- payment progress must be auditable;
- cancellation/reversal of the source transaction must reconcile the related credit effect under the current approved implementation.

Exact endpoint/model details are technical state, not maintained here.

## 8. Bonus rules

Current business intent for sorting bonus:

- bonus is based on positive value improvement from sorting;
- waste items do not earn sorting bonus;
- negative gross improvement does not create a negative bonus;
- cancelled/reversed source transactions must not continue contributing as if active;
- employee eligibility/status must be respected.

Historical formula reference: `(sortedPricePerKg - sourcePricePerKg) × weight × 10%`.

Before changing the percentage/formula, require explicit Owner confirmation; do not infer a new compensation rule from code refactoring alone.

## 9. Permissions and user rules

### Approved Owner decision — record creation

- Customer creation: authenticated user with `customer.create` permission.
- Employee creation/management: Admin only unless a newer Owner decision changes it.
- Bonus creation/management: Admin only unless a newer Owner decision changes it.

### General permission intent

- sensitive actions must be permission-checked server-side, not only hidden in UI;
- authentication failure and permission denial must remain distinguishable for UX/security where the current API contract requires it;
- permission changes should remain auditable where supported;
- user deactivation is preferred over destructive removal when history/relations must be preserved.

Do not use an old `admin vs staff` table as the full current permission matrix. Verify current permissions from code/tests and Owner decisions.

## 10. Physical Count APPLY — approved Owner rule

Approved behavior:

- used for real physical stock counting, especially copper/brass workflows initially;
- resulting stock must not become negative;
- an authorized employee can Apply; it is not necessarily Admin-only;
- separate approval on every Apply is not required under the approved rule;
- system must record actor, date/time, before value, and after value;
- note/photo evidence may be optional unless a newer rule makes them mandatory;
- reversal is performed through a new adjustment/reversal action, not by deleting or rewriting the original record;
- audit trail must remain reconstructable.

Implementation status of Physical Count APPLY must be verified from current code/state before use.

## 11. StockTransfer failure protection — approved Owner rule

When a StockTransfer workflow has already deducted source stock and a later step fails:

- the system must not leave stock silently lost;
- it must either complete atomically or perform a durable/traceable compensation according to the current design;
- failure should produce Error/Audit evidence appropriate to the current implementation;
- before/after stock effects must be verifiable;
- retries must not create duplicate business effects.

ST-62 later introduced durable stock-transfer idempotency; exact current mechanism must be verified from current code/schema/tests.

## 12. Owner gate — steel stock work paused under ST-21

Approved Owner decision remains recorded in Notion Decisions:

- steel-stock reconciliation/cost-correction work is paused until the Owner explicitly reopens it;
- do not fold steel-stock correction into unrelated historical-correction work;
- tasks that depend on unresolved steel-stock cost may be blocked by this decision;
- this pause does not prohibit unrelated normal system development that does not perform the blocked steel-stock reconciliation/correction.

If a newer Owner decision reopens/supersedes ST-21, update the Decisions record and reconcile this section.

## 13. General business prohibitions

Unless explicitly superseded:

- no negative transaction weight;
- no negative price where the business flow does not explicitly support it;
- no sale/consumption beyond eligible stock;
- no sorting/transfer beyond eligible source stock;
- no direct hard-delete of business transactions merely to correct results;
- no direct Production stock/cost rewrite as a normal business operation;
- no hard-delete of master data that would break historical relations;
- no cross-category product auto-match;
- no business-rule change invented by an AI agent without Owner confirmation where Owner intent is required.

## 14. Technical contracts are not business rules

The following should **not** be frozen in this file as “current” unless they are truly business-facing contracts:

- exact API routes/functions
- exact Prisma fields/models
- current feature status
- current migration state
- current Production row counts
- current PR/issue state
- dated error-code tables that can evolve with implementation

Those belong in code/tests, `CURRENT_STATE.md`, `DATABASE_CONTEXT.md`, knowledge records, and current GitHub evidence.

## Key takeaway

**Keep this file about durable Owner/business behavior. Verify implementation separately, and never let a dated code snapshot silently become a business rule.**