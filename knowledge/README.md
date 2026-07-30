# Knowledge Directory

> Durable, reusable technical knowledge for the YH Stock System.
> This is NOT a progress diary, issue tracker, or raw log archive.
> For current state, see `process/CURRENT_STATE.md`.
> For active work, see GitHub Issues and PRs.

## What belongs here

| Type | Purpose | Examples |
|---|---|---|
| **Incidents** | Verified root causes, fixes, and regression contracts from past defects | "DELETE sorting bill returned 500 because reversal copied persisted movement ID" |
| **Invariants** | Properties that must always hold for the system to be correct | "StockMovement reversal must never copy the original movement's persisted ID" |
| **Decisions** | Architectural or operational decisions with durable rationale | "All cancel routes use shared resolveHistoryEditAuth helper" |

## What does NOT belong here

- Progress diaries or raw chat transcripts
- Current task status (use Linear/GitHub Issues)
- Temporary debugging notes
- Duplicated content from `process/*.md`
- Raw CI logs or deployment evidence
- Secrets, tokens, or Production data

## Structure

```
knowledge/
  README.md           — this file
  INDEX.md            — searchable index of all records
  schema/
    knowledge-record.schema.json — JSON schema for validation
  templates/
    incident.md       — template for incident records
    invariant.md      — template for invariant records
    decision.md       — template for decision records
  incidents/          — verified incident records
  invariants/         — system invariants
  decisions/          — architectural decisions
```

## How to add a record

1. Copy the appropriate template from `templates/`
2. Fill in all required fields
3. Name the file: `<TYPE>-<ST-XX>-<SHORT-DESCRIPTION>.md`
4. Add an entry to `INDEX.md`
5. Run `bash scripts/validate-foundation.sh` to verify structure

## Validation

The foundation validator checks that:
- `knowledge/README.md` exists
- `knowledge/INDEX.md` exists
- `knowledge/schema/knowledge-record.schema.json` exists
- At least one template exists in `knowledge/templates/`
- Each record file has a YAML frontmatter block with required fields

See `scripts/validate-foundation.sh` for the full validation contract.
