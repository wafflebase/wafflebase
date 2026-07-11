# Sheet Data Validation — Phase 1 (Checkbox) Lessons

## What shipped
A worksheet-level `DataValidationRule[]` model (mirroring `ConditionalFormatRule`)
with `kind:'checkbox'` end-to-end: model helpers, a shared generic range
shift/move helper, Worksheet schema seed, Store surface across all three stores +
barrel exports, Sheet synced-cache + facade (`insertCheckbox`/`toggleCheckboxAt`),
Canvas checkbox render pass, click + Space toggle, and a frontend Insert-Checkbox
toolbar button. Values reuse the existing boolean machinery; no formula-engine
change; no per-cell schema field.

## Key lessons

### 1. The `conditionalFormats` state is mirrored in FOUR independent places
Range-scoped rule state is not single-sourced. It lives, and must be maintained,
in parallel at:
1. **`Sheet` synced cache** (`sheet.ts`) — six sites: field, load-from-store,
   getter, shift, move, setter.
2. **`MemStore`** — field, get/set, shift, move.
3. **`YorkieStore`** — get/set (delete-when-empty, batch-aware).
4. **`yorkie-worksheet-structure.ts`** — the shift/move applied INSIDE the Yorkie
   `doc.update` on structural edits. **This one is separate from the Store's
   shift/move** and is the one that persists to remote collaborators.

**The whole-branch review caught a real bug here that all per-task reviews
missed:** the plan wired MemStore's shift/move (Task 4) and the Sheet cache
(Task 6), but NOT the Yorkie document helper. A checkbox rule in a collaborative
doc stayed at its old cell for remote peers and after reload. Lesson: **when
adding a range-scoped worksheet field, grep for EVERY place `conditionalFormats`
is shifted/moved — there are four, and the Yorkie-doc one is easy to miss because
it's in a different file/package from the Store.** A MemStore-only test passes and
hides the gap; only a Yorkie-path test catches it.

### 2. Whole-branch review earns its keep on cross-task integration
Per-task reviews each saw one task and all passed. The only merge-blocking defect
was an integration gap spanning Task 4/5/6 that no single-task diff revealed. Keep
the final opus whole-branch review in the loop — it's where "MemStore wired,
Yorkie doc not" surfaces.

### 3. Extract shared logic when the plan says "copy verbatim"
Pre-flight caught that the plan's Task 2 mandated duplicating the CF shift/move
logic — which the review rubric flags as a defect. Extracting a generic
`shiftRuleRanges`/`moveRuleRanges` (`rule-ranges.ts`) that BOTH conditional-format
and data-validation route through was cleaner and kept both rule types in lockstep
(and made the Yorkie-fix a one-liner-per-branch). Surface plan/rubric conflicts in
pre-flight, not mid-implementation.

### 4. `shiftBoundary` is monotonic — deletes collapse, they don't drop
A range fully covered by a deletion collapses to a single boundary row (length 1),
never to empty. My first plan draft asserted `length 0` on delete — wrong. Compute
the actual transform before writing test expectations for range shifting.

### 5. Frontend resolves `@wafflebase/sheets` from `dist`, not source
Adding exports to the sheets barrel requires rebuilding the package before the
frontend (YorkieStore, toolbar) type-checks against them. `dist` is gitignored
(rebuilt at build time). Order: edit index.ts → `pnpm --filter @wafflebase/sheets
build` → edit frontend.

### 6. The `Sheet` view-model is the sync cache layer, not the Store
`Spreadsheet` facade getters are synchronous (`sheet.getConditionalFormats()`)
because `Sheet` keeps an in-memory cache synced from the async `Store`. Render
reads the cache. Any new rule type needs the cache layer (Task 6), not just the
Store (Task 4/5), or the renderer sees nothing.

### 7. Canvas `render()` is a ~25-arg positional method
Thread new render data as a TRAILING positional arg through `render` →
`renderQuadrantCells` and add it at the end of EVERY call site (5 for
`renderQuadrantCells`: no-freeze + 4 freeze quadrants). Miss one quadrant and
checkboxes silently vanish there. Grep exhaustively.

### 8. Interaction code here has no unit-test harness
`worksheet.ts` mouse/keyboard paths can't be unit-tested without a full
DOM/canvas/Worksheet harness the repo lacks. Thin delegations to already-tested
`Sheet` methods, validated by build + manual smoke, is the honest approach — don't
build brittle mock-everything tests. The Space keyrule ORDER (before the
printable-input rule) is load-bearing: `runKeyRules` short-circuits on first match
and Space is a valid cell-input char.

## Deferred follow-ups (all acceptable for Phase 1)
- `toggleCheckboxAt` should no-op on formula cells (currently overwrites the formula).
- Click should hit-test the glyph rect (currently toggles anywhere in the cell).
- `isCheckboxChecked` should be case-insensitive for manually-typed `true`/`false`.
- Range-uniform Space toggle.
- `resolveDataValidationAt` memoization in the render loop (mirror `styleCache`).
- Eager `FALSE`-init on insert (vs. lazy materialization) if `COUNTIF(range, FALSE)` parity matters.
- List dropdown + date picker kinds, the full Data-validation side panel, range-backed lists, custom checkbox values.
