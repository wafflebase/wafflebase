# Data Validation Side Panel — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax.

Design: `docs/design/sheets/data-validation.md` → "Phase 3 (UI): Data validation
side panel — design". Branch: `feat/data-validation-list` (same PR as list dropdown).

**Goal:** Replace the minimal dropdown insert dialog with a right-side Data
validation management panel (rule list + editor) mirroring `ConditionalFormatPanel`,
supporting Checkbox + Dropdown criteria.

**Architecture:** New lazy-loaded `DataValidationPanel.tsx` sharing the right-side
slot with the CF/Chart panels (mutually exclusive). Reads via
`spreadsheet.getDataValidations()`, writes the full rule array via a new
`spreadsheet.setDataValidations()` (atomic, one undo unit). No engine/model change.

**Tech Stack:** React + TypeScript, `@wafflebase/sheets` API, shadcn/ui
(Button/Input/Label/Separator/Select/RadioGroup/Switch), sonner toasts, Tabler icons.

## Global Constraints

- v1 criteria: `checkbox` + `list` only. No date/number/text/custom-formula.
- Whole-rule management (add/edit/delete); no range subtraction.
- Checkbox values fixed to `TRUE`/`FALSE` (no custom values in v1).
- Follow the existing panel precedent: **frontend panels have no component unit
  tests** in this repo; verify via `tsc --noEmit`, production build, and a manual
  browser smoke (the sheets dev harness works without auth). Do NOT invent a React
  test harness.
- Each commit: `pnpm verify:fast` green.

## File structure

- Create: `packages/frontend/src/app/spreadsheet/data-validation-panel.tsx` — the panel.
- Modify: `packages/sheets/src/view/spreadsheet.ts` — add public `setDataValidations`.
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx` — wire panel, repoint
  dropdown button, remove dialog usage + dead state/handlers.
- Modify: `packages/frontend/src/components/sheet-context-menu.tsx` — add
  `onOpenDataValidation` item.
- Delete: `packages/frontend/src/app/spreadsheet/dropdown-options-dialog.tsx`.

---

### Task 1: Add `Spreadsheet.setDataValidations` (view API)

**Files:**
- Modify: `packages/sheets/src/view/spreadsheet.ts` (after `getDataValidations`, ~line 315)

**Interfaces:**
- Produces: `public async setDataValidations(rules: DataValidationRule[]): Promise<void>`
- Consumes: existing `Sheet.setDataValidations` (already present, normalizes+persists).

- [ ] **Step 1: Add the method** after `getDataValidations()` (mirrors `setConditionalFormats`):

```typescript
  /**
   * `setDataValidations` replaces all data-validation rules and re-renders.
   */
  public async setDataValidations(
    rules: DataValidationRule[],
  ): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.setDataValidations(rules);
    this.worksheet.render();
    this.notifySelectionChange();
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/sheets && pnpm exec tsc --noEmit`
Expected: `No errors found`

- [ ] **Step 3: Rebuild the workspace package** (frontend dev alias uses source, but
      keep dist current for builds)

Run: `pnpm --filter @wafflebase/sheets build`
Expected: `✓ built`

- [ ] **Step 4: Commit**

```bash
git add packages/sheets/src/view/spreadsheet.ts
git commit -m "Sheets: public Spreadsheet.setDataValidations for the panel"
```

---

### Task 2: Create the `DataValidationPanel` component

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/data-validation-panel.tsx`

**Interfaces:**
- Produces (default export named): `export function DataValidationPanel(props: DataValidationPanelProps)`
  where
  ```typescript
  type DataValidationPanelProps = {
    spreadsheet: Spreadsheet | undefined;
    open: boolean;
    onClose: () => void;
    getSelectionRange: () => string | null;
    // When set and no rule exists at the active cell, auto-add a rule of this
    // kind for the selection on open (used by the dropdown toolbar button).
    autoAddKind?: DataValidationKind | null;
  };
  ```
- Consumes: `spreadsheet.getDataValidations()`, `spreadsheet.setDataValidations(rules)`,
  `spreadsheet.getListRuleAt()` (returns the list rule at the active cell or undefined),
  and `@wafflebase/sheets` exports `DataValidationRule`, `DataValidationKind`, `Range`,
  `parseRef`, `toSref`, `normalizeListOptions`.

- [ ] **Step 1: Write the full component file**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataValidationRule,
  DataValidationKind,
  Range,
  Spreadsheet,
  parseRef,
  toSref,
  normalizeListOptions,
} from "@wafflebase/sheets";
import { toast } from "sonner";
import { IconPlus, IconX, IconListCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DataValidationPanelProps = {
  spreadsheet: Spreadsheet | undefined;
  open: boolean;
  onClose: () => void;
  getSelectionRange: () => string | null;
  autoAddKind?: DataValidationKind | null;
};

// A1-range parsing/formatting — same shape as ConditionalFormatPanel.
function parseA1Ranges(input: string): Range[] | null {
  const segments = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

function formatA1Ranges(ranges: Range[]): string {
  return ranges.map((r) => `${toSref(r[0])}:${toSref(r[1])}`).join(", ");
}

function kindLabel(rule: DataValidationRule): string {
  if (rule.kind === "checkbox") return "Checkbox";
  const opts = rule.list ?? [];
  if (opts.length === 0) return "Dropdown";
  const shown = opts.slice(0, 3).join(", ");
  return `Dropdown (${shown}${opts.length > 3 ? ", …" : ""})`;
}

/**
 * `DataValidationPanel` manages the current sheet's checkbox / dropdown rules,
 * mirroring `ConditionalFormatPanel`. Panel state is the working copy; each edit
 * writes the full rule array via `setDataValidations` (which normalizes on the
 * engine side — an in-progress dropdown with no options is kept in the panel for
 * the session but not persisted until it has at least one option).
 */
export function DataValidationPanel({
  spreadsheet,
  open,
  onClose,
  getSelectionRange,
  autoAddKind,
}: DataValidationPanelProps) {
  const [rules, setRules] = useState<DataValidationRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [rangeInput, setRangeInput] = useState("");
  const [optionsText, setOptionsText] = useState("");

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId),
    [rules, selectedRuleId],
  );

  const commitRules = useCallback(
    (nextRules: DataValidationRule[]) => {
      setRules(nextRules);
      if (spreadsheet) {
        void spreadsheet.setDataValidations(nextRules);
      }
    },
    [spreadsheet],
  );

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<DataValidationRule>) => {
      const nextRules = rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      );
      commitRules(nextRules);
    },
    [commitRules, rules],
  );

  const addRule = useCallback(
    (kind: DataValidationKind): string => {
      const selectionRange = getSelectionRange();
      const parsed = selectionRange ? parseA1Ranges(selectionRange) : null;
      const ranges: Range[] = parsed || [
        [
          { r: 1, c: 1 },
          { r: 1, c: 1 },
        ],
      ];
      const id = `dv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const rule: DataValidationRule =
        kind === "list"
          ? { id, kind: "list", ranges, list: [], showArrow: true, onInvalid: "warning" }
          : { id, kind: "checkbox", ranges };
      commitRules([...rules, rule]);
      setSelectedRuleId(id);
      return id;
    },
    [commitRules, getSelectionRange, rules],
  );

  // Load rules whenever the panel opens; select the active cell's list rule if
  // any, and honor a one-shot autoAddKind (dropdown toolbar entry).
  useEffect(() => {
    if (!open || !spreadsheet) {
      return;
    }
    const loaded = spreadsheet.getDataValidations();
    setRules(loaded);
    const activeListRule = spreadsheet.getListRuleAt();
    if (activeListRule) {
      setSelectedRuleId(activeListRule.id);
    } else if (autoAddKind) {
      // addRule reads `rules` state; seed it first so the new rule appends.
      setRules(loaded);
      const selectionRange = getSelectionRange();
      const parsed = selectionRange ? parseA1Ranges(selectionRange) : null;
      const ranges: Range[] = parsed || [
        [
          { r: 1, c: 1 },
          { r: 1, c: 1 },
        ],
      ];
      const id = `dv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const rule: DataValidationRule =
        autoAddKind === "list"
          ? { id, kind: "list", ranges, list: [], showArrow: true, onInvalid: "warning" }
          : { id, kind: "checkbox", ranges };
      const next = [...loaded, rule];
      setRules(next);
      if (spreadsheet) void spreadsheet.setDataValidations(next);
      setSelectedRuleId(id);
    } else {
      setSelectedRuleId((current) =>
        current && loaded.some((r) => r.id === current)
          ? current
          : loaded[0]?.id ?? null,
      );
    }
    // Only re-run when the panel is (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spreadsheet]);

  // Sync editor fields when the selected rule changes.
  useEffect(() => {
    setRangeInput(selectedRule ? formatA1Ranges(selectedRule.ranges) : "");
    setOptionsText(
      selectedRule?.kind === "list" ? (selectedRule.list ?? []).join("\n") : "",
    );
  }, [selectedRuleId, selectedRule]);

  if (!open) {
    return null;
  }

  const handleApplyRange = () => {
    if (!selectedRule) return;
    const parsed = parseA1Ranges(rangeInput);
    if (!parsed) {
      toast.error("Enter valid A1 ranges like A1:D20 or A1:B10, D1:E10.");
      return;
    }
    updateRule(selectedRule.id, { ranges: parsed });
  };

  const handleUseSelectionRange = () => {
    const selectionRange = getSelectionRange();
    if (!selectionRange) {
      toast.error("Select a cell range first.");
      return;
    }
    setRangeInput(selectionRange);
    if (!selectedRule) return;
    const parsed = parseA1Ranges(selectionRange);
    if (parsed) updateRule(selectedRule.id, { ranges: parsed });
  };

  const handleCommitOptions = () => {
    if (!selectedRule || selectedRule.kind !== "list") return;
    const options = normalizeListOptions(optionsText.split("\n"));
    updateRule(selectedRule.id, { list: options });
  };

  const handleChangeKind = (kind: DataValidationKind) => {
    if (!selectedRule) return;
    if (kind === "list") {
      updateRule(selectedRule.id, {
        kind: "list",
        list: selectedRule.list ?? [],
        showArrow: selectedRule.showArrow ?? true,
        onInvalid: selectedRule.onInvalid ?? "warning",
      });
    } else {
      updateRule(selectedRule.id, { kind: "checkbox" });
    }
  };

  const handleDeleteRule = (ruleId: string) => {
    const next = rules.filter((r) => r.id !== ruleId);
    commitRules(next);
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(next[0]?.id ?? null);
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[26rem] flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconListCheck size={16} className="text-primary" />
            <p className="text-sm font-semibold">Data validation</p>
          </div>
          <p className="truncate pt-1 text-xs text-muted-foreground">
            Checkbox and dropdown rules for this sheet.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close data validation panel"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Rules
          </Label>
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => addRule("list")}
          >
            <IconPlus size={14} />
            Add
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Add a rule and choose a range to validate.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`rounded-lg border bg-card px-3 py-2.5 transition ${
                  selectedRuleId === rule.id
                    ? "border-primary ring-1 ring-primary/20"
                    : "hover:border-muted-foreground/30"
                }`}
              >
                <button
                  type="button"
                  className="w-full cursor-pointer text-left"
                  onClick={() => setSelectedRuleId(rule.id)}
                >
                  <p className="truncate text-sm font-medium">{kindLabel(rule)}</p>
                  <p className="truncate pt-1 text-xs text-muted-foreground">
                    {formatA1Ranges(rule.ranges)}
                  </p>
                </button>
                <div className="mt-2 flex items-center justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteRule(rule.id)}
                    aria-label="Delete rule"
                  >
                    <IconX size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedRule && (
          <>
            <Separator />

            <section className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="dv-apply-range">Apply to range</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="dv-apply-range"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  placeholder="A1:B10, D1:E10"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyRange}
                >
                  Apply
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={handleUseSelectionRange}
              >
                Use selected range
              </Button>
            </section>

            <section className="space-y-3 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="dv-criteria">Criteria</Label>
                <Select
                  value={selectedRule.kind}
                  onValueChange={(v) => handleChangeKind(v as DataValidationKind)}
                >
                  <SelectTrigger id="dv-criteria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">Dropdown</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {selectedRule.kind === "list" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="dv-options">Options (one per line)</Label>
                    <textarea
                      id="dv-options"
                      value={optionsText}
                      onChange={(e) => setOptionsText(e.target.value)}
                      onBlur={handleCommitOptions}
                      rows={5}
                      placeholder={"Red\nGreen\nBlue"}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="dv-show-arrow" className="font-normal">
                      Show dropdown arrow
                    </Label>
                    <Switch
                      id="dv-show-arrow"
                      checked={selectedRule.showArrow !== false}
                      onCheckedChange={(checked) =>
                        updateRule(selectedRule.id, { showArrow: checked })
                      }
                    />
                  </div>

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
                        <RadioGroupItem value="warning" id="dv-warning" />
                        <Label htmlFor="dv-warning" className="font-normal">
                          Show a warning
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="reject" id="dv-reject" />
                        <Label htmlFor="dv-reject" className="font-normal">
                          Reject the input
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </>
              )}

              {selectedRule.kind === "checkbox" && (
                <p className="text-xs text-muted-foreground">
                  Cells become checkboxes storing TRUE / FALSE.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify `IconListCheck` exists** (fallback `IconList` if not)

Run: `cd packages/frontend && node -e "const i=require('@tabler/icons-react'); console.log('IconListCheck', !!i.IconListCheck)"`
Expected: `IconListCheck true` (if false, replace both usages with `IconList`).

- [ ] **Step 3: Typecheck the frontend**

Run: `cd packages/frontend && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: `No errors found` (component not yet imported — this only checks the file compiles in isolation once imported in Task 3; if unused-import errors appear, they resolve after wiring).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/data-validation-panel.tsx
git commit -m "Sheets: Data validation side panel component"
```

---

### Task 3: Wire the panel into sheet-view; remove the dropdown dialog

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`
- Delete: `packages/frontend/src/app/spreadsheet/dropdown-options-dialog.tsx`

**Interfaces:**
- Consumes: `DataValidationPanel` (Task 2), `spreadsheet.setDataValidations` (Task 1).
- Produces: `handleOpenDataValidation` / `dataValidationOpen` state used by Task 4.

- [ ] **Step 1: Replace the dropdown-dialog import** (line ~34) with the panel lazy import.
      Remove:

```tsx
import {
  DropdownOptionsDialog,
  type DropdownInvalidBehavior,
} from "./dropdown-options-dialog";
```

Add near the other `lazy(...)` panel imports (after the `ConditionalFormatPanel` lazy block, ~line 103):

```tsx
const DataValidationPanel = lazy(() =>
  import("./data-validation-panel").then((module) => ({
    default: module.DataValidationPanel,
  })),
);
```

- [ ] **Step 2: Replace dropdown-dialog state** (lines ~150-158). Remove the
      `dropdownDialogOpen` and `dropdownDialogState` useState blocks and add:

```tsx
  const [dataValidationOpen, setDataValidationOpen] = useState(false);
  const [dvAutoAddKind, setDvAutoAddKind] = useState<
    "checkbox" | "list" | null
  >(null);
```

- [ ] **Step 3: Add the open handler** near `handleOpenConditionalFormat` (~line 712),
      mutually exclusive with the other panels:

```tsx
  const handleOpenDataValidation = useCallback(() => {
    setDataValidationOpen(true);
    setConditionalFormatOpen(false);
    setChartEditorOpen(false);
    setDvAutoAddKind(null);
  }, []);
```

- [ ] **Step 4: Replace `handleInsertDropdown`** (lines ~445-469) so the dropdown
      toolbar button opens the panel and seeds a dropdown auto-add:

```tsx
  const handleInsertDropdown = useCallback(() => {
    if (readOnly) return;
    setDataValidationOpen(true);
    setConditionalFormatOpen(false);
    setChartEditorOpen(false);
    setDvAutoAddKind("list");
  }, [readOnly]);
```

- [ ] **Step 5: Delete the now-dead dropdown handlers** — remove `handleSaveDropdown`
      (lines ~471-490) and `handleRemoveDropdown` (lines ~492-497) entirely.

- [ ] **Step 6: Close the panel where the others close** — in the effect/handlers that
      set `setConditionalFormatOpen(false)` / `setChartEditorOpen(false)` on chart insert
      and conditional-format open (e.g. `handleInsertChart` ~line 416,
      `handleOpenConditionalFormat` ~line 713), add `setDataValidationOpen(false);`
      alongside each so opening any one panel closes this one.

- [ ] **Step 7: Replace the dialog render** (lines ~1637-1646) with the panel render,
      placed right after the `ConditionalFormatPanel` render block (~line 1635):

```tsx
        {!readOnly && dataValidationOpen && (
          <Suspense fallback={null}>
            <DataValidationPanel
              spreadsheet={sheetRef.current}
              open={dataValidationOpen}
              onClose={() => setDataValidationOpen(false)}
              getSelectionRange={getSelectionRange}
              autoAddKind={dvAutoAddKind}
            />
          </Suspense>
        )}
```

- [ ] **Step 8: Delete the dialog file**

```bash
git rm packages/frontend/src/app/spreadsheet/dropdown-options-dialog.tsx
```

- [ ] **Step 9: Typecheck** (catches any leftover references to removed symbols)

Run: `cd packages/frontend && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: `No errors found`. If errors reference `DropdownInvalidBehavior`/
`dropdownDialogState`/`handleSaveDropdown`, remove those leftover usages.

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Sheets: open Data validation panel from dropdown button; drop dialog"
```

---

### Task 4: Context-menu "Data validation" item

**Files:**
- Modify: `packages/frontend/src/components/sheet-context-menu.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx` (SheetContextMenu usage ~line 1542)

**Interfaces:**
- Consumes: `handleOpenDataValidation` (Task 3).
- Produces: `onOpenDataValidation?: () => void` prop on `SheetContextMenu`.

- [ ] **Step 1: Add the prop** to `SheetContextMenuProps` (~line 34) and destructure it
      (~line 66):

```tsx
  onOpenDataValidation?: () => void;
```
```tsx
  onOpenDataValidation,
```

- [ ] **Step 2: Import an icon** — add `IconListCheck` to the existing tabler import in
      this file (fallback `IconList` if `IconListCheck` is unavailable).

- [ ] **Step 3: Render the item** in the `menuType === "cell"` block, right after the
      `onInsertComment` block (~line 211):

```tsx
            {onOpenDataValidation && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={readOnly}
                  onSelect={onOpenDataValidation}
                >
                  <IconListCheck size={16} /> Data validation
                </ContextMenuItem>
              </>
            )}
```

- [ ] **Step 4: Pass the prop** from sheet-view's `<SheetContextMenu …>` (~line 1542),
      next to `onInsertComment`:

```tsx
          onOpenDataValidation={readOnly ? undefined : handleOpenDataValidation}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/frontend && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: `No errors found`

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/sheet-context-menu.tsx packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Sheets: Data validation context-menu entry"
```

---

### Task 5: Verify (build + manual smoke)

- [ ] **Step 1: `pnpm verify:fast`** — Expected: `EXIT=0`, all unit tests pass
      (no new engine tests; frontend panels are untested by precedent).

- [ ] **Step 2: Frontend production build** — `pnpm --filter @wafflebase/frontend build`.
      Expected: `EXIT=0`.

- [ ] **Step 3: Manual smoke** (sheets dev harness is authless; or the running
      `:5173` app). Verify:
  - Dropdown toolbar button → panel opens with a new Dropdown rule for the selection.
  - Enter options → blur → arrow appears on the cells; picking a value writes it.
  - Switch criteria to Checkbox → cells render checkboxes.
  - Right-click → "Data validation" opens the panel; existing rule is selected.
  - Delete a rule → arrow/checkbox disappears.
  - Reject vs Warning: type an invalid value → reject discards + toast, warning shows
    the red marker + hover tooltip.

- [ ] **Step 4: Update design doc status** — in
      `docs/design/sheets/data-validation.md`, mark the "Phase 3 (UI)" section as shipped
      (brief "as shipped" note), and capture lessons in
      `docs/tasks/active/20260711-data-validation-panel-lessons.md`.

- [ ] **Step 5: Commit docs**

```bash
git add docs/
git commit -m "docs: data-validation panel as shipped + lessons"
```

## Review / Lessons
- (fill on completion)
