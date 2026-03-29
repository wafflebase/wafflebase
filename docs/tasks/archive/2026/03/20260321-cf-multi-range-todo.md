# Conditional Format Multi-Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Change conditional formatting from single `range` to multi-range `ranges: Range[]` per rule.

**Architecture:** Replace `range: Range` with `ranges: Range[]` in `ConditionalFormatRule`. Update all consumers (matching, shifting, moving, cloning, normalizing, UI, stores). Add backward-compat read path for un-migrated Yorkie documents. Create migration script following existing `migrate-yorkie-worksheet-shape` pattern.

**Tech Stack:** TypeScript, Vitest, React, Yorkie SDK, NestJS

**Spec:** `docs/design/conditional-format-multi-range.md`

---

### Task 1: Update data model type

**Files:**
- Modify: `packages/sheet/src/model/core/types.ts:131-138`

- [x] **Step 1: Change `range` to `ranges` in `ConditionalFormatRule`**

```typescript
export type ConditionalFormatRule = {
  id: string;
  ranges: Range[];
  op: ConditionalFormatOperator;
  value?: string;
  value2?: string;
  style: ConditionalFormatStyle;
};
```

- [x] **Step 2: Verify TypeScript catches all consumers**

Run: `cd packages/sheet && npx tsc --noEmit 2>&1 | head -60`
Expected: Type errors in conditional-format.ts, memory.ts, sheet.ts, test files — confirms all consumers found.

---

### Task 2: Update conditional-format module

**Files:**
- Modify: `packages/sheet/src/model/worksheet/conditional-format.ts`
- Test: `packages/sheet/test/model/conditional-format.test.ts`

- [x] **Step 1: Update `cloneConditionalFormatRule`**

Replace `range: cloneRange(rule.range)` with `ranges: rule.ranges.map(r => cloneRange(r))`.

- [x] **Step 2: Update `normalizeConditionalFormatRule`**

Add backward-compat read path: `const ranges = rule.ranges ?? ((rule as any).range ? [(rule as any).range] : undefined)`. Normalize each range. Reject if empty.

Replace:
```typescript
const normalized: ConditionalFormatRule = {
  id,
  range: normalizeRange(rule.range),
  op,
  style,
};
```
With:
```typescript
const rawRanges: Range[] | undefined =
  rule.ranges ?? ((rule as any).range ? [(rule as any).range] : undefined);
if (!rawRanges || rawRanges.length === 0) {
  return undefined;
}
const normalizedRanges = rawRanges.map((r) => normalizeRange(r));

const normalized: ConditionalFormatRule = {
  id,
  ranges: normalizedRanges,
  op,
  style,
};
```

- [x] **Step 3: Update `resolveConditionalFormatStyleAt`**

Replace `if (!inRange(point, rule.range))` with `if (!rule.ranges.some((r) => inRange(point, r)))`.

- [x] **Step 4: Update `shiftConditionalFormatRules`**

Shift every range in `ranges`. Filter out collapsed ranges. Drop rule if all ranges removed.

Replace the loop body with:
```typescript
const normalized = normalizeConditionalFormatRule(rule);
if (!normalized) {
  continue;
}

const shiftedRanges = normalized.ranges
  .map((range) => {
    const shifted = axis === 'row'
      ? toRange(
          { r: shiftBoundary(range[0].r, index, count), c: range[0].c },
          { r: shiftBoundary(range[1].r, index, count), c: range[1].c },
        )
      : toRange(
          { r: range[0].r, c: shiftBoundary(range[0].c, index, count) },
          { r: range[1].r, c: shiftBoundary(range[1].c, index, count) },
        );
    return clampRange(shifted);
  });

if (shiftedRanges.length === 0) {
  continue;
}

next.push({
  ...cloneConditionalFormatRule(normalized),
  ranges: shiftedRanges,
});
```

- [x] **Step 5: Update `moveConditionalFormatRules`**

Same pattern — iterate `ranges`, remap each, filter empties.

Replace the loop body with:
```typescript
const normalized = normalizeConditionalFormatRule(rule);
if (!normalized) {
  continue;
}

const movedRanges = normalized.ranges
  .map((range) => {
    const moved = axis === 'row'
      ? toRange(
          { r: remapIndex(range[0].r, src, count, dst), c: range[0].c },
          { r: remapIndex(range[1].r, src, count, dst), c: range[1].c },
        )
      : toRange(
          { r: range[0].r, c: remapIndex(range[0].c, src, count, dst) },
          { r: range[1].r, c: remapIndex(range[1].c, src, count, dst) },
        );
    return clampRange(moved);
  });

if (movedRanges.length === 0) {
  continue;
}

next.push({
  ...cloneConditionalFormatRule(normalized),
  ranges: movedRanges,
});
```

- [x] **Step 6: Update tests — change `range` to `ranges` in all rules**

Every `range: [...]` in test file becomes `ranges: [[...]]`. Example:
```typescript
// Before
range: [{ r: 1, c: 1 }, { r: 10, c: 10 }],
// After
ranges: [[{ r: 1, c: 1 }, { r: 10, c: 10 }]],
```

- [x] **Step 7: Add multi-range test cases**

```typescript
it('resolves style when cell is in any of multiple ranges', () => {
  const rules: ConditionalFormatRule[] = [
    {
      id: 'rule-1',
      ranges: [
        [{ r: 1, c: 1 }, { r: 5, c: 5 }],
        [{ r: 10, c: 10 }, { r: 15, c: 15 }],
      ],
      op: 'isNotEmpty',
      style: { bg: '#fff59d' },
    },
  ];

  // Cell in first range
  expect(resolveConditionalFormatStyleAt(rules, 3, 3, { v: 'a' }))
    .toEqual({ bg: '#fff59d' });
  // Cell in second range
  expect(resolveConditionalFormatStyleAt(rules, 12, 12, { v: 'b' }))
    .toEqual({ bg: '#fff59d' });
  // Cell outside both ranges
  expect(resolveConditionalFormatStyleAt(rules, 7, 7, { v: 'c' }))
    .toBeUndefined();
});

it('normalizes legacy single-range rule to ranges', () => {
  const legacy = {
    id: 'rule-1',
    range: [{ r: 1, c: 1 }, { r: 5, c: 5 }],
    op: 'isNotEmpty',
    style: { bg: '#fff59d' },
  } as any;

  const normalized = normalizeConditionalFormatRule(legacy);
  expect(normalized).toBeDefined();
  expect(normalized!.ranges).toEqual([[{ r: 1, c: 1 }, { r: 5, c: 5 }]]);
});
```

- [x] **Step 8: Run tests**

Run: `cd packages/sheet && npx vitest run test/model/conditional-format.test.ts`
Expected: All tests pass.

- [x] **Step 9: Commit**

```
feat(sheet): change conditional format from single range to ranges array

Support multiple ranges per conditional formatting rule, matching
Google Sheets behavior. Includes backward-compat normalization for
legacy single-range documents.
```

---

### Task 3: Update Sheet model and MemStore

**Files:**
- Modify: `packages/sheet/src/model/worksheet/sheet.ts`
- Modify: `packages/sheet/src/store/memory.ts`

- [x] **Step 1: Fix any remaining type errors in sheet.ts and memory.ts**

These files use `cloneConditionalFormatRule`, `shiftConditionalFormatRules`, etc. which now return `ranges`-based rules. No direct `rule.range` access should exist in these files — verify with `tsc`.

Run: `cd packages/sheet && npx tsc --noEmit`
Expected: No errors.

- [x] **Step 2: Run full sheet tests**

Run: `pnpm test`
Expected: All pass.

- [x] **Step 3: Commit**

```
refactor(sheet): update Sheet and MemStore for multi-range conditional formats
```

---

### Task 4: Update frontend panel

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/conditional-format-panel.tsx`

- [x] **Step 1: Update `parseA1Range` → support comma-separated ranges**

Replace `parseA1Range` with `parseA1Ranges`:
```typescript
function parseA1Ranges(input: string): Range[] | null {
  const segments = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const ranges: Range[] = [];
  for (const segment of segments) {
    const tokens = segment
      .toUpperCase()
      .replace(/\$/g, "")
      .split(":")
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length !== 2) {
      return null;
    }
    try {
      const a = parseRef(tokens[0]);
      const b = parseRef(tokens[1]);
      ranges.push([
        { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
        { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
      ]);
    } catch {
      return null;
    }
  }
  return ranges;
}
```

- [x] **Step 2: Update `formatA1Range` → `formatA1Ranges`**

```typescript
function formatA1Ranges(ranges: Range[]): string {
  return ranges.map((r) => `${toSref(r[0])}:${toSref(r[1])}`).join(", ");
}
```

- [x] **Step 3: Update all usages in the component**

- `setRangeInput`: `formatA1Ranges(selectedRule.ranges)` instead of `formatA1Range(selectedRule.range)`
- `handleAddRule`: `ranges: [defaultRange]` instead of `range: defaultRange`
- `handleApplyRange`: Use `parseA1Ranges`, update `ranges` field. Error message: `"Enter valid A1 ranges like A1:D20 or A1:B10, D1:E10."`
- `handleUseSelectionRange`: Parse and set `ranges: [parsed]` (wrapping single selection)
- Rule list display: `formatA1Ranges(rule.ranges)` instead of `formatA1Range(rule.range)`
- Placeholder: `"A1:B10, D1:E10"`

- [x] **Step 4: Verify frontend builds**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No errors.

- [x] **Step 5: Commit**

```
feat(frontend): support multi-range input in conditional format panel

Comma-separated ranges like "A1:B10, D1:E10" are now accepted in the
conditional formatting panel.
```

---

### Task 5: Update YorkieStore

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-store.ts`

- [x] **Step 1: Verify no direct `rule.range` access exists**

The YorkieStore uses `cloneConditionalFormatRule` and `normalizeConditionalFormatRule` which now handle `ranges`. Verify no direct field access.

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No errors (type change flows through automatically).

- [x] **Step 2: Commit if changes were needed**

```
refactor(frontend): update YorkieStore for multi-range conditional formats
```

---

### Task 6: Update worksheet-document type

**Files:**
- Modify: `packages/sheet/src/model/workbook/worksheet-document.ts`

- [x] **Step 1: Verify the `Worksheet` type uses `ConditionalFormatRule` (which now has `ranges`)**

The `conditionalFormats?: ConditionalFormatRule[]` field already references the updated type. No change needed unless the type is inlined.

Run: `cd packages/sheet && npx tsc --noEmit`
Expected: No errors.

---

### Task 7: Create Yorkie migration script

**Files:**
- Create: `packages/backend/scripts/migrate-yorkie-cf-ranges.ts`
- Modify: `packages/backend/package.json` (add npm script)

- [x] **Step 1: Create migration script**

Follow the `migrate-yorkie-worksheet-shape.ts` pattern. Key logic:

```typescript
import { PrismaClient } from '@prisma/client';
import yorkie, { Client, Document, SyncMode } from '@yorkie-js/sdk';

type DbDocument = { id: string; title: string };

type CliOptions = {
  documentIds: string[];
  processAll: boolean;
  limit?: number;
};

type MigrationSummary = {
  processed: number;
  changed: number;
  unchanged: number;
  failures: string[];
};

// Reuse parseArgs, loadDocuments, printUsage from worksheet-shape script
// (same CLI interface: --document <id>, --all, --limit N)

function migrateConditionalFormatRanges(
  root: Record<string, unknown>,
): boolean {
  const sheets = root.sheets as Record<string, Record<string, unknown>> | undefined;
  if (!sheets) {
    return false;
  }

  let changed = false;
  for (const worksheet of Object.values(sheets)) {
    const rules = worksheet.conditionalFormats as Array<Record<string, unknown>> | undefined;
    if (!rules || !Array.isArray(rules)) {
      continue;
    }

    for (const rule of rules) {
      if (rule.ranges) {
        continue; // already migrated
      }
      if (rule.range) {
        rule.ranges = [rule.range];
        delete rule.range;
        changed = true;
      }
    }
  }

  return changed;
}

async function migrateDocument(
  client: Client,
  documentId: string,
): Promise<{ changed: boolean }> {
  const doc = new yorkie.Document<Record<string, unknown>>(`sheet-${documentId}`);
  await client.attach(doc, { syncMode: SyncMode.Manual });

  try {
    let changed = false;
    doc.update((root) => {
      changed = migrateConditionalFormatRanges(root as Record<string, unknown>);
    }, 'Migrate conditional format range to ranges array');

    if (changed) {
      await client.sync(doc);
    }

    return { changed };
  } finally {
    await client.detach(doc);
  }
}
```

Full script follows the same main(), parseArgs(), loadDocuments(), summary pattern.

- [x] **Step 2: Add npm script to backend package.json**

Add to `scripts` in `packages/backend/package.json`:
```json
"migrate:yorkie:cf-ranges": "tsx scripts/migrate-yorkie-cf-ranges.ts"
```

- [x] **Step 3: Verify script compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors.

- [x] **Step 4: Commit**

```
feat(backend): add Yorkie migration script for conditional format ranges

Converts conditional format rules from single `range` field to
`ranges` array. Follows the same CLI pattern as worksheet-shape
migration: --document <id>, --all, --limit N.
```

---

### Task 8: Run full verification

- [x] **Step 1: Run verify:fast**

Run: `pnpm verify:fast`
Expected: Lint + all unit tests pass.

- [x] **Step 2: Verify frontend build**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds.

- [x] **Step 3: Archive task**

Run: `pnpm tasks:archive && pnpm tasks:index`
