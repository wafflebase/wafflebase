---
title: docs-pending-inline-style
target-version: 0.4.3
---

# Docs Pending Inline Style (Stored Marks)

## Summary

Today the docs editor silently ignores inline-style toolbar actions when the
selection is collapsed: hitting **B** with no text selected does nothing.
This proposal adds a transient *pending style* — the next characters the user
types pick up the toggled style, and the pending state is dropped if the
caret moves elsewhere first. The pattern matches ProseMirror's "stored marks"
and Google Docs' empty-caret formatting behaviour.

The change is view-local. Document model, `DocStore`, and Yorkie schema are
untouched. Pending state is never persisted or shared with collaborators.

## Goals

- Toolbar inline-style toggles (bold, italic, underline, strikethrough, font
  family, font size, text color, background color, link, `clearFormatting`,
  every key in `Partial<InlineStyle>`) take effect at a collapsed caret.
- The first character typed at the same caret position picks up the pending
  style; subsequent characters inherit it naturally via the inserted run.
- Caret moves (click, arrow, drag), editor blur, undo/redo, and snapshot
  restore all drop the pending state.
- IME composition (Korean, Japanese, Chinese) shows the pending style
  in real time, including across intermediate composing/replace cycles.
- `Enter` (block split) preserves the pending state so the first character of
  the new block still picks it up.
- No regressions for the existing non-collapsed style path or any other
  editor behaviour.

## Non-Goals

- Persisting pending style across sessions or sending it through Yorkie.
- Coordinating pending state with peer cursors.
- Surfacing pending state in the floating toolbar / link popover beyond the
  existing `getSelectionStyle` consumers (those already drive button state).
- Mobile bottom-sheet text formatting — uses the same `editor.applyStyle`
  entry, so it inherits the fix for free; no extra UI work.
- Block-level styles (`applyBlockStyle`) and table cell styles
  (`applyCellStyle`) — they already work without a selection.

## Proposal Details

### Architecture

A small controller module owns the transient state. The editor wires it into
the existing inline-style write path and into the text input pipeline.

```
editor.ts ────────► PendingStyle ◄──────── text-editor.ts
  applyStyleImpl        get/set/clear           consumeForInsert(...)
  getSelectionStyle     consumeForInsert        clear (on non-typing moves)
  cursor-move handlers  rewindAnchor
                        rebindAnchor
```

No changes to `DocStore`, the Yorkie schema, or `model/document.ts`.

### `PendingStyle` controller

New file: `packages/docs/src/view/pending-style.ts` (~40 lines).

```ts
export interface PendingStyle {
  get(): Partial<InlineStyle> | null;
  has(): boolean;
  /**
   * Record a pending style at the given caret position. Subsequent
   * typing at this exact position will apply the style to the
   * inserted range.
   */
  set(
    style: Partial<InlineStyle>,
    anchor: { blockId: string; offset: number },
  ): void;
  clear(): void;
  /**
   * If a pending style exists and (blockId, fromOffset) matches the
   * current anchor, apply the style to the inserted [fromOffset, toOffset)
   * range and advance the anchor to `toOffset`. Otherwise no-op + clear.
   */
  consumeForInsert(blockId: string, fromOffset: number, toOffset: number): void;
  /**
   * Subtract `n` from the anchor offset (clamped at 0). Called when the
   * text-editor deletes composing text before re-inserting it during
   * IME composition cycles.
   */
  rewindAnchor(blockId: string, n: number): void;
  /**
   * Move the anchor to a new block at offset 0. Called from the Enter
   * (block-split) handler so the pending state survives the split.
   */
  rebindAnchor(blockId: string): void;
}

export function createPendingStyle(doc: Document): PendingStyle;
```

Internal state is `{ style, anchorBlockId, anchorOffset } | null`. All
mutation paths go through this controller — no other module touches the
field directly.

### `editor.ts` wiring

1. Construct once: `const pending = createPendingStyle(doc);`
2. `applyStyleImpl(style)`:
   - If `selection.hasSelection()` → existing behaviour unchanged.
   - Else (collapsed): merge the caret's current inline style with the
     incoming `style`, then `pending.set(merged, cursor.position)`. Do
     **not** snapshot, do **not** mutate the document. Trigger a
     `render()` so the toolbar (which calls `getSelectionStyle`) updates.
3. `getSelectionStyle()`: if `pending.has()`, return `pending.get()` merged
   onto the caret's current inline style. Otherwise existing path.
4. `clearInlineFormatting()`: if collapsed, set
   `pending.set(CLEAR_INLINE_STYLE, cursor.position)` instead of the
   existing range-write path. Range selections unchanged.
5. Pass `pending` into `createTextEditor(...)` via a new options field.

### `text-editor.ts` wiring

- Constructor option `pending: PendingStyle`.
- After **every** `this.doc.insertText(pos, data)`, call
  `pending.consumeForInsert(pos.blockId, pos.offset, pos.offset + data.length)`.
  Call sites (Section 2 of design): normal input, paste line insert, IME
  composing/commit, software Hangul composing/commit, "#" auto-conversion.
- Before any `this.doc.deleteText(pos, n)` that is part of an IME
  re-insertion cycle (composing replace, `flushHangul`), call
  `pending.rewindAnchor(pos.blockId, n)` so the next insertText lands on
  the anchor again.
- After `splitBlock` in the Enter handler:
  `pending.rebindAnchor(newBlockId)` — preserves pending across the split.
- Drop pending in: arrow-key handlers, mouse click / drag start, blur,
  copy / cut, undo, redo. Each call site adds one line: `pending.clear()`.

### Data flow examples

**Typing flow** (caret at `(b, 5)`, user toggles bold then types `"ab"`)

1. Toolbar → `editor.applyStyle({ bold: true })` →
   `pending.set({ bold: true }, { blockId: b, offset: 5 })`. Render: toolbar
   B-button highlights via `getSelectionStyle`.
2. User types `"a"` → `text-editor.handleInput` →
   `doc.insertText({b,5}, "a")` → cursor advances to `(b,6)`.
3. `pending.consumeForInsert(b, 5, 6)`: anchor matches → calls
   `doc.applyInlineStyle({anchor:{b,5}, focus:{b,6}}, {bold:true})`; anchor
   advances to `(b,6)`. Pending persists.
4. User types `"b"` → same flow, `pending.consumeForInsert(b, 6, 7)` →
   bold applied, anchor at `(b,7)`. Pending persists.
5. User clicks elsewhere → click handler runs `pending.clear()`. Done.

**IME composing flow** (caret at `(b, 0)`, user toggles bold then types
Korean `안녕`)

1. `pending.set({ bold: true }, { b, 0 })`.
2. Composition begins. text-editor calls
   `doc.insertText({b,0}, "ㅇ")` (composing) →
   `pending.consumeForInsert(b, 0, 1)` → bold applied, anchor at `(b,1)`.
3. Composition update: text-editor calls
   `pending.rewindAnchor(b, 1)` then `doc.deleteText({b,0}, 1)` then
   `doc.insertText({b,0}, "안")` → consume re-applies bold, anchor at
   `(b,1)`. Continues for each composing change.
4. Composition end commits `"안녕"` similarly; last consume leaves anchor
   at `(b,2)` with bold pending preserved for further typing.

**Anchor mismatch** (collapsed bold pending, but a markdown auto-convert
fires an extra `insertText` at a different offset)

- The extra insertText's `fromOffset` does not match the stored anchor →
  `consumeForInsert` no-ops and calls `clear()`. Auto-converted text is not
  styled. The user can manually re-trigger if desired.

### Cancellation triggers (exhaustive)

Each row corresponds to one `pending.clear()` call site.

| Trigger | Call site |
|---|---|
| Arrow keys (left/right/up/down/home/end) | text-editor key handlers |
| Mouse click / drag start | editor canvas pointerdown handler |
| Editor blur | `handleBlur` in `editor.ts` |
| Copy / cut | text-editor clipboard handlers |
| Undo / redo | editor undo/redo wrapper |
| Snapshot restore from peer changes pushing the caret | `cursor.setPosition` path that fires after `replaceDocument` |
| Backspace that deletes a character (whether pending was already committed or not) | text-editor delete handlers |
| Caret reaches a different block via any non-Enter path | covered by arrow / click handlers above |

**Not** triggers: `Enter` block split (preserved via `rebindAnchor`),
typing (handled via consume + advance), composing replace cycles (handled
via rewindAnchor + consume).

### Edge cases

- **Empty block**: anchor offset 0 in an `inlines: []` block. First
  insertText produces `inlines: [{text, style:{...pending}}]` after
  `applyInlineStyle`. No special case needed.
- **Inline image insert** (`insertImageInline`): image insertion does not
  go through `doc.insertText` and therefore does not call
  `consumeForInsert` — no special handling needed. After the image insert,
  the caret has moved through `cursor.setPosition`, which the editor's
  image-insert handler treats as a non-typing move and runs
  `pending.clear()` for explicitness.
- **Table cell**: caret blockId is the cell's inner block id. Anchor
  stores that id, consume uses it. Existing cell-range path in
  `applyStyleImpl` (non-collapsed) is untouched.
- **Cell-range selection**: not collapsed, so the existing
  `applyStyleToCellRange` path runs. Pending is irrelevant.
- **Paste multi-paragraph**: first `insertText` in the paste loop matches
  the anchor and applies pending; subsequent `splitBlock` + `insertText`
  calls land at offsets that do not match → consume clears. First-line-only
  styling is the natural outcome.
- **Markdown auto-convert** (`#` + space → heading): the conversion fires
  additional inserts/replaces past the anchor — those clear pending,
  matching Google Docs behaviour.
- **Collaboration**: pending is local view state, never sent to Yorkie. A
  peer edit that re-renders or repositions the caret triggers
  `cursor.setPosition`, which clears pending. Same-line peer edits that
  shift the local caret offset also clear pending (simpler than tracking
  remote ops; rare scenario).

### Toolbar visual feedback

`getSelectionStyle` already drives `docs-formatting-toolbar.tsx` button
state. Merging the pending style into its return value is enough — no
toolbar component changes needed. Slides and Docs mobile bottom-sheets
read the same getter and pick up the change automatically.

### Testing

New file: `packages/docs/test/view/pending-style.test.ts`.

Unit tests for the controller:

- `set` → `has()` true, `get()` returns the style.
- `set` → `clear` → `has()` false.
- `consumeForInsert` with matching anchor → `doc.applyInlineStyle` called
  with the expected range, anchor advanced, pending retained.
- `consumeForInsert` with mismatched blockId or offset → no
  `applyInlineStyle` call, pending cleared.
- `rewindAnchor` subtracts and clamps at 0.
- `rebindAnchor` moves anchor to a new block at offset 0.

Editor integration tests (extend existing `view/*.test.ts` style):

- Collapsed + `applyStyle({bold:true})` + `insertText "abc"` → all three
  chars are bold in the document.
- Same flow + arrow-key before `insertText` → chars are plain.
- Same flow + `Enter` + `insertText "x"` → `x` is bold in the new block.
- Same flow + `Enter` + arrow-key + `insertText "x"` → `x` is plain.
- `applyStyle({bold:true})` + `backspace` + `insertText "a"` → `a` is plain.
- `applyStyle({color:'red'})` + simulated IME composing `안녕` (composing
  insert + replace cycles) → both syllables are red.
- After one bold char is committed, `applyStyle({italic:true})` at the
  same caret → next char is bold + italic.
- `getSelectionStyle` returns `bold:true` immediately after the toggle
  (drives toolbar highlight).
- `clearInlineFormatting` on collapsed + typing → typed run is plain.
- Non-collapsed `applyStyle` path: existing assertions unchanged.

Manual browser smoke (after `pnpm dev`):

- Empty line, Cmd+B, type `Hello` → renders bold.
- Empty line, Cmd+B, click elsewhere, type → renders plain.
- Empty line, Cmd+B, Enter, type → new line is bold.

### Risks and Mitigation

- **Stale pending after concurrent peer edit shifts caret silently**
  Same-block insertions by peers can move the local caret offset without
  the local user noticing. Mitigation: clear pending whenever
  `cursor.setPosition` runs from outside the typing path; the user simply
  re-triggers the toggle. Trade-off acknowledged in design.
- **IME edge cases on mobile Safari**: the software Hangul assembler in
  `text-editor.ts` does its own composing/replace dance. Mitigation:
  `rewindAnchor` is called in `flushHangul` and around
  `applyHangulResult`'s `deleteText`. Covered by the IME integration
  test above; manual verification on mobile Safari is part of the smoke
  pass.
- **Forgetting a `pending.clear()` call site** silently leaves pending
  active across navigation. Mitigation: the cancellation-triggers table
  in this doc is the single source of truth, mirrored in the plan
  checklist; each call site is a small, line-level change reviewed
  together.
