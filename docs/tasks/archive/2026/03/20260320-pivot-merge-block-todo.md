# Block merge operations on pivot sheets

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent merge/unmerge operations on pivot table sheets at the engine level, and disable the merge button in the toolbar for pivot tabs.

**Architecture:** Add `pivotDefinition` early-return guards to `mergeSelection()`, `unmergeSelection()`, and `canMergeSelection()` in `Sheet` (same pattern as `setData`, `removeData`, etc.). Pass `isPivotTab` to `FormattingToolbar` to disable the merge button in the UI.

**Tech Stack:** TypeScript, Vitest, React

---

### Task 1: Add engine-level merge block for pivot sheets

**Files:**
- Modify: `packages/sheet/src/model/worksheet/sheet.ts:3391` (`canMergeSelection`)
- Modify: `packages/sheet/src/model/worksheet/sheet.ts:3422` (`mergeSelection`)
- Modify: `packages/sheet/src/model/worksheet/sheet.ts:3472` (`unmergeSelection`)
- Test: `packages/sheet/test/sheet/pivot-protection.test.ts`

- [x] **Step 1: Write failing tests**

Add to `packages/sheet/test/sheet/pivot-protection.test.ts`:

```typescript
it('blocks mergeSelection on pivot sheets', async () => {
  const store = new MemStore();
  await store.setPivotDefinition(pivotDef);
  const sheet = new Sheet(store);
  await sheet.loadPivotDefinition();
  sheet.setActiveCell({ r: 1, c: 1 });
  sheet.setRangeSelection({ r: 3, c: 3 });
  const result = await sheet.mergeSelection();
  expect(result).toBe(false);
});

it('blocks unmergeSelection on pivot sheets', async () => {
  const store = new MemStore();
  // Set up a merge before enabling pivot
  const sheet = new Sheet(store);
  sheet.setActiveCell({ r: 1, c: 1 });
  sheet.setRangeSelection({ r: 2, c: 2 });
  await sheet.mergeSelection();

  // Now enable pivot and try to unmerge
  await store.setPivotDefinition(pivotDef);
  await sheet.loadPivotDefinition();
  const result = await sheet.unmergeSelection();
  expect(result).toBe(false);
});

it('canMergeSelection returns false on pivot sheets', async () => {
  const store = new MemStore();
  await store.setPivotDefinition(pivotDef);
  const sheet = new Sheet(store);
  await sheet.loadPivotDefinition();
  sheet.setActiveCell({ r: 1, c: 1 });
  sheet.setRangeSelection({ r: 3, c: 3 });
  expect(sheet.canMergeSelection()).toBe(false);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run test/sheet/pivot-protection.test.ts`
Expected: 3 new tests FAIL

- [x] **Step 3: Add pivot guards to merge methods**

In `packages/sheet/src/model/worksheet/sheet.ts`:

`canMergeSelection()` — add at line 3392:
```typescript
if (this.pivotDefinition) return false;
```

`mergeSelection()` — add at line 3423:
```typescript
if (this.pivotDefinition) return false;
```

`unmergeSelection()` — add at line 3473:
```typescript
if (this.pivotDefinition) return false;
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run test/sheet/pivot-protection.test.ts`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add packages/sheet/src/model/worksheet/sheet.ts packages/sheet/test/sheet/pivot-protection.test.ts
git commit -m "Block merge/unmerge operations on pivot sheets"
```

---

### Task 2: Disable merge button in toolbar for pivot tabs

**Files:**
- Modify: `packages/frontend/src/components/formatting-toolbar.tsx` (props + button disabled logic)
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx:880` (pass `isPivotTab` prop)

- [x] **Step 1: Add `isPivotTab` prop to FormattingToolbar**

In `packages/frontend/src/components/formatting-toolbar.tsx`, add to `FormattingToolbarProps`:
```typescript
isPivotTab?: boolean;
```

Add to the function signature destructuring:
```typescript
isPivotTab = false,
```

- [x] **Step 2: Disable merge button when `isPivotTab`**

Update the merge button's `disabled` attribute (line 616):
```typescript
disabled={isPivotTab || (!selectionMerged && !canMerge)}
```

- [x] **Step 3: Pass `isPivotTab` from SheetView**

In `packages/frontend/src/app/spreadsheet/sheet-view.tsx` (line 880-888), add prop:
```typescript
<FormattingToolbar
  spreadsheet={sheetRef.current}
  isPivotTab={isPivotTab}
  onInsertChart={handleInsertChart}
  ...
/>
```

- [x] **Step 4: Verify manually or run lint**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/components/formatting-toolbar.tsx packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Disable merge button in toolbar for pivot tabs"
```
