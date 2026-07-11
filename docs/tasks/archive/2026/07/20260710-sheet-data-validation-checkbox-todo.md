# Sheet Data Validation — Phase 1: Checkbox Implementation Plan

> **Status: SHIPPED** (PR against `main`). This is the original point-in-time
> plan; the implementation deviated in a few places (lazy `FALSE`
> materialization instead of eager writes, active-cell-only Space, whole-rule
> removal, and the deletion-collapses-to-boundary shift semantics). The
> **authoritative record of what shipped and why it differs** is the companion
> `*-lessons.md` and the "Phase 1 (checkbox) — as shipped" section of
> `docs/design/sheets/data-validation.md`. The unchecked `- [x]` task boxes and
> example snippets below are preserved as the historical plan, not a live TODO.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an in-cell checkbox control to Sheets — a worksheet-level, range-scoped data-validation rule whose cells hold real boolean `TRUE`/`FALSE` values, rendered as a checkbox glyph and toggled by click/Space.

**Architecture:** Mirror the existing `ConditionalFormatRule` infrastructure exactly. A new `DataValidationRule[]` lives on the `Worksheet`; a `data-validation.ts` model module provides normalize/clone/resolve/shift/move + checkbox value helpers; the three `Store` implementations gain `get/setDataValidations`; the Canvas gains a checkbox render pass modeled on `renderCellFilterButton`; `worksheet.ts` gains a hit-test + click/Space toggle modeled on `detectFilterButton`. Cells and the formula engine are unchanged — checkbox values reuse the existing boolean round-trip.

**Tech Stack:** TypeScript, Vitest, Canvas 2D, Yorkie CRDT. Design doc: `docs/design/sheets/data-validation.md`.

## Global Constraints

- `pnpm test` (Sheets Vitest) must pass; run `pnpm verify:fast` before any commit (lint + unit tests, the pre-commit gate).
- Do NOT hand-edit ANTLR generated files (not touched here).
- All spreadsheet behavior goes through the `Store` interface — no ad-hoc persistence.
- Store methods are `Promise`-based (e.g. `getConditionalFormats(): Promise<...>`); match that signature style.
- New `Worksheet` map/array containers MUST be seeded in `createWorksheet` (avoids Yorkie LWW loss on concurrent first-insert).
- Checkbox cell value is the string `"TRUE"` / `"FALSE"` (custom values deferred to a later phase — do not add `checkedValue`/`uncheckedValue` handling yet, but DO include the fields in the type so the model is stable).
- Commit format: subject ≤70 chars, blank line 2, body explains why. End body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work on the current `design/sheets-data-validation` branch (the design doc already lives here); do not push to `main`.

---

### Task 1: `DataValidationRule` types + core model helpers

**Files:**
- Modify: `packages/sheets/src/model/core/types.ts` (add types after `ConditionalFormatRule`, ~line 133)
- Create: `packages/sheets/src/model/worksheet/data-validation.ts`
- Test: `packages/sheets/src/model/worksheet/data-validation.test.ts`

**Interfaces:**
- Consumes: `Range`, `Ref`, `Cell` from `../core/types`; `inRange`, `toRange` from `../core/coordinates`.
- Produces:
  - `type DataValidationKind = 'checkbox' | 'list' | 'date'`
  - `type DataValidationRule = { id: string; ranges: Range[]; kind: DataValidationKind; onInvalid?: 'reject' | 'warning'; list?: string[]; showArrow?: boolean; checkedValue?: string; uncheckedValue?: string; dateMin?: string; dateMax?: string }`
  - `normalizeDataValidationRule(rule: DataValidationRule): DataValidationRule | null`
  - `cloneDataValidationRule(rule: DataValidationRule): DataValidationRule`
  - `resolveDataValidationAt(point: Ref, rules: DataValidationRule[]): DataValidationRule | undefined` (last matching rule wins)
  - `CHECKBOX_TRUE = 'TRUE'`, `CHECKBOX_FALSE = 'FALSE'`
  - `isCheckboxChecked(rule: DataValidationRule, value: string | undefined): boolean`
  - `toggleCheckboxValue(rule: DataValidationRule, value: string | undefined): string`

- [x] **Step 1: Write the failing test**

Create `packages/sheets/src/model/worksheet/data-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  normalizeDataValidationRule,
  cloneDataValidationRule,
  resolveDataValidationAt,
  isCheckboxChecked,
  toggleCheckboxValue,
  CHECKBOX_TRUE,
  CHECKBOX_FALSE,
} from './data-validation';
import { DataValidationRule } from '../core/types';

const checkboxRule = (id: string, range: string): DataValidationRule => ({
  id,
  kind: 'checkbox',
  ranges: [
    // A1:B2 style ranges are [{r,c},{r,c}] — build directly for the test.
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
});

describe('data-validation model', () => {
  it('normalizes a valid checkbox rule and drops an invalid one', () => {
    expect(normalizeDataValidationRule(checkboxRule('a', 'A1:B2'))).not.toBeNull();
    expect(
      normalizeDataValidationRule({
        id: '',
        kind: 'checkbox',
        ranges: [],
      } as DataValidationRule),
    ).toBeNull();
  });

  it('clones deeply (mutating the clone does not touch the source)', () => {
    const src = checkboxRule('a', 'A1:B2');
    const copy = cloneDataValidationRule(src);
    copy.ranges[0][0].r = 99;
    expect(src.ranges[0][0].r).toBe(1);
  });

  it('resolves the last matching rule for a point', () => {
    const r1 = checkboxRule('first', 'A1:B2');
    const r2 = checkboxRule('second', 'A1:B2');
    expect(resolveDataValidationAt({ r: 1, c: 1 }, [r1, r2])?.id).toBe('second');
    expect(resolveDataValidationAt({ r: 9, c: 9 }, [r1, r2])).toBeUndefined();
  });

  it('reads and toggles checkbox values', () => {
    const rule = checkboxRule('a', 'A1:B2');
    expect(isCheckboxChecked(rule, CHECKBOX_TRUE)).toBe(true);
    expect(isCheckboxChecked(rule, undefined)).toBe(false);
    expect(isCheckboxChecked(rule, 'FALSE')).toBe(false);
    expect(toggleCheckboxValue(rule, CHECKBOX_FALSE)).toBe(CHECKBOX_TRUE);
    expect(toggleCheckboxValue(rule, CHECKBOX_TRUE)).toBe(CHECKBOX_FALSE);
    expect(toggleCheckboxValue(rule, undefined)).toBe(CHECKBOX_TRUE);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- data-validation`
Expected: FAIL — `Cannot find module './data-validation'`.

- [x] **Step 3: Add the types to `types.ts`**

Insert after the `ConditionalFormatRule` type (after ~line 133):

```typescript
/**
 * DataValidationKind enumerates the in-cell control kinds.
 */
export type DataValidationKind = 'checkbox' | 'list' | 'date';

/**
 * DataValidationRule is a worksheet-level, range-scoped validation/control
 * rule. The control is a special render of a typed cell value — the cell
 * itself holds the value (boolean TRUE/FALSE, ISO date, or list text).
 */
export type DataValidationRule = {
  id: string;
  ranges: Range[];
  kind: DataValidationKind;
  onInvalid?: 'reject' | 'warning'; // list/date only; ignored for checkbox

  // kind: 'list'
  list?: string[];
  showArrow?: boolean;

  // kind: 'checkbox'
  checkedValue?: string;
  uncheckedValue?: string;

  // kind: 'date'
  dateMin?: string;
  dateMax?: string;
};
```

- [x] **Step 4: Create `data-validation.ts`**

```typescript
import { cloneRange, inRange } from '../core/coordinates';
import { DataValidationKind, DataValidationRule, Ref } from '../core/types';

export const CHECKBOX_TRUE = 'TRUE';
export const CHECKBOX_FALSE = 'FALSE';

const Kinds = new Set<DataValidationKind>(['checkbox', 'list', 'date']);

/**
 * `normalizeDataValidationRule` validates a rule and returns a normalized
 * copy, or null if the rule is unusable (no id, unknown kind, no ranges).
 */
export function normalizeDataValidationRule(
  rule: DataValidationRule,
): DataValidationRule | null {
  if (!rule || !rule.id || !Kinds.has(rule.kind)) {
    return null;
  }
  if (!Array.isArray(rule.ranges) || rule.ranges.length === 0) {
    return null;
  }
  return cloneDataValidationRule(rule);
}

/**
 * `cloneDataValidationRule` returns a deep copy of the rule.
 */
export function cloneDataValidationRule(
  rule: DataValidationRule,
): DataValidationRule {
  return {
    ...rule,
    ranges: rule.ranges.map((r) => cloneRange(r)),
    list: rule.list ? [...rule.list] : undefined,
  };
}

/**
 * `resolveDataValidationAt` returns the last rule whose ranges contain the
 * point (last-matching-rule-wins, matching conditional-format precedence).
 */
export function resolveDataValidationAt(
  point: Ref,
  rules: DataValidationRule[],
): DataValidationRule | undefined {
  let resolved: DataValidationRule | undefined;
  for (const rule of rules) {
    if (rule.ranges.some((r) => inRange(point, r))) {
      resolved = rule;
    }
  }
  return resolved;
}

/**
 * `checkedValueOf` / `uncheckedValueOf` return the string a checked/unchecked
 * checkbox stores. Custom values fall back to boolean TRUE/FALSE for now.
 */
function checkedValueOf(rule: DataValidationRule): string {
  return rule.checkedValue ?? CHECKBOX_TRUE;
}
function uncheckedValueOf(rule: DataValidationRule): string {
  return rule.uncheckedValue ?? CHECKBOX_FALSE;
}

/**
 * `isCheckboxChecked` reports whether the cell value represents "checked".
 */
export function isCheckboxChecked(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  return value === checkedValueOf(rule);
}

/**
 * `toggleCheckboxValue` returns the value to write when the box is toggled.
 */
export function toggleCheckboxValue(
  rule: DataValidationRule,
  value: string | undefined,
): string {
  return isCheckboxChecked(rule, value)
    ? uncheckedValueOf(rule)
    : checkedValueOf(rule);
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- data-validation`
Expected: PASS (all 4 tests). If `cloneRange`/`inRange` import paths differ, confirm against `conditional-format.ts:1`.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/model/core/types.ts \
  packages/sheets/src/model/worksheet/data-validation.ts \
  packages/sheets/src/model/worksheet/data-validation.test.ts
git commit -m "feat(sheets): add DataValidationRule model + checkbox helpers" \
  -m "Worksheet-level, range-scoped validation rule mirroring
ConditionalFormatRule. Phase 1 uses only kind:'checkbox'; the model
includes list/date fields so the shape is stable for later phases.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Structural-edit shift/move helpers

**Files:**
- Modify: `packages/sheets/src/model/worksheet/data-validation.ts`
- Test: `packages/sheets/src/model/worksheet/data-validation.test.ts`

**Interfaces:**
- Consumes: `Axis` from `../core/types`; `remapIndex` from `./shifting` (see `conditional-format.ts:2` + its `shiftConditionalFormatRules` at line 354 as the exact pattern to mirror).
- Produces:
  - `shiftDataValidationRules(rules, axis, index, count): DataValidationRule[]` (row/col insert = positive count, delete = negative)
  - `moveDataValidationRules(rules, from, to): DataValidationRule[]`

- [x] **Step 1: Read the reference implementation**

Read `packages/sheets/src/model/worksheet/conditional-format.ts:354-450` (`shiftConditionalFormatRules` and `moveConditionalFormatRules`). Your two functions are structurally identical — they transform each rule's `ranges` and drop rules whose ranges fully collapse. Reuse the same range-shifting logic; only the rule type differs.

- [x] **Step 2: Write the failing test**

Append to `data-validation.test.ts`:

```typescript
import {
  shiftDataValidationRules,
  moveDataValidationRules,
} from './data-validation';

describe('data-validation structural edits', () => {
  const rule = (): DataValidationRule => ({
    id: 'a',
    kind: 'checkbox',
    ranges: [
      [
        { r: 3, c: 1 },
        { r: 5, c: 1 },
      ],
    ],
  });

  it('shifts ranges down when rows are inserted above', () => {
    const [shifted] = shiftDataValidationRules([rule()], 'row', 1, 2);
    expect(shifted.ranges[0][0].r).toBe(5);
    expect(shifted.ranges[0][1].r).toBe(7);
  });

  it('drops a rule whose only range fully collapses on delete', () => {
    const result = shiftDataValidationRules([rule()], 'row', 3, -3);
    expect(result).toHaveLength(0);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- data-validation`
Expected: FAIL — `shiftDataValidationRules is not a function`.

- [x] **Step 4: Implement the helpers**

Add to `data-validation.ts` (adapt precisely from `conditional-format.ts:354-450`, substituting `DataValidationRule`/`cloneDataValidationRule` and keeping the same `remapIndex`-based range transform and empty-range drop):

```typescript
import { Axis } from '../core/types';
import { remapIndex } from './shifting';

// shiftDataValidationRules / moveDataValidationRules:
// copy the body of shiftConditionalFormatRules / moveConditionalFormatRules
// from conditional-format.ts, replacing the rule type + clone function.
// Both re-map each range's start/end index along `axis`, drop ranges that
// collapse to empty, and drop rules left with no ranges.
```

(The implementer copies the two functions verbatim from `conditional-format.ts`, changing only the type name and clone call. Do not invent new logic — the shift/move semantics must match conditional formats exactly.)

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- data-validation`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/model/worksheet/data-validation.ts \
  packages/sheets/src/model/worksheet/data-validation.test.ts
git commit -m "feat(sheets): shift/move data-validation rules on structural edits" \
  -m "Ranged rules must follow row/column insert/delete/move, mirroring
conditional-format shifting semantics.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Worksheet schema field + seed

**Files:**
- Modify: `packages/sheets/src/model/workbook/worksheet-document.ts` (`Worksheet` type ~line 79; `createWorksheet` ~line 133)
- Test: `packages/sheets/src/model/workbook/worksheet-document.test.ts` (create if absent, or append to the nearest existing worksheet-document test)

**Interfaces:**
- Consumes: `DataValidationRule` from `../core/types`.
- Produces: `Worksheet.dataValidations?: DataValidationRule[]`, seeded to `[]` by `createWorksheet`.

- [x] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createWorksheet } from './worksheet-document';

describe('createWorksheet dataValidations seed', () => {
  it('seeds dataValidations to an empty array', () => {
    expect(createWorksheet().dataValidations).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- worksheet-document`
Expected: FAIL — `dataValidations` is `undefined`.

- [x] **Step 3: Add the field + seed**

In the `Worksheet` type, next to `conditionalFormats?` (line 79):

```typescript
  dataValidations?: DataValidationRule[];
```

Add the import of `DataValidationRule` to the existing type import from `../core/types`. In `createWorksheet` (next to `conditionalFormats: []` at line 133):

```typescript
    dataValidations: [],
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- worksheet-document`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/sheets/src/model/workbook/worksheet-document.ts \
  packages/sheets/src/model/workbook/worksheet-document.test.ts
git commit -m "feat(sheets): add seeded dataValidations to Worksheet schema" \
  -m "Seed the container at creation so a concurrent first rule insert does
not lose the array to Yorkie LWW.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Store interface + MemStore implementation

**Files:**
- Modify: `packages/sheets/src/store/store.ts` (add methods next to `getConditionalFormats`, ~line 171)
- Modify: `packages/sheets/src/store/memory.ts` (field ~line 73; methods ~line 406; shift/move wiring ~lines 190, 256)
- Test: `packages/sheets/src/store/memory.test.ts` (append; confirm the existing test file name)

**Interfaces:**
- Consumes: `DataValidationRule`; the Task 1–2 helpers.
- Produces on `Store`:
  - `getDataValidations(): Promise<DataValidationRule[]>`
  - `setDataValidations(rules: DataValidationRule[]): Promise<void>`

- [x] **Step 1: Write the failing test**

Append to the MemStore test file:

```typescript
it('round-trips data validation rules', async () => {
  const store = new MemStore();
  const rule: DataValidationRule = {
    id: 'a',
    kind: 'checkbox',
    ranges: [
      [
        { r: 1, c: 1 },
        { r: 2, c: 1 },
      ],
    ],
  };
  await store.setDataValidations([rule]);
  const got = await store.getDataValidations();
  expect(got).toHaveLength(1);
  expect(got[0].id).toBe('a');
  // returned rules are clones, not the same reference
  got[0].ranges[0][0].r = 99;
  expect((await store.getDataValidations())[0].ranges[0][0].r).toBe(1);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- memory`
Expected: FAIL — `store.setDataValidations is not a function`.

- [x] **Step 3: Add to the `Store` interface**

In `store.ts`, after `getConditionalFormats` (line 171):

```typescript
  /**
   * `setDataValidations` replaces all data-validation rules.
   */
  setDataValidations(rules: DataValidationRule[]): Promise<void>;

  /**
   * `getDataValidations` gets all data-validation rules in apply order.
   */
  getDataValidations(): Promise<DataValidationRule[]>;
```

Add `DataValidationRule` to the type import from `../model/core/types`.

- [x] **Step 4: Implement in MemStore**

Add the field next to `conditionalFormats` (line 73):

```typescript
  private dataValidations: DataValidationRule[] = [];
```

Add the methods next to the conditional-format ones (line 406), reusing the Task 1 helpers:

```typescript
  async setDataValidations(rules: DataValidationRule[]): Promise<void> {
    this.dataValidations = rules
      .map((rule) => normalizeDataValidationRule(rule))
      .filter((rule): rule is DataValidationRule => !!rule)
      .map((rule) => cloneDataValidationRule(rule));
  }

  async getDataValidations(): Promise<DataValidationRule[]> {
    return this.dataValidations.map((rule) => cloneDataValidationRule(rule));
  }
```

Wire structural edits next to the existing `shiftConditionalFormatRules` (line 190) and `moveConditionalFormatRules` (line 256) calls — add the parallel `dataValidations` transform right after each, passing the same axis/index/count arguments:

```typescript
    this.dataValidations = shiftDataValidationRules(
      this.dataValidations,
      /* same args as the conditionalFormats shift call above */
    );
```
```typescript
    this.dataValidations = moveDataValidationRules(
      this.dataValidations,
      /* same args as the conditionalFormats move call above */
    );
```

Add the helper imports at the top of `memory.ts` next to the conditional-format imports (line 22):

```typescript
import {
  cloneDataValidationRule,
  moveDataValidationRules,
  normalizeDataValidationRule,
  shiftDataValidationRules,
} from '../model/worksheet/data-validation';
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- memory`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/store/store.ts packages/sheets/src/store/memory.ts \
  packages/sheets/src/store/memory.test.ts
git commit -m "feat(sheets): data-validation get/set on Store + MemStore" \
  -m "Mirror the conditional-format Store surface, including range shift/move
on structural edits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ReadOnlyStore + YorkieStore implementations

**Files:**
- Modify: `packages/sheets/src/store/readonly.ts`
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-store.ts` (conditional-format methods are the template; imports ~line 14, methods near the existing `get/setConditionalFormats`)
- Test: `packages/sheets/src/store/readonly.test.ts` (append)

**Interfaces:**
- Consumes: the `Store` methods from Task 4.
- Produces: `getDataValidations`/`setDataValidations` on both stores. `ReadOnlyStore.setDataValidations` is a no-op (or throws consistently with its other setters — match the existing `setConditionalFormats` behavior in that file).

- [x] **Step 1: Inspect the ReadOnlyStore convention**

Read how `readonly.ts` implements `setConditionalFormats`/`getConditionalFormats`. Match it exactly (no-op setter returning `Promise.resolve()`, getter returning `[]` or the wrapped source).

- [x] **Step 2: Write the failing test**

```typescript
it('exposes data validations read-only', async () => {
  const store = new ReadOnlyStore(/* existing constructor args used by sibling tests */);
  expect(await store.getDataValidations()).toEqual([]);
  await expect(store.setDataValidations([])).resolves.toBeUndefined();
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- readonly`
Expected: FAIL — method missing.

- [x] **Step 4: Implement ReadOnlyStore**

Add both methods mirroring its `setConditionalFormats`/`getConditionalFormats`.

- [x] **Step 5: Implement YorkieStore**

Mirror the existing `setConditionalFormats`/`getConditionalFormats` in `yorkie-store.ts`: read/write `root.sheets[tabId].dataValidations`, normalizing on read and clone-on-write with the same helpers (import `normalizeDataValidationRule`, `cloneDataValidationRule` next to line 14). Seed the array if absent, exactly as the conditional-format path does. Because rules live at the worksheet level (not on cells), `normalizeCell` needs no change.

- [x] **Step 6: Run the sheets test suite**

Run: `pnpm --filter @wafflebase/sheets test -- readonly`
Expected: PASS. (YorkieStore is exercised by the frontend/integration suites; the round-trip is asserted at the MemStore level in Task 4.)

- [x] **Step 7: Verify frontend builds**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: build succeeds (type-checks the YorkieStore change).

- [x] **Step 8: Commit**

```bash
git add packages/sheets/src/store/readonly.ts \
  packages/sheets/src/store/readonly.test.ts \
  packages/frontend/src/app/spreadsheet/yorkie-store.ts
git commit -m "feat(sheets): data-validation in ReadOnlyStore + YorkieStore" \
  -m "Complete the Store surface across all three implementations. Yorkie
persists rules at root.sheets[tab].dataValidations; no cell schema change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Spreadsheet facade API — read rules, insert & toggle checkbox

**Files:**
- Modify: `packages/sheets/src/view/spreadsheet.ts` (next to `getConditionalFormats`, ~line 293)
- Test: `packages/sheets/src/view/spreadsheet.test.ts` (append; confirm the file name)

**Interfaces:**
- Consumes: `Store.get/setDataValidations`, `resolveDataValidationAt`, `toggleCheckboxValue`, the current selection API used elsewhere in `spreadsheet.ts`.
- Produces:
  - `getDataValidations(): DataValidationRule[]` (sync, cached like `getConditionalFormats`)
  - `insertCheckbox(range: Range): Promise<void>` — creates a `kind:'checkbox'` rule over the range and initializes empty cells to `FALSE`
  - `toggleCheckboxAt(ref: Ref): Promise<boolean>` — toggles the cell if it carries a checkbox rule; returns whether a toggle happened

- [x] **Step 1: Write the failing test**

```typescript
it('inserts a checkbox rule and toggles a cell', async () => {
  const s = /* construct Spreadsheet with a MemStore, per sibling tests */;
  await s.insertCheckbox([
    { r: 1, c: 1 },
    { r: 1, c: 1 },
  ]);
  expect(s.getDataValidations()).toHaveLength(1);
  expect(await s.toggleCheckboxAt({ r: 1, c: 1 })).toBe(true);
  // toggling a cell with no rule does nothing
  expect(await s.toggleCheckboxAt({ r: 9, c: 9 })).toBe(false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- spreadsheet`
Expected: FAIL — `insertCheckbox is not a function`.

- [x] **Step 3: Implement the facade methods**

Follow the `getConditionalFormats` accessor pattern (line 293) for the cached getter. For `insertCheckbox`, generate an id (use the same id scheme as conditional formats — check how `addConditionalFormat`/rule ids are created and reuse it; if none, use a `dv-` prefixed counter/uuid already available in the codebase), append the rule via `setDataValidations`, and set each empty cell in the range to `{ v: 'FALSE' }` inside a `beginBatch()`/`endBatch()` so insert + init is one undo step. For `toggleCheckboxAt`, resolve the rule with `resolveDataValidationAt`; if absent return `false`; else read the cell, compute `toggleCheckboxValue`, `store.set` the new `v`, return `true`.

```typescript
public getDataValidations(): DataValidationRule[] {
  return this.sheet?.getDataValidations() || [];
}
```

(The `sheet` accessor here follows whatever async/cache convention `getConditionalFormats` uses — match it; if `getConditionalFormats` reads from a synced cache, add `dataValidations` to the same cache refresh in `worksheet.ts:5066` where `getConditionalFormats()` is already fetched.)

- [x] **Step 4: Add dataValidations to the render-data fetch**

At `packages/sheets/src/view/worksheet.ts:5066`, where `sheet.getConditionalFormats()` is fetched for rendering, fetch `sheet.getDataValidations()` alongside it and thread it into the cache the facade getter reads (mirror the conditionalFormats plumbing precisely).

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- spreadsheet`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/view/spreadsheet.ts \
  packages/sheets/src/view/worksheet.ts \
  packages/sheets/src/view/spreadsheet.test.ts
git commit -m "feat(sheets): Spreadsheet insertCheckbox + toggleCheckboxAt API" \
  -m "Facade over the data-validation store: create a checkbox rule over a
range (empty cells init to FALSE) and toggle a single checkbox cell, each
as one undo step.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Canvas checkbox render pass

**Files:**
- Modify: `packages/sheets/src/view/gridcanvas.ts` (thread `dataValidations` into the renderer like `conditionalFormats` at lines 90/148/230/266/303; add `renderCellCheckbox` modeled on `renderCellFilterButton` at line 811; call it in `renderQuadrantCells` after content Pass 3, ~line 590)
- Test: `packages/sheets/src/view/gridcanvas.test.ts` (append; confirm file name)

**Interfaces:**
- Consumes: `resolveDataValidationAt`, `isCheckboxChecked`, `DataValidationRule[]`, `toCellRect` (line 1632), the `getThemeColor` + `Path2D` helpers used by `renderCellFilterButton`.
- Produces: a checkbox glyph drawn for each cell whose ref resolves to a `kind:'checkbox'` rule (filled/checked vs empty box).

- [x] **Step 1: Write the failing test**

Assert that, given a checkbox rule over `A1` and a mock 2D context, the renderer issues box-drawing calls for that cell. Follow the existing gridcanvas test harness (mock `CanvasRenderingContext2D`, spy on `strokeRect`/`fillRect`/`stroke`). Example shape:

```typescript
it('draws a checkbox glyph for a checkbox-ruled cell', () => {
  const ctx = createMockCtx(); // per existing gridcanvas tests
  const rules: DataValidationRule[] = [
    { id: 'a', kind: 'checkbox', ranges: [[{ r: 1, c: 1 }, { r: 1, c: 1 }]] },
  ];
  renderGridWith(ctx, { cells: { A1: { v: 'TRUE' } }, dataValidations: rules });
  // a checked box strokes the tick path / fillRect for the box background
  expect(ctx.strokeRect).toHaveBeenCalled(); // or the box/stroke spy used in-file
});
```

(Match the actual mock/spy utilities already in `gridcanvas.test.ts`; do not introduce a new harness.)

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test -- gridcanvas`
Expected: FAIL — no box drawn (or `renderCellCheckbox` undefined).

- [x] **Step 3: Thread dataValidations through the renderer**

At each site where `conditionalFormats` is passed (gridcanvas.ts:90, 148, 230, 266, 303), add a sibling `dataValidations?: DataValidationRule[]` parameter/argument. This is mechanical — follow the conditionalFormats thread exactly.

- [x] **Step 4: Implement `renderCellCheckbox`**

Model on `renderCellFilterButton` (line 811): compute `rect = toCellRect(...)`, bail if `width<=6||height<=6`, center a ~14px square, draw the box border (`ctx.strokeRect`), and when `isCheckboxChecked(rule, cell?.v)` fill the box (`getThemeColor('selectionBGColor')`) and stroke a check path (a cached `Path2D`, mirroring `getFilterIconPath2D`, with the same `Path2D`-undefined fallback that draws the tick via `moveTo`/`lineTo`). Use `getThemeColor` for colors.

- [x] **Step 5: Call it in the render loop**

In `renderQuadrantCells`, after the content pass (`renderCellContent`, ~line 590) and before/near the filter-button pass, resolve the rule per cell:

```typescript
if (dataValidations?.length) {
  const rule = resolveDataValidationAt(id, dataValidations);
  if (rule?.kind === 'checkbox') {
    this.renderCellCheckbox(ctx, id, scroll, rowDim, colDim, mergeSpan, cell);
  }
}
```

When a checkbox is drawn, skip drawing the cell's `TRUE`/`FALSE` text (GS parity) — guard `renderCellContent` for that cell, or draw the checkbox in place of text. Choose the minimal guard consistent with how `renderCellContent` is invoked.

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test -- gridcanvas`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/sheets/src/view/gridcanvas.ts \
  packages/sheets/src/view/gridcanvas.test.ts
git commit -m "feat(sheets): render checkbox glyph for checkbox-ruled cells" \
  -m "New render pass modeled on the filter button: checked box fills + tick
path, unchecked box outline, replacing TRUE/FALSE text.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Click + Space toggle interaction

**Files:**
- Modify: `packages/sheets/src/view/worksheet.ts` (add `detectCheckbox` near `detectFilterButton` line 1194; branch in the mousedown handler near line 2531; branch in the keydown handler where Space/selection keys are handled)
- Test: covered by manual smoke in Task 9 + an interaction unit test if the file has one; otherwise assert `detectCheckbox` geometry in a small unit test.

**Interfaces:**
- Consumes: `Spreadsheet.toggleCheckboxAt`, `getDataValidations`, `resolveDataValidationAt`, `toRefFromMouse`, the checkbox rect geometry from Task 7 (extract a shared `getCheckboxRect(ref)` if the render code computed it inline).
- Produces: click-on-box and Space-on-selection toggling.

- [x] **Step 1: Add `detectCheckbox(x, y): Ref | null`**

Mirror `detectFilterButton` (line 1194): map mouse → ref via `toRefFromMouse`; resolve the rule via `resolveDataValidationAt(ref, this.sheet.getDataValidations())`; if it is a checkbox rule and `(x,y)` falls within the checkbox rect (reuse the same rect math as the renderer — factor it into a shared helper to avoid drift), return `ref`; else `null`.

- [x] **Step 2: Branch in mousedown**

Near line 2531, before normal selection handling, add:

```typescript
const checkboxRef = this.detectCheckbox(x, y);
if (checkboxRef) {
  void this.spreadsheet.toggleCheckboxAt(checkboxRef).then((toggled) => {
    if (toggled) this.render();
  });
  return;
}
```

Guard on store writability (skip when read-only), matching how other mutations are gated in this file.

- [x] **Step 3: Branch in keydown for Space**

Where the key handler processes printable/space keys, if the active selection's anchor cell carries a checkbox rule, prevent default and toggle every checkbox cell in the selection within a `beginBatch()`/`endBatch()`, then re-render. Use `getDataValidations` + `resolveDataValidationAt` per cell; for a multi-cell selection set all to checked (GS/Excel parity) rather than per-cell flip.

- [x] **Step 4: Manual verification**

Run the app (Task 9) — this task has no isolated automated assertion beyond `detectCheckbox` geometry. If `worksheet.ts` has an interaction test harness, add a `detectCheckbox` hit/miss test there.

- [x] **Step 5: Run the full sheets suite + lint**

Run: `pnpm verify:fast`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/view/worksheet.ts
git commit -m "feat(sheets): toggle checkbox cells via click and Space" \
  -m "Hit-test modeled on the filter button; Space toggles the whole
selection (all-checked on a range), each toggle a single undo step,
gated on store writability.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Frontend insert entry point + manual smoke

**Files:**
- Modify: the Sheets toolbar/menu component in `packages/frontend` that hosts insert actions (locate via `grep -rn "Insert" packages/frontend/src` near the spreadsheet toolbar; follow the sibling of an existing insert action such as chart/image insertion).
- Test: manual smoke (`pnpm dev`).

**Interfaces:**
- Consumes: `Spreadsheet.insertCheckbox(range)` and the current selection range accessor already used by other toolbar actions.

- [x] **Step 1: Add an "Insert → Checkbox" action**

Wire a toolbar/menu item that reads the current selection range and calls `spreadsheet.insertCheckbox(range)`. Follow the exact pattern of an existing insert action (imports, permission gating, disabled-when-read-only). Keep it minimal — the full Data-validation side panel is a later phase.

- [x] **Step 2: Build the frontend**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: build succeeds.

- [x] **Step 3: Manual smoke**

Run: `docker compose up -d && pnpm dev`
Then in the browser (`:5173`):
1. Select `A1:A3`, Insert → Checkbox → three unchecked boxes appear, cells read `FALSE`.
2. Click a box → toggles to checked, cell reads `TRUE`; formula `=COUNTIF(A1:A3, TRUE)` returns the checked count.
3. Select the range, press Space → all boxes check.
4. Insert a row above row 1 → boxes move down with their cells (shift works).
5. Copy `A1` to `C1` → the checkbox value copies as `TRUE`/`FALSE` (note: the *rule* does not follow a plain value copy — this is expected for Phase 1; document as a known limitation).
6. Open the same doc in a second tab → toggling a box in one tab reflects in the other (Yorkie sync).

- [x] **Step 4: Capture lessons + commit**

Record anything surprising (esp. the render/interaction rect-sharing and any `getConditionalFormats` cache plumbing quirks) in `docs/tasks/active/20260710-sheet-data-validation-checkbox-lessons.md`.

```bash
git add packages/frontend/src \
  docs/tasks/active/20260710-sheet-data-validation-checkbox-lessons.md
git commit -m "feat(frontend): Insert Checkbox toolbar action" \
  -m "Minimal entry point for Phase 1 checkbox controls; full data-validation
panel deferred to a later phase.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope for this plan (later phases / plans)

- **Phase 2 — List dropdown**: arrow glyph, anchored list popover, `onInvalid` reject/warning on typed commit, literal value lists. Reuses Tasks 1–8 spine.
- **Phase 3 — Date picker**: calendar popover on double-click, `dateMin`/`dateMax` validation, warning-triangle marker.
- **Full Data-validation side panel**: view/edit/delete all rules, criteria editor, per-rule reject/warning.
- **List source = range reference**, colored chips, custom checkbox values, custom-formula criteria — Non-Goals in the design doc.

## Self-review notes

- **Spec coverage**: Phase 1 covers the design doc's model, storage/Store, checkbox render, checkbox interaction, and a minimal insert UI. List/date/panel are explicitly deferred (design doc phases 2–3).
- **Async signatures**: plan uses `Promise`-based Store methods, correcting the design doc's sync `getValidationAt`/`getDataValidations` sketch — update the doc to match during Task 4 (change the two signatures to `Promise<...>` and note `resolveDataValidationAt` is the pure model helper).
- **Type consistency**: helper names are stable across tasks — `normalizeDataValidationRule`, `cloneDataValidationRule`, `resolveDataValidationAt`, `shiftDataValidationRules`, `moveDataValidationRules`, `isCheckboxChecked`, `toggleCheckboxValue`; facade `insertCheckbox`/`toggleCheckboxAt`; renderer `renderCellCheckbox`; hit-test `detectCheckbox`.
