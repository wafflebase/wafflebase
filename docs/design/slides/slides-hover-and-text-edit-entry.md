---
title: slides-hover-and-text-edit-entry
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Hover & Text-Edit Entry Parity

## Summary

Bring the Slides editor's idle-state hover feedback and text-edit
entry affordances closer to Google Slides. Before this work the editor
gave no visual or cursor feedback when hovering over unselected
elements, and text-editing was reachable only via double-click. This
made the canvas feel inert on first interaction and forced an extra
click for the common case of editing layout placeholders. All of it —
a hover preview overlay, region-aware cursor changes, keyboard entry
(Enter / F2), and the click/typing affordances — is now shipped. The
sections below use the original P0 → P2 phase split as documentation of
each affordance; every item has landed in the `editor.ts` pointer-state
machine, `overlay.ts` renderer, the `interactions/` handlers, and
`text-box-editor.ts`.

### Goals

- A user hovering over any selectable element on the canvas sees an
  immediate visual hint that it is clickable.
- A user can predict, by cursor shape, whether the next click will
  start dragging, resize, or enter text editing.
- Keyboard users can enter and leave text editing without touching
  the mouse.
- Empty layout placeholders enter editing on the first click, so a
  fresh "Title + Body" slide becomes typeable in one click per region.
- All changes feel local to the `editor.ts` pointer-state machine and
  `overlay.ts` rendering — no model/store changes, no schema bumps.

Success criteria:

- Manual: navigate a fresh "Title + Body" slide and type a title in
  one click; navigate an existing slide and confirm hover outlines
  appear on every shape/text/image/connector.
- Manual: with a text shape selected, hovering the text region shows
  an I-beam; hovering the border shows `move`.
- Manual: Enter / F2 enters editing; Esc exits; selection state
  matches Google Slides for each transition.
- Unit: pointer-state machine tests cover the new branches.
- Browser-test: harness scenario for hover outline + cursor + Enter
  entry, alongside the existing dblclick scenario.

### Non-Goals

- Changing the toolbar morphing model. The State 1/2/3 contract from
  [`slides-toolbar-redesign.md`](slides-toolbar-redesign.md) is
  preserved; this work only changes how a user transitions between
  states.
- Changing the underlying model, store, or Yorkie schema.
- Mobile / touch interactions. The viewport-768 branch keeps its
  bottom-sheet text formatting per
  [`slides-mobile.md`](slides-mobile.md); these changes apply to the
  desktop pointer surface.
- Multi-user presence indicators (peer hover ghosts). Out of scope.
- Accessibility audit beyond keyboard entry / exit. Full screen-reader
  treatment is tracked separately.

## Proposal Details

### Phase split

All phases below are **shipped**. The phase grouping is retained as a
map of where each affordance lives, not as a rollout plan.

| Phase | Items | Where it lives |
|---|---|---|
| **P0** | (1) Idle hover outline, (2) Text-region I-beam | `editor.ts` hover handler (`onSelectionHoverMove`) + `overlay.ts` renderer. Item (3) Enter / F2 entry lives in `interactions/keyboard.ts` (the F2 / Enter rule, ~line 627). |

> "Text-capable element" throughout this doc means: any element of
> kind `text`, or a shape whose model carries a non-empty `textBody`
> field (the same predicate the text-box editor uses to decide
> whether to mount). Lines, raw connectors, and images are excluded.
| **P1** | (4) Empty-placeholder 1-click entry, (5) Slow double-click (second-click-on-selected) | `interactions/select.ts` (`isEmptyPlaceholder`) and `interactions/drag.ts` (slow-double-click classifier). |
| **P2** | (6) Printable-char first-key forwarding, (7) Edge-zone resize cursor | `text-box-editor.ts` (`initialText`) forwarded from the printable-key rule in `keyboard.ts`, and the edge-zone cursor block in `editor.ts` (§ P2.7). |

### Behavior

Columns are labelled "Before" (the pre-feature editor) and "Now"
(shipped behavior).

| # | Trigger | Before | Now |
|---|---|---|---|
| A | Hover over unselected element | No feedback | 1 px `rgba(26,115,232,0.5)` outline along bbox |
| B | Hover over selected element body | `move` cursor | `move` over non-text regions only |
| C | Hover over text region of selected text-capable element | `move` | `text` (I-beam) |
| D | Hover inside drilled-in group | Static dashed member outlines | Hover candidate gets blue outline; non-candidate members keep dashed outline |
| E | Enter / F2 with single text-capable element selected | (no-op) | Enter `enterEditMode()` |
| F | Click empty placeholder (1st click, not previously selected) | Selects only | Selects **and** enters edit |
| G | Click already-selected text-capable element (no drag) | Drag stays armed; click-up is a no-op | Enter edit if pointer-up < 3 px from down |
| H | Type printable char with single text-capable element selected | Captured by global key handler / no-op | Enter edit + forward keystroke |
| I | Hover within 4 px of selected element edge (not on handle) | `move` | Matching resize cursor (`ns-resize`, etc.) |

### P0 — Hover preview + cursor regions + keyboard entry

#### P0.1 Idle hover outline

A `hoverHighlightId: string | null` field on the editor pointer state
tracks the hovered element (`editor.ts:700`).

- `onSelectionHoverMove(pointer)` runs hit-test in the **current
  selection scope** (respects group drill-in: same scope used by
  `selection.replace`).
- If the topmost hit element is **not part of the current selection**,
  set `hoverHighlightId` to its id; otherwise clear it.
- Call `repaintOverlay()` only when `hoverHighlightId` changes (cheap
  string compare). Same `requestAnimationFrame` budget — no thrash.

Rendering (`overlay.ts`):

- New helper `renderHoverPreview(element, frame, zoom)` paints a
  rounded `1px solid rgba(26,115,232,0.5)` border on a DOM rect
  matching the element's bbox in screen space.
- Drawn **below** selection handles **and below connection-site
  dots**, but **above** snap guides and smart guides — so it never
  competes with the active drag/connector affordance, and snap lines
  remain readable beneath it.
- Skipped while any drag/resize/insert-mode interaction is live —
  guard with the existing `interaction.kind` check used by
  smart-guide rendering.

Group drill-in case (Gap D):

- When a group is the current selection scope and the hover target is
  a child, the child's hover preview replaces the dashed member
  outline for that one child. Other members keep the existing green
  dashed outline.
- When the hover target is **outside** the drilled-in group, the
  hover preview is suppressed (avoids competing with the context
  box). Clicking outside still works because the pointer-down handler
  already exits the scope.

#### P0.2 Text-region I-beam

- In `onSelectionHoverMove`, when hovering over a single-selected
  text-capable element (`text` element or shape with `textBody`):
  - If `isPointerOverTextRegion(pointer, element)` → cursor `text`.
  - Else (inside bbox but on border padding) → cursor `move`.
- `isPointerOverTextRegion` reuses the same padding constants the
  text-box editor uses to compute the contenteditable rect, so the
  visual transition matches where editing would actually begin. New
  helper exported from `text-box-editor.ts`:
  `getTextRegionRect(element, frame): Rect`.
- For images, connectors, and non-text shapes (e.g. lines, raw
  geometric primitives without `textBody`) the cursor stays `move`.

#### P0.3 Enter / F2 keyboard entry

The keyboard rule lives at
`packages/slides/src/view/editor/interactions/keyboard.ts` (the
F2 / Enter rule, ~line 627) and implements the contract below:

| Key | Pre-condition | Action |
|---|---|---|
| `Enter` / `F2` | Single text-capable element selected, no mod keys, focus not on an editable input | `enterEditMode(slideId, elementId)` |
| `Esc` (in edit) | (handled by text-box editor's own capture listener) | exits edit |

### P1 — Click-classification refinements

#### P1.4 Empty placeholder 1-click entry

- A `text` element is treated as an "empty placeholder" when it
  carries a `placeholderRef` (so the renderer is currently painting a
  ghost hint from `placeholderHintFor(type)`) **and** its text body
  is empty (zero blocks, or a single empty paragraph block).
  User-authored text boxes without `placeholderRef` are out of scope —
  they keep the existing select-only behavior even when empty.
- In `interactions/select.ts`, when the hit element is an empty
  placeholder AND the click is a fresh selection (was not already
  selected), call `selection.replace([id])` then `enterEditMode()` in
  the same pointer-up handler.
- For non-empty placeholders and regular text boxes, behavior is
  unchanged — first click selects only.
- This intentionally diverges from Google Slides for non-placeholders
  (Google Slides applies the same rule to all empty text boxes); we
  scope to placeholders to avoid surprising users who created an
  empty text box deliberately. Revisit after dogfooding.

#### P1.5 Slow double-click ("second-click-on-selected")

Definition: when a single text-capable element is already selected,
a second pointer-down → pointer-up sequence where both pointers fall
inside the text region AND `dist(down, up) < 3 px` AND
`up - down < 350 ms` enters editing.

- Implemented in the existing `interactions/drag.ts` pointer-up path,
  which already classifies "no-drag" vs "drag" by movement distance.
- Does **not** modify the `dblclick` handler — both routes are
  supported. The slow-click route just removes the strict
  double-click-timing requirement when the target is already selected.
- 3-px / 350-ms thresholds are constants near the top of `drag.ts`
  for easy tuning during dogfooding.

### P2 — Polish

#### P2.6 Printable-char first-key forwarding

The printable-key rule (`keyboard.ts`, ~line 662) enters edit on a
printable character when one text-capable element is selected, and the
triggering character **is** forwarded into the freshly-mounted
text-box so the user does not have to type it again. The earlier v1
caveat (consumed character dropped) is closed. The shipped pieces:

- `mountSlidesTextBox(...)` (in
  `packages/slides/src/view/editor/text-box-editor.ts`) accepts an
  optional `initialText?: string`. When present, after the
  contenteditable is focused, it forwards the character into the docs
  editor exactly once (`initialTextPending` guard, ~line 395) so the
  character lands at the correct caret position.
- `SlidesEditor.enterEditMode(slideId, elementId,
  options?: { initialText?: string })` forwards the option to
  `mountSlidesTextBox`.
- The printable-key rule in `keyboard.ts` passes
  `{ initialText: e.key }` when calling `ctx.enterEditMode(...)`.
- Tool-shortcut interaction: the existing rule order in `keyboard.ts`
  already routes single-letter tool keys before the printable-key
  rule **only when no element is selected**; when a text-capable
  element is selected, the printable-key rule wins. This baseline is
  unchanged.

> **Known limitation (2026-06-21): Korean/IME type-to-edit decomposes.**
> Typing Korean to *enter* edit mode on a selected shape/text element
> produces decomposed jamo (`하` → `ㅎㅏ`) because the triggering jamo is
> force-injected as `initialText`, which commits a lone jamo and breaks
> the OS composition. Composing inside an *already-open* text-box (entered
> via double-click / Enter) is unaffected, as are Docs and Sheets. A first
> fix attempt (IME-guard so the entry keystroke is not injected) was
> reverted: it passed jsdom unit tests but had no effect in a real browser
> because the entry keydown carried no IME signal on the test machine. The
> real fix likely has to abandon `initialText` injection for this path in
> favour of true Sheets-style parity (focus a real input, let the native
> keystroke land). Tracked in
> `docs/tasks/archive/2026/06/20260607-slides-hover-text-edit-browser-smoke-todo.md`.

#### P2.7 Edge-zone resize cursor

- When the cursor is within 4 logical px of the selected element's
  edge (inside or outside the bbox), show the matching resize cursor
  (`ns-resize` for top/bottom, `ew-resize` for left/right,
  `nwse-resize` / `nesw-resize` for corners).
- Falls back to handle cursors when within the explicit 8 px handle
  hit region (no double-handling).
- Skipped for rotated elements above 5° to avoid mismatched cursor
  directions; rotated elements show only the handle cursors as today.

### Visual layering (overlay z-order, top to bottom)

1. Active drag / resize / connector endpoint handles
2. Selection bbox + 8 resize handles + rotate handle
3. Connection-site dots (during connector draw)
4. **Hover preview outline (NEW)**
5. Drilled-in group member outlines / context box
6. Smart-guide arrows + outlines
7. Snap guides
8. User guides (ruler)

### Pointer-state extensions

`SlidesEditor` carries the hover state as pure view fields:

```ts
private hoverHighlightId: string | null = null; // editor.ts:700
```

Note: `hoverPreview` was already taken on the editor — it's the
insert-mode shape-kind ghost preview (`editor.ts:693`). The hover
field is named `hoverHighlightId` to avoid the collision.

Both are pure view state; nothing is persisted. `onSelectionHoverMove`
computes them and calls `repaintOverlay()` only when either changes.

### Testing strategy

- **Unit** (under `packages/slides/test/view/editor/`)
  - `interactions/select.test.ts` + `empty-placeholder-entry.test.ts`:
    empty-placeholder fast-entry classification.
  - `interactions/drag.test.ts`: slow-double-click classification.
  - `hover-highlight.test.ts`: hover-id transitions.
  - `text-region-rect.test.ts`: text-region vs body cursor geometry.
  - `interactions/keyboard.test.ts`: Enter / F2 enters edit only with
    a single text-capable selection.
- **Regression**
  - The dblclick entry path stays intact — both routes are supported.
  - Connector draw flow (overlay hit-test order) unchanged: hover
    preview is suppressed during insert mode.

### Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Hover outline flickers during fast drag-from-outside-to-inside | Clear `hoverHighlightId` immediately on any pointer-down; only update on actual `pointermove` deltas > 1 px. |
| Region cursor jitter on shape borders | `getTextRegionRect` is computed once per hover-target change, not per frame. Inset is half-pixel rounded. |
| Single-letter typing breaks muscle memory for tool shortcuts | Only takes effect when a text-capable element is selected; non-text selection still triggers tool shortcuts. Document the change in the shortcuts help modal. |
| Empty-placeholder definition diverges from Google Slides (we scope to placeholders only) | Ship behind no flag; revisit after dogfooding if users report "I can't insert an empty text box without immediately entering edit." |
| Slow-double-click conflicts with intent to drag | 3 px / 350 ms thresholds are tight enough that any deliberate drag exits the window. Tunable constants. |
| Hover paint cost on slides with 50+ elements | Hit-test path is unchanged; only adds one extra DOM rect per scope change. Overlay is already DOM-based, so layout cost is O(1) per hover update. |
| Keyboard entry duplicates dblclick path inconsistently | All entry paths funnel through the single `enterEditMode(caret?: 'end' \| 'preserve')` method. Callers pass the caret hint; the method owns mounting. |
| Group-scope hover changes confuse users mid-action | When a drag/resize is live, hover preview is suppressed entirely (same gate as smart-guides). |

### Cross-references

- [`slides.md`](slides.md) § Interactions — append new rows for hover,
  Enter / F2 entry, slow-double-click; cross-link this doc.
- [`slides-toolbar-redesign.md`](slides-toolbar-redesign.md) — no
  contract change; the toolbar state machine continues to be driven by
  selection + editing state.
- [`slides-keyboard-shortcuts.md`](slides-keyboard-shortcuts.md) —
  add Enter / F2 / printable-char rules; reconcile single-letter tool
  shortcut scoping.
- [`slides-group.md`](slides-group.md) — extend the "drilled-in"
  rendering to coexist with hover preview (one child highlighted, rest
  dashed).
- [`slides-connectors.md`](slides-connectors.md) — confirm
  connection-site dots take precedence over hover preview during
  connector insert / endpoint drag.
