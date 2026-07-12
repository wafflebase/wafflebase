# Sheets Date Data Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `kind: 'date'` data validation to Sheets with the full Google Sheets date-operator set and a double-click calendar picker, reusing the shipped checkbox/list spine.

**Architecture:** A generic `operator` + `values[]` model on `DataValidationRule` (shaped for future number/text reuse) drives a pure `isValidDateValue` check. Rendering adds only a warning marker (no persistent glyph, GS parity). Interaction generalizes the existing list reject/tooltip plumbing to dispatch by kind and adds a DOM calendar popover modeled on the existing `listPopover`. The side panel gains a Date criteria section.

**Tech Stack:** TypeScript, Vitest (sheets unit tests), Canvas 2D (gridcanvas render), raw-DOM overlays (worksheet view), React + shadcn (frontend panel). No new dependencies — native `Date` for month math, existing `inferInput` for date parsing.

> **Status: SHIPPED (PR #470) — this is the original plan, kept as a historical
> record.** All tasks are complete (see the companion `*-todo.md` Review
> section). A high-effort branch review then hardened two behaviors, so the
> code below is superseded where it differs from the shipped result — the
> **design doc's "Phase 4 → Review hardening" section governs the as-shipped
> contract**:
> - **Operand normalization** keeps a fixed-length slot per operand (`''` for a
>   blank one), removing `values` only when *every* slot is empty — it does
>   **not** stop at the first gap or compact to `[]` as the Task 1 snippet shows.
> - **`dateWithinRuleBounds`** defers entirely to `isValidDateValue` (so the
>   `dateNotBetween` interior window is disabled in the picker) rather than
>   early-returning `true` for `dateNotBetween` as the Task 5 snippet shows.

## Global Constraints

- **No new dependency in `packages/sheets`** — use native `Date` and the existing `inferInput` (`packages/sheets/src/model/worksheet/input.ts`) for all date parsing/normalization. No `date-fns` in sheets.
- **Store abstraction** — all rule reads/writes go through `Store.get/setDataValidations`; both `MemStore` and `YorkieStore` already route rules through `normalizeDataValidationRule` + `cloneDataValidationRule`, so a model-only change round-trips through both with no store edit (verify `cloneDataValidationRule` deep-copies `values`).
- **ANTLR generated files** — not touched by this work.
- **Date value storage** — a date cell stores an ISO `yyyy-mm-dd` string in `v` with `s.nf = 'date'`. ISO `yyyy-mm-dd` strings compare lexicographically = chronologically. Never introduce a serial-number representation.
- **Empty-value parity** — an empty/cleared cell is always valid (a rule never blocks deleting a cell), matching `isValidListValue`.
- **Formulas pass reject** — an `=`-prefixed typed value is never reject-blocked; it is validated by its computed value at render (warning marker), matching the list precedent.
- **Read-only stores** render values but skip every mutation/interaction branch (`this.readOnly` guard).
- **Fixed-date operands only** — relative operands ("today") are out of scope.
- Each commit must pass `pnpm --filter @wafflebase/sheets test` (or `pnpm verify:fast` at the end). Commit subject ≤70 chars, body explains why, English only.

---

### Task 1: Model types, clone & normalize

**Files:**
- Modify: `packages/sheets/src/model/core/types.ts` (DataValidationRule ~145-162)
- Modify: `packages/sheets/src/model/worksheet/data-validation.ts`
- Modify: `packages/sheets/src/index.ts` (exports)
- Test: `packages/sheets/src/model/worksheet/data-validation.test.ts`

**Interfaces:**
- Produces:
  - `type DataValidationOperator = 'dateValid' | 'dateEquals' | 'dateBefore' | 'dateOnOrBefore' | 'dateAfter' | 'dateOnOrAfter' | 'dateBetween' | 'dateNotBetween'`
  - `DataValidationRule` gains `operator?: DataValidationOperator` and `values?: string[]`; loses `dateMin`/`dateMax`.
  - `dateValidationOperandCount(op: DataValidationOperator): number` — 0/1/2.
  - `cloneDataValidationRule` deep-copies `values`.
  - `normalizeDataValidationRule` normalizes a `date` rule (operator default `dateValid`, ISO-normalize operands, default `onInvalid: 'warning'`, never drop for missing operands).

- [ ] **Step 1: Write the failing test**

Add to `data-validation.test.ts` (after the existing `dateRule`-free section; also add a `dateRule` helper next to `checkboxRule`/`listRule`):

```typescript
const dateRule = (
  id: string,
  patch: Partial<DataValidationRule> = {},
): DataValidationRule => ({
  id,
  kind: 'date',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
  ...patch,
});

describe('date rule normalization', () => {
  it('defaults operator to dateValid and onInvalid to warning', () => {
    const out = normalizeDataValidationRule(dateRule('d1'));
    expect(out).not.toBeNull();
    expect(out!.operator).toBe('dateValid');
    expect(out!.onInvalid).toBe('warning');
    expect(out!.values).toBeUndefined();
  });

  it('normalizes operands to ISO and keeps the operator', () => {
    const out = normalizeDataValidationRule(
      dateRule('d2', { operator: 'dateBetween', values: ['2026-01-05', '2026-02-10'] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual(['2026-01-05', '2026-02-10']);
  });

  it('drops un-parseable operands but never drops the rule', () => {
    const out = normalizeDataValidationRule(
      dateRule('d3', { operator: 'dateAfter', values: ['not-a-date'] }),
    );
    expect(out).not.toBeNull();
    expect(out!.operator).toBe('dateAfter');
    expect(out!.values).toEqual([]);
  });

  it('deep-copies values via cloneDataValidationRule', () => {
    const rule = dateRule('d4', { operator: 'dateAfter', values: ['2026-01-01'] });
    const clone = cloneDataValidationRule(rule);
    clone.values![0] = 'mutated';
    expect(rule.values![0]).toBe('2026-01-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test data-validation`
Expected: FAIL — `operator`/`values` not on the type, normalize ignores date branch.

- [ ] **Step 3: Update the type** (`types.ts`)

Replace the date fields in `DataValidationRule`:

```typescript
/**
 * DataValidationOperator enumerates the comparison operators. Date operators
 * ship first; number/text operators reuse this union later.
 */
export type DataValidationOperator =
  | 'dateValid'
  | 'dateEquals'
  | 'dateBefore'
  | 'dateOnOrBefore'
  | 'dateAfter'
  | 'dateOnOrAfter'
  | 'dateBetween'
  | 'dateNotBetween';
```

In `DataValidationRule`, delete:

```typescript
  // kind: 'date'
  dateMin?: string;        // ISO lower bound, optional
  dateMax?: string;        // ISO upper bound, optional
```

and add (after the checkbox fields):

```typescript
  // kind: 'date' (operator + fixed-date operands; future: number/text)
  operator?: DataValidationOperator;
  values?: string[];       // ISO operands; length by operator (0/1/2)
```

- [ ] **Step 4: Implement clone + normalize + operand count** (`data-validation.ts`)

Add the operator import and helpers. Update `Kinds` is already `['checkbox','list','date']`.

Add near the top (after `CHECKBOX_FALSE`):

```typescript
import { inferInput } from './input';
import { DataValidationOperator } from '../core/types';
```

Add operand-count + ISO helpers and the date branch:

```typescript
/**
 * `dateValidationOperandCount` returns how many comparison operands an
 * operator consumes: 0 for `dateValid`, 2 for between/not-between, else 1.
 */
export function dateValidationOperandCount(op: DataValidationOperator): number {
  if (op === 'dateValid') return 0;
  if (op === 'dateBetween' || op === 'dateNotBetween') return 2;
  return 1;
}

/**
 * `toIsoDateOperand` normalizes a raw operand to an ISO `yyyy-mm-dd` string via
 * the shared input parser, or returns undefined when it is not a date.
 */
function toIsoDateOperand(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const inferred = inferInput(raw.trim());
  return inferred.type === 'date' ? inferred.value : undefined;
}
```

Update `cloneDataValidationRule` to deep-copy `values`:

```typescript
export function cloneDataValidationRule(
  rule: DataValidationRule,
): DataValidationRule {
  return {
    ...rule,
    ranges: rule.ranges.map((r) => cloneRange(r)),
    list: rule.list ? [...rule.list] : undefined,
    values: rule.values ? [...rule.values] : undefined,
  };
}
```

Add a date branch to `normalizeDataValidationRule` (after the existing `list` branch, before `return cloned;`):

```typescript
  if (cloned.kind === 'date') {
    const op: DataValidationOperator = cloned.operator ?? 'dateValid';
    const need = dateValidationOperandCount(op);
    const operands: string[] = [];
    for (let i = 0; i < need; i++) {
      const iso = toIsoDateOperand(cloned.values?.[i]);
      if (iso) operands.push(iso);
    }
    cloned.operator = op;
    cloned.values = operands.length > 0 ? operands : undefined;
    cloned.onInvalid = cloned.onInvalid ?? 'warning';
  }
```

- [ ] **Step 5: Export new symbols** (`index.ts`)

In the `from './model/worksheet/data-validation'` import+export blocks add `dateValidationOperandCount`. In the type export block add `DataValidationOperator` (from `./model/core/types`).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test data-validation`
Expected: PASS (all four new cases + existing suite green).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @wafflebase/sheets exec tsc --noEmit`
Expected: no errors (confirms no remaining `dateMin`/`dateMax` readers).

- [ ] **Step 8: Commit**

```bash
git add packages/sheets/src/model/core/types.ts packages/sheets/src/model/worksheet/data-validation.ts packages/sheets/src/model/worksheet/data-validation.test.ts packages/sheets/src/index.ts
git commit -m "Add operator/values model for date data validation"
```

---

### Task 2: Date validation logic

**Files:**
- Modify: `packages/sheets/src/model/worksheet/data-validation.ts`
- Modify: `packages/sheets/src/index.ts` (exports)
- Test: `packages/sheets/src/model/worksheet/data-validation.test.ts`

**Interfaces:**
- Consumes: `dateValidationOperandCount`, `toIsoDateOperand` (Task 1), `inferInput`.
- Produces:
  - `isValidDateValue(rule: DataValidationRule, value: string | undefined): boolean`
  - `isValidValueForRule(rule: DataValidationRule, value: string | undefined): boolean` — dispatches list→`isValidListValue`, date→`isValidDateValue`, else `true`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('isValidDateValue', () => {
  const v = (op: DataValidationRule['operator'], values?: string[]) =>
    normalizeDataValidationRule(dateRule('x', { operator: op, values }))!;

  it('allows empty values', () => {
    expect(isValidDateValue(v('dateValid'), '')).toBe(true);
    expect(isValidDateValue(v('dateValid'), undefined)).toBe(true);
  });

  it('dateValid accepts any parseable date, rejects non-dates', () => {
    expect(isValidDateValue(v('dateValid'), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateValid'), 'hello')).toBe(false);
  });

  it('compares before / after / on-or-* correctly (inclusive edges)', () => {
    expect(isValidDateValue(v('dateBefore', ['2026-03-15']), '2026-03-14')).toBe(true);
    expect(isValidDateValue(v('dateBefore', ['2026-03-15']), '2026-03-15')).toBe(false);
    expect(isValidDateValue(v('dateOnOrBefore', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateAfter', ['2026-03-15']), '2026-03-16')).toBe(true);
    expect(isValidDateValue(v('dateOnOrAfter', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateEquals', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateEquals', ['2026-03-15']), '2026-03-16')).toBe(false);
  });

  it('between is inclusive; not-between is its negation', () => {
    const b = v('dateBetween', ['2026-01-01', '2026-12-31']);
    expect(isValidDateValue(b, '2026-01-01')).toBe(true);
    expect(isValidDateValue(b, '2026-12-31')).toBe(true);
    expect(isValidDateValue(b, '2027-01-01')).toBe(false);
    const nb = v('dateNotBetween', ['2026-01-01', '2026-12-31']);
    expect(isValidDateValue(nb, '2026-06-01')).toBe(false);
    expect(isValidDateValue(nb, '2027-01-01')).toBe(true);
  });

  it('falls back to date-valid when operands are incomplete', () => {
    // operator kept but operand dropped by normalize → only "is a date" enforced
    const r = v('dateAfter', ['not-a-date']);
    expect(isValidDateValue(r, '2026-03-15')).toBe(true);
    expect(isValidDateValue(r, 'hello')).toBe(false);
  });
});

describe('isValidValueForRule dispatch', () => {
  it('dispatches by kind', () => {
    expect(isValidValueForRule(listRule('l', ['A']), 'B')).toBe(false);
    expect(isValidValueForRule(dateRule('d', { operator: 'dateValid' }), 'hello')).toBe(false);
    expect(isValidValueForRule(checkboxRule('c'), 'anything')).toBe(true);
  });
});
```

Add `isValidDateValue`, `isValidValueForRule` to the test's import list from `./data-validation`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/sheets test data-validation`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the validators** (`data-validation.ts`)

```typescript
/**
 * `isValidDateValue` reports whether a cell value satisfies a date rule. An
 * empty value is always allowed. The value and each operand are normalized to
 * an ISO `yyyy-mm-dd` string (which sorts chronologically) via the shared
 * input parser; a non-date value fails. When the operator's operands are
 * incomplete (normalize dropped an un-parseable operand), only "is a valid
 * date" is enforced, so the rule degrades safely rather than mis-flagging.
 */
export function isValidDateValue(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (value === undefined || value.trim() === '') return true;
  const iso = toIsoDateOperand(value);
  if (iso === undefined) return false;

  const op = rule.operator ?? 'dateValid';
  const need = dateValidationOperandCount(op);
  const operands = rule.values ?? [];
  if (op === 'dateValid' || operands.length < need) return true;

  const a = operands[0];
  switch (op) {
    case 'dateEquals':
      return iso === a;
    case 'dateBefore':
      return iso < a;
    case 'dateOnOrBefore':
      return iso <= a;
    case 'dateAfter':
      return iso > a;
    case 'dateOnOrAfter':
      return iso >= a;
    case 'dateBetween':
      return iso >= a && iso <= operands[1];
    case 'dateNotBetween':
      return iso < a || iso > operands[1];
    default:
      return true;
  }
}

/**
 * `isValidValueForRule` dispatches value validation by rule kind. A checkbox
 * rule never rejects a typed value; list and date delegate to their checks.
 */
export function isValidValueForRule(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (rule.kind === 'list') return isValidListValue(rule, value);
  if (rule.kind === 'date') return isValidDateValue(rule, value);
  return true;
}
```

- [ ] **Step 4: Export** (`index.ts`)

Add `isValidDateValue` and `isValidValueForRule` to the `data-validation` import+export blocks.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/sheets test data-validation`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sheets/src/model/worksheet/data-validation.ts packages/sheets/src/model/worksheet/data-validation.test.ts packages/sheets/src/index.ts
git commit -m "Add isValidDateValue date-rule comparison logic"
```

---

### Task 3: Render date warning marker

**Files:**
- Modify: `packages/sheets/src/view/gridcanvas.ts` (imports ~9-20; Pass 3 branch ~700-716)

**Interfaces:**
- Consumes: `isValidDateValue` (Task 2), `resolveDataValidationAt`, `drawCornerMarker` (existing, `gridcanvas.ts:813`), `toCellRect`.

- [ ] **Step 1: Add the import**

In the `from '../model/worksheet/data-validation'` import (currently `isValidListValue, resolveDataValidationAt`), add `isValidDateValue`:

```typescript
  isValidDateValue,
  isValidListValue,
  resolveDataValidationAt,
```

- [ ] **Step 2: Add the date warning branch**

In `renderQuadrantCells` Pass 3, immediately after the `if (dvRule && dvRule.kind === 'list') { this.renderCellListControl(...) }` block (ends ~line 715), add:

```typescript
      // Date rules have no persistent glyph (GS parity); flag an invalid
      // value (non-date or out-of-bounds) with the same red corner marker
      // the list warning path uses. Computed at render time, never persisted.
      if (dvRule && dvRule.kind === 'date' && !isValidDateValue(dvRule, cell?.v)) {
        const rect = this.toCellRect(
          { r: row, c: col },
          scroll,
          rowDim,
          colDim,
          mergeSpan,
        );
        this.drawCornerMarker(ctx, rect.left + rect.width, rect.top, '#ea4335');
      }
```

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @wafflebase/sheets exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the package**

Run: `pnpm --filter @wafflebase/sheets build`
Expected: success (gridcanvas is view-layer; no unit test — verified by build + manual smoke in Task 7).

- [ ] **Step 5: Commit**

```bash
git add packages/sheets/src/view/gridcanvas.ts
git commit -m "Render warning marker for invalid date-validation cells"
```

---

### Task 4: Commit-path reject + hover tooltip dispatch

**Files:**
- Modify: `packages/sheets/src/view/worksheet.ts` (`commitCellValue` ~743-762; `updateValidationTooltip` ~1695-1741; imports ~30)
- Test: `packages/sheets/src/view/*` — no view unit test exists; covered by the model dispatch test (Task 2) + Task 7 smoke.

**Interfaces:**
- Consumes: `isValidValueForRule`, `isValidDateValue` (Task 2).

- [ ] **Step 1: Update the import** (`worksheet.ts:30`)

Replace `import { isValidListValue } from '../model/worksheet/data-validation';` with:

```typescript
import {
  isValidDateValue,
  isValidValueForRule,
} from '../model/worksheet/data-validation';
```

(If `isValidListValue` is referenced elsewhere in the file, keep it in the list; grep `isValidListValue` in `worksheet.ts` first — as of now it is only used in `commitCellValue` and `updateValidationTooltip`, both edited below.)

- [ ] **Step 2: Generalize `commitCellValue`** (~743)

Replace the list-only reject block:

```typescript
    const rule = this.sheet!.getDataValidationAt(ref);
    // A formula is validated by its computed result at render time (warning
    // marker), not by its literal text — reject only compares literal typed
    // values, so let formulas through here.
    if (
      rule &&
      rule.onInvalid === 'reject' &&
      !value.startsWith('=') &&
      !isValidValueForRule(rule, value)
    ) {
      this.onValidationErrorCallback?.(
        rule.kind === 'date'
          ? `"${value}" is not a valid date for this cell.`
          : `"${value}" does not match a value in the dropdown list.`,
      );
      return false;
    }
    await this.sheet!.setData(ref, value);
    return true;
```

- [ ] **Step 3: Extend `updateValidationTooltip`** (~1718-1740)

Replace the list-only guard/message. Change:

```typescript
    const rule = this.sheet.getDataValidationAt(ref);
    if (!rule || rule.kind !== 'list') {
      this.hideValidationTooltip();
      return;
    }
    const cell = await this.sheet.getCell(ref);
    // The hover may have moved on during the async read; bail if so.
    if (this.hoveredValidationCandidate !== sref) {
      return;
    }
    if (isValidListValue(rule, cell?.v)) {
      this.hideValidationTooltip();
      return;
    }
    const options = rule.list ?? [];
    const shown =
      options.length > 8
        ? `${options.slice(0, 8).join(', ')}, …`
        : options.join(', ');
    this.validationTooltip.textContent = `Invalid entry — must be one of: ${shown}`;
```

to:

```typescript
    const rule = this.sheet.getDataValidationAt(ref);
    if (!rule || (rule.kind !== 'list' && rule.kind !== 'date')) {
      this.hideValidationTooltip();
      return;
    }
    const cell = await this.sheet.getCell(ref);
    // The hover may have moved on during the async read; bail if so.
    if (this.hoveredValidationCandidate !== sref) {
      return;
    }
    if (isValidValueForRule(rule, cell?.v)) {
      this.hideValidationTooltip();
      return;
    }
    let message: string;
    if (rule.kind === 'date') {
      message = 'Invalid entry — enter a valid date for this cell.';
    } else {
      const options = rule.list ?? [];
      const shown =
        options.length > 8
          ? `${options.slice(0, 8).join(', ')}, …`
          : options.join(', ');
      message = `Invalid entry — must be one of: ${shown}`;
    }
    this.validationTooltip.textContent = message;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @wafflebase/sheets exec tsc --noEmit`
Expected: no errors (confirms no dangling `isValidListValue` reference).

- [ ] **Step 5: Commit**

```bash
git add packages/sheets/src/view/worksheet.ts
git commit -m "Enforce date-rule reject on commit and hover tooltip"
```

---

### Task 5: Calendar popover (double-click date entry)

**Files:**
- Modify: `packages/sheets/src/view/worksheet.ts` (field decls ~135-145; constructor create/style ~236-311 + append; dispose ~504-507; `handleDblClickAt` ~1235-1273; new methods near `showListPopover` ~1506)

**Interfaces:**
- Consumes: `getDataValidationAt`, `isValidDateValue`, `dateValidationOperandCount`, `getCellRect`, `toRefFromMouse`, `setData`, `render`, `viewport`, `getThemeColor`.
- Produces (private): `datePopover` field; `showDatePopover(ref)`, `renderDatePopover()`, `hideDatePopover()`, `chooseDateValue(iso)`, `dateWithinRuleBounds(rule, iso)`.

- [ ] **Step 1: Add fields** (after the `listPopoverKeyboardUnsub` field ~145)

```typescript
  private datePopover: HTMLDivElement;
  private datePopoverState: {
    ref: Ref;
    year: number;
    month: number; // 0-11, the displayed month
  } | null = null;
  private datePopoverOutsideClickUnsub: (() => void) | null = null;
  private datePopoverKeyboardUnsub: (() => void) | null = null;
```

- [ ] **Step 2: Create + style + append in the constructor**

Where `this.listPopover = document.createElement('div');` is assigned (~238), add alongside it:

```typescript
    this.datePopover = document.createElement('div');
```

After the `document.body.appendChild(this.listPopover);` block (~311), add a styled clone:

```typescript
    this.datePopover.style.position = 'fixed';
    this.datePopover.style.display = 'none';
    this.datePopover.style.zIndex = '1002';
    this.datePopover.style.pointerEvents = 'auto';
    this.datePopover.style.padding = '6px';
    this.datePopover.style.borderRadius = '6px';
    this.datePopover.style.border = `1px solid ${getThemeColor(theme, 'cellBorderColor')}`;
    this.datePopover.style.backgroundColor = getThemeColor(theme, 'cellBGColor');
    this.datePopover.style.color = getThemeColor(theme, 'cellTextColor');
    this.datePopover.style.fontSize = '12px';
    this.datePopover.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.datePopover.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.2)';
    this.datePopover.style.userSelect = 'none';
    document.body.appendChild(this.datePopover);
```

- [ ] **Step 3: Dispose in the cleanup block** (after `this.listPopover.remove();` ~506)

```typescript
    this.hideDatePopover();
    this.datePopover.remove();
```

- [ ] **Step 4: Branch `handleDblClickAt`** (before the final `this.showCellInput();` ~1273)

```typescript
    // Double-click a date-validated cell → open the calendar picker instead
    // of the inline editor (GS parity). Read-only is already returned above.
    const dblRef = this.toRefFromMouse(x, y);
    const dblRule = this.sheet?.getDataValidationAt(dblRef);
    if (dblRule && dblRule.kind === 'date') {
      void this.showDatePopover(dblRef);
      return;
    }

    this.showCellInput();
```

- [ ] **Step 5: Add the popover methods** (place after `hideListPopover` ~1687)

```typescript
  /**
   * `dateWithinRuleBounds` reports whether an ISO day is selectable under the
   * rule's operator, so out-of-range days render disabled in the picker.
   * `dateNotBetween` deliberately leaves all days enabled (the excluded window
   * is a validity check, not a hard picker bound).
   */
  private dateWithinRuleBounds(rule: DataValidationRule, iso: string): boolean {
    const op = rule.operator ?? 'dateValid';
    const need = dateValidationOperandCount(op);
    const operands = rule.values ?? [];
    if (op === 'dateValid' || op === 'dateNotBetween' || operands.length < need) {
      return true;
    }
    return isValidDateValue(rule, iso);
  }

  /**
   * `showDatePopover` opens a calendar picker anchored to the date-ruled cell.
   * The displayed month starts on the cell's current date if valid, else today.
   */
  private async showDatePopover(ref: Ref): Promise<void> {
    if (this.readOnly || !this.sheet) return;
    const rule = this.sheet.getDataValidationAt(ref);
    if (!rule || rule.kind !== 'date') return;

    this.hideListPopover();
    this.hideValidationTooltip();
    const cell = await this.sheet.getCell(ref);
    const current = cell?.v && /^\d{4}-\d{2}-\d{2}$/.test(cell.v) ? cell.v : null;
    const base = current ? new Date(`${current}T00:00:00`) : new Date();
    this.datePopoverState = {
      ref,
      year: base.getFullYear(),
      month: base.getMonth(),
    };
    this.renderDatePopover();

    const cellRect = this.getCellRect(ref);
    const viewport = this.viewport;
    this.datePopover.style.display = 'block';
    const width = this.datePopover.offsetWidth;
    const height = this.datePopover.offsetHeight;
    const left = Math.min(
      viewport.left + cellRect.left,
      viewport.left + Math.max(0, viewport.width - width - 4),
    );
    const belowTop = viewport.top + cellRect.top + cellRect.height + 2;
    const viewportBottom = viewport.top + viewport.height;
    let top = belowTop;
    if (belowTop + height > viewportBottom) {
      const aboveTop = viewport.top + cellRect.top - height - 2;
      top =
        aboveTop >= viewport.top
          ? aboveTop
          : Math.max(viewport.top + 2, viewportBottom - height - 4);
    }
    this.datePopover.style.left = `${left}px`;
    this.datePopover.style.top = `${top}px`;

    this.datePopoverKeyboardUnsub?.();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!this.datePopoverState) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hideDatePopover();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.datePopoverKeyboardUnsub = () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };

    this.datePopoverOutsideClickUnsub?.();
    requestAnimationFrame(() => {
      if (!this.datePopoverState) return;
      const onMouseDown = (event: MouseEvent) => {
        if (!this.datePopover.contains(event.target as Node)) {
          this.hideDatePopover();
        }
      };
      document.addEventListener('mousedown', onMouseDown);
      this.datePopoverOutsideClickUnsub = () => {
        document.removeEventListener('mousedown', onMouseDown);
      };
    });
  }

  /**
   * `renderDatePopover` builds the month grid: a header with prev/next month
   * navigation, weekday labels, and day cells. Out-of-bounds days (per the
   * rule's operator) render disabled.
   */
  private renderDatePopover(): void {
    const state = this.datePopoverState;
    if (!state || !this.sheet) return;
    const rule = this.sheet.getDataValidationAt(state.ref);
    if (!rule || rule.kind !== 'date') return;

    const { year, month } = state;
    this.datePopover.innerHTML = '';
    this.datePopover.style.width = '224px';

    const text = getThemeColor(this.theme, 'cellTextColor');
    const activeBg = getThemeColor(this.theme, 'headerSelectedBGColor');

    // Header: ‹  Month YYYY  ›
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '2px 4px 6px';
    const mkNav = (label: string, delta: number) => {
      const btn = document.createElement('div');
      btn.textContent = label;
      btn.style.cursor = 'pointer';
      btn.style.padding = '2px 8px';
      btn.style.borderRadius = '4px';
      btn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const m = state.month + delta;
        state.year += Math.floor(m / 12);
        state.month = ((m % 12) + 12) % 12;
        this.renderDatePopover();
      };
      return btn;
    };
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = `${new Date(year, month, 1).toLocaleString('en-US', {
      month: 'long',
    })} ${year}`;
    header.appendChild(mkNav('‹', -1));
    header.appendChild(title);
    header.appendChild(mkNav('›', 1));
    this.datePopover.appendChild(header);

    // Weekday labels + day grid (7 columns).
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gap = '1px';
    for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
      const label = document.createElement('div');
      label.textContent = wd;
      label.style.textAlign = 'center';
      label.style.opacity = '0.6';
      label.style.padding = '2px 0';
      grid.appendChild(label);
    }
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) {
      grid.appendChild(document.createElement('div'));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.textContent = String(day);
      cell.style.textAlign = 'center';
      cell.style.padding = '4px 0';
      cell.style.borderRadius = '4px';
      cell.style.color = text;
      const enabled = this.dateWithinRuleBounds(rule, iso);
      if (enabled) {
        cell.style.cursor = 'pointer';
        cell.onmouseenter = () => {
          cell.style.backgroundColor = activeBg;
        };
        cell.onmouseleave = () => {
          cell.style.backgroundColor = '';
        };
        cell.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.chooseDateValue(iso);
        };
      } else {
        cell.style.opacity = '0.3';
        cell.style.cursor = 'default';
      }
      grid.appendChild(cell);
    }
    this.datePopover.appendChild(grid);
  }

  /**
   * `chooseDateValue` writes the picked ISO day to the popover's cell and
   * closes it. The value goes through `setData`, which stamps `nf: 'date'`.
   */
  private async chooseDateValue(iso: string): Promise<void> {
    const state = this.datePopoverState;
    if (!state || this.readOnly || !this.sheet) {
      this.hideDatePopover();
      return;
    }
    const { ref } = state;
    this.hideDatePopover();
    await this.sheet.setData(ref, iso);
    this.render();
  }

  /**
   * `hideDatePopover` closes the calendar picker.
   */
  private hideDatePopover(): void {
    this.datePopover.style.display = 'none';
    this.datePopover.innerHTML = '';
    this.datePopoverState = null;
    this.datePopoverOutsideClickUnsub?.();
    this.datePopoverOutsideClickUnsub = null;
    this.datePopoverKeyboardUnsub?.();
    this.datePopoverKeyboardUnsub = null;
  }
```

- [ ] **Step 6: Ensure `DataValidationRule` + helpers are imported** in `worksheet.ts`

Confirm `DataValidationRule` is imported (it is used for the method signature). Add `dateValidationOperandCount` to the `data-validation` import from Task 4:

```typescript
import {
  dateValidationOperandCount,
  isValidDateValue,
  isValidValueForRule,
} from '../model/worksheet/data-validation';
```

If `DataValidationRule` is not yet imported in `worksheet.ts`, add it to the `../model/core/types` import.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @wafflebase/sheets exec tsc --noEmit && pnpm --filter @wafflebase/sheets build`
Expected: no errors, build success.

- [ ] **Step 8: Commit**

```bash
git add packages/sheets/src/view/worksheet.ts
git commit -m "Add double-click calendar picker for date validation"
```

---

### Task 6: Data validation panel — Date criteria

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/data-validation-panel.tsx`

**Interfaces:**
- Consumes: `DataValidationOperator`, `dateValidationOperandCount` (exported Tasks 1), `DataValidationRule`.

- [ ] **Step 1: Extend imports**

In the `@wafflebase/sheets` import block add:

```typescript
  DataValidationOperator,
  dateValidationOperandCount,
```

- [ ] **Step 2: Add an operator label map + local date-fields state**

Near the top of the component file (after `formatA1Ranges`), add:

```typescript
const DATE_OPERATORS: { value: DataValidationOperator; label: string }[] = [
  { value: "dateValid", label: "is a valid date" },
  { value: "dateEquals", label: "date is" },
  { value: "dateBefore", label: "date is before" },
  { value: "dateOnOrBefore", label: "date is on or before" },
  { value: "dateAfter", label: "date is after" },
  { value: "dateOnOrAfter", label: "date is on or after" },
  { value: "dateBetween", label: "date is between" },
  { value: "dateNotBetween", label: "date is not between" },
];
```

- [ ] **Step 3: Extend `kindLabel`** (~73)

```typescript
  if (rule.kind === "date") {
    const op = DATE_OPERATORS.find((o) => o.value === (rule.operator ?? "dateValid"));
    return `Date (${op?.label ?? "is a valid date"})`;
  }
```

- [ ] **Step 4: Extend `addRule`** (~149) to seed a date rule

```typescript
      const rule: DataValidationRule =
        kind === "list"
          ? { id, kind: "list", ranges, list: [], showArrow: true, onInvalid: "warning" }
          : kind === "date"
            ? { id, kind: "date", ranges, operator: "dateValid", onInvalid: "warning" }
            : { id, kind: "checkbox", ranges };
```

- [ ] **Step 5: Extend `handleChangeKind`** (~225)

```typescript
  const handleChangeKind = (kind: DataValidationKind) => {
    if (!selectedRule) return;
    if (kind === "list") {
      updateRule(selectedRule.id, {
        kind: "list",
        list: selectedRule.list ?? [],
        showArrow: selectedRule.showArrow ?? true,
        onInvalid: selectedRule.onInvalid ?? "warning",
      });
    } else if (kind === "date") {
      updateRule(selectedRule.id, {
        kind: "date",
        operator: selectedRule.operator ?? "dateValid",
        onInvalid: selectedRule.onInvalid ?? "warning",
      });
    } else {
      // Keep list/date fields so switching back restores them (the engine
      // ignores them for a checkbox rule).
      updateRule(selectedRule.id, { kind: "checkbox" });
    }
  };
```

- [ ] **Step 6: Add the Date criteria `<SelectItem>`** (~372)

```typescript
                  <SelectContent>
                    <SelectItem value="list">Dropdown</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                  </SelectContent>
```

- [ ] **Step 7: Add the Date detail section** (after the `selectedRule.kind === "list"` block, before the checkbox block ~435)

```tsx
              {selectedRule.kind === "date" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="dv-date-op">Condition</Label>
                    <Select
                      value={selectedRule.operator ?? "dateValid"}
                      onValueChange={(v) =>
                        updateRule(selectedRule.id, {
                          operator: v as DataValidationOperator,
                        })
                      }
                    >
                      <SelectTrigger id="dv-date-op">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATE_OPERATORS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {dateValidationOperandCount(
                    selectedRule.operator ?? "dateValid",
                  ) >= 1 && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        aria-label="Date value"
                        value={selectedRule.values?.[0] ?? ""}
                        onChange={(e) => {
                          const next = [...(selectedRule.values ?? [])];
                          next[0] = e.target.value;
                          updateRule(selectedRule.id, { values: next });
                        }}
                      />
                      {dateValidationOperandCount(
                        selectedRule.operator ?? "dateValid",
                      ) === 2 && (
                        <>
                          <span className="text-xs text-muted-foreground">and</span>
                          <Input
                            type="date"
                            aria-label="End date value"
                            value={selectedRule.values?.[1] ?? ""}
                            onChange={(e) => {
                              const next = [...(selectedRule.values ?? [])];
                              next[1] = e.target.value;
                              updateRule(selectedRule.id, { values: next });
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>If the data is invalid</Label>
                    <RadioGroup
                      value={selectedRule.onInvalid ?? "warning"}
                      onValueChange={(v) =>
                        updateRule(selectedRule.id, {
                          onInvalid: v as "reject" | "warning",
                        })
                      }
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="warning" id="dv-date-warning" />
                        <Label htmlFor="dv-date-warning" className="font-normal">
                          Show a warning
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="reject" id="dv-date-reject" />
                        <Label htmlFor="dv-date-reject" className="font-normal">
                          Reject the input
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </>
              )}
```

Note: an in-progress date rule (operator chosen, operands empty) persists as `dateValid` (engine normalize drops incomplete operands); the panel keeps the chosen operator in its own state for the session, matching the zero-option-dropdown precedent — no extra handling needed because `updateRule` writes the whole rule and the engine normalize preserves the operator while clearing bad operands.

- [ ] **Step 8: Typecheck the frontend**

Run: `pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/data-validation-panel.tsx
git commit -m "Add Date criteria to the data validation panel"
```

---

### Task 7: Verify, smoke, docs, lessons

**Files:**
- Modify: `docs/tasks/active/20260711-sheets-date-validation-todo.md` (Review section)
- Create: `docs/tasks/active/20260711-sheets-date-validation-lessons.md`
- Modify: `docs/tasks/README.md` (index)
- (Design doc `docs/design/sheets/data-validation.md` Phase 4 section already written.)

- [ ] **Step 1: Full fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests pass. (Known caveat from memory: a pre-existing slides `.at()` typecheck error may fail local `verify:fast` and is unrelated — confirm the only failure, if any, is that one before proceeding.)

- [ ] **Step 2: Manual smoke** in `pnpm dev`

Verify each behavior and note the result in the todo Review section:
1. Panel → Add → criteria Date → `date is between` 2026-01-01 and 2026-12-31, Reject. Type `2027-01-01` into a ruled cell → rejected (toast, caret stays). Type `2026-06-01` → accepted.
2. Switch the same rule to Warning → type `2027-01-01` → stored with a red top-right marker; hover shows the tooltip.
3. Double-click a ruled cell → calendar opens; out-of-range days are disabled; pick an in-range day → cell shows the ISO date right-aligned; `Esc` and outside-click close.
4. `date is after 2026-06-01`: calendar disables ≤ that day.
5. Sort/copy a ruled cell → value moves with the cell; a shared read-only view renders values + markers but the calendar does not open on double-click.

- [ ] **Step 3: Write the lessons file**

Create `docs/tasks/active/20260711-sheets-date-validation-lessons.md` capturing: the generic `operator`+`values` decision (reuse for number/text), the "incomplete operands degrade to date-valid" rule, and the calendar-popover-mirrors-listPopover pattern.

- [ ] **Step 4: Update todo Review + tasks index**

Fill the Review section of the todo file; run `pnpm tasks:index` if it regenerates `docs/tasks/README.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/tasks/active/20260711-sheets-date-validation-todo.md docs/tasks/active/20260711-sheets-date-validation-lessons.md docs/tasks/README.md docs/design/sheets/data-validation.md
git commit -m "Document date data validation task and lessons"
```

- [ ] **Step 6: Branch review before PR**

Dispatch `/code-review` over the full branch diff (per CLAUDE.md step 3); apply blocking findings, note non-blocking as known limitations, then open the PR (Summary + Test plan).

---

## Self-Review notes

- **Spec coverage:** model (Task 1) · validation logic (Task 2) · render marker (Task 3) · commit reject + tooltip (Task 4) · calendar picker (Task 5) · panel UI (Task 6) · docs/verify/smoke (Task 7). Every "Phase 4 (date)" design bullet maps to a task.
- **Store change:** none needed — both stores route through `normalizeDataValidationRule`/`cloneDataValidationRule`; Task 1 Step 4 makes `cloneDataValidationRule` deep-copy `values`, so round-trip is covered.
- **Type consistency:** `operator`/`values` names, `DataValidationOperator` union, `dateValidationOperandCount`, `isValidDateValue`, `isValidValueForRule` are used identically across tasks 1–6.
- **Deferred (documented in design):** relative operands, reject-on-paste, keyboard day navigation in the picker.
