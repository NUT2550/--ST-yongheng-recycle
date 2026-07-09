# Files Changed

## Summary

| File | Change Type | Lines Changed |
|---|---|---|
| `src/components/history-page.tsx` | UI presentation only | +16 / -3 |

**No other files changed.** No DB schema, no API routes, no lib files, no types.

## Detailed Changes

### `src/components/history-page.tsx`

#### Change 1: BillList render — pass `displayMode="sort"` to TransferBillCard in sort tab

```diff
  if (type === 'sort') {
    ...
    if (isStockTransfer) {
-     return <TransferBillCard key={bill.id} bill={bill as StockTransfer} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} />;
+     return <TransferBillCard key={bill.id} bill={bill as StockTransfer} isExpanded={isExpanded} toggleExpand={toggleExpand} onRefresh={onRefresh} displayMode="sort" />;
    }
    return <SortBillCard ... />;
  }
```

#### Change 2: TransferBillCard — accept `displayMode` prop and apply sort-style colors/icon

```diff
- function TransferBillCard({ bill, isExpanded, toggleExpand, onRefresh }: { ... }) {
-   const cancelled = bill.isCancelled === true;
-   return (
-     <Card ...>
-       ...
-         <PackageOpen className="h-4 w-4 text-cyan-600 shrink-0" />
-         ...
-         <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 ...">

+ function TransferBillCard({ bill, isExpanded, toggleExpand, onRefresh, displayMode = 'transfer' }: { ...; displayMode?: 'transfer' | 'sort' }) {
+   const cancelled = bill.isCancelled === true;
+   const isSortStyle = displayMode === 'sort';
+   const Icon = isSortStyle ? RefreshCw : PackageOpen;
+   const iconColor = isSortStyle ? 'text-purple-600' : 'text-cyan-600';
+   const badgeClass = isSortStyle ? 'bg-purple-100 text-purple-700 ...' : 'bg-cyan-100 text-cyan-700 ...';
+   return (
+     <Card ...>
+       ...
+         <Icon className={`h-4 w-4 ${iconColor} shrink-0`} />
+         ...
+         <Badge variant="secondary" className={badgeClass}>
```

## Verification: No DB Writes

The diff contains **zero** occurrences of:
- `db.` (Prisma client calls)
- `prisma` (Prisma imports)
- `.create(`, `.update(`, `.delete(` (DB mutations)

This is a **pure UI presentation change**. No data flows to or from the database.

## Commit

- **Hash**: `6c84a5e11578ec3867034d342fe3864fe8fd9da2` (short: `6c84a5e`)
- **Author**: NUT2550 <207142776+NUT2550@users.noreply.github.com>
- **Message**: `Task 71: Render StockTransfer(คัดแยก) with sort-style in คัดแยก tab`
- **Pushed**: `3e7f2ba..6c84a5e main -> main` ✅
