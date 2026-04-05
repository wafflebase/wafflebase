---
title: conditional-format-multi-range
target-version: 0.2.0
---

# Conditional Format Multi-Range Support

## Summary

Change conditional formatting rules from supporting a single range to supporting
multiple ranges per rule, matching Google Sheets behavior. A rule like
`A1:B10, D1:E10, G1:G20` applies the same condition and style to all listed
areas.

## Goals / Non-Goals

**Goals:**
- Allow multiple comma-separated ranges per conditional format rule
- Migrate existing Yorkie documents from `range` to `ranges` field
- Maintain rendering performance (style resolution per visible cell)

**Non-Goals:**
- Changing conditional format operators or style capabilities
- Adding range selection UI (multi-select via Ctrl+click) — text input only

## Proposal Details

### Data Model Change

```typescript
// Before
export type ConditionalFormatRule = {
  id: string;
  range: Range;          // single [Ref, Ref]
  op: ConditionalFormatOperator;
  value?: string;
  value2?: string;
  style: ConditionalFormatStyle;
};

// After
export type ConditionalFormatRule = {
  id: string;
  ranges: Range[];       // one or more [Ref, Ref]
  op: ConditionalFormatOperator;
  value?: string;
  value2?: string;
  style: ConditionalFormatStyle;
};
```

### Affected Modules

#### 1. `packages/sheets/src/model/core/types.ts`
- Replace `range: Range` with `ranges: Range[]` in `ConditionalFormatRule`.

#### 2. `packages/sheets/src/model/worksheet/conditional-format.ts`
- **`cloneConditionalFormatRule`**: Clone `ranges` array instead of single `range`.
- **`normalizeConditionalFormatRule`**: Normalize each range in `ranges`. Reject
  rules with empty `ranges`.
- **`resolveConditionalFormatStyleAt`**: Check `rule.ranges.some(r => inRange(point, r))`
  instead of `inRange(point, rule.range)`.
- **`shiftConditionalFormatRules`**: Shift every range in `ranges`. Drop
  individual ranges that collapse to zero size; drop the whole rule if all
  ranges are removed.
- **`moveConditionalFormatRules`**: Same multi-range iteration as shift.

#### 3. `packages/frontend/src/app/spreadsheet/conditional-format-panel.tsx`
- **`parseA1Ranges`**: Split input on `,`, parse each token with existing
  `parseA1Range` logic. Return `Range[]`.
- **`formatA1Ranges`**: Join ranges with `, `.
- **Range input**: Update placeholder to `A1:B10, D1:E10`.
- **"Use selected range"**: Sets the current selection as a single-element
  `ranges` array (existing behavior, just wrapped).
- **`handleAddRule`**: Create rule with `ranges: [defaultRange]`.
- **`handleApplyRange`**: Parse comma-separated input, update `ranges`.
- **Rule list display**: Show joined range string.

#### 4. `packages/frontend/src/app/spreadsheet/yorkie-store.ts`
- Update `setConditionalFormats` / `getConditionalFormats` to use `ranges`
  field. No structural change needed — the field name changes in
  `cloneConditionalFormatRule` and `normalizeConditionalFormatRule` handle it.

#### 5. `packages/sheets/src/store/memory.ts`
- Same as yorkie-store — follows from type change.

#### 6. `packages/sheets/src/view/gridcanvas.ts`
- No direct changes needed. It calls `resolveConditionalFormatStyleAt` which
  handles the multi-range logic internally.

#### 7. `packages/sheets/src/model/workbook/worksheet-document.ts`
- Update `Worksheet` type: `conditionalFormats` elements use `ranges` instead
  of `range`.

### Yorkie Document Migration

Create a new migration script following the existing
`migrate-yorkie-worksheet-shape` pattern:

**Script**: `packages/backend/scripts/migrate-yorkie-cf-ranges.ts`

**npm script**: `pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges`

**Logic per document:**
1. Attach document in `SyncMode.Manual`
2. Snapshot and parse root
3. For each worksheet in `root.sheets`:
   - If `conditionalFormats` exists, iterate rules
   - If a rule has `range` (old) and no `ranges` (new): set `ranges: [range]`,
     delete `range`
   - Skip rules that already have `ranges`
4. If any changes, update root and sync
5. Detach

**CLI interface** (same as worksheet-shape):
```
pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges --document <id>
pnpm --filter @wafflebase/backend migrate:yorkie:cf-ranges --all [--limit N]
```

**Rollout:**
1. Deploy code that reads both `range` and `ranges` (backward-compatible read)
2. Run migration script: `--document <id>` first, then `--all`
3. Remove backward-compat read path in next release

### Backward Compatibility (Read Path)

During the transition period, `normalizeConditionalFormatRule` will accept both
shapes:

```typescript
// In normalizeConditionalFormatRule:
const ranges = rule.ranges
  ?? (rule.range ? [rule.range] : undefined);
if (!ranges || ranges.length === 0) {
  return undefined;
}
```

This ensures documents that haven't been migrated yet still render correctly.
The fallback can be removed after all documents are migrated.

### Tests

- **Unit tests**: Update all existing tests in
  `packages/sheets/test/model/` to use `ranges`. Add new tests for
  multi-range matching, shift, and move.
- **Migration test**: Test `range` to `ranges` conversion logic.

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Un-migrated documents break | Backward-compat read path handles both `range` and `ranges` |
| Performance with many ranges per rule | Ranges are checked only for visible cells; typical rule has 1-3 ranges |
| Existing tests break | All tests updated as part of the change |
