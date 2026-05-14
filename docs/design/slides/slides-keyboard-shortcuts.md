---
title: slides-keyboard-shortcuts
target-version: 0.2.0
---

# Slides Keyboard Shortcuts — Google Slides Parity

## Summary

Extend the slides editor's keyboard support to cover the shortcuts a
Google Slides user reaches for on the first day. The existing
`view/editor/interactions/keyboard.ts` keyRule system already handles
undo/redo, delete, nudge, clipboard, duplicate, and z-order. This pass
adds selection, slide navigation, presentation start, link request,
and a discoverable shortcuts-help modal.

### Goals

- Add the Google Slides parity shortcuts listed in the table below.
- Keep the existing keyRule pattern: a single ordered array, optional
  `isEditableTarget` gates, no global wrapper layer.
- Single source of truth for shortcut metadata so the help modal and
  documentation stay in sync with the runtime.

### Non-Goals

- **Group / Ungroup** (`Cmd+G` / `Cmd+Shift+G`). No group concept exists
  in the slides model yet; introducing one is a separate design
  involving model, CRDT, rendering, and selection-box changes.
- **Find / replace** (`Cmd+F` / `Cmd+Shift+H`). Slides find/replace
  spans every slide and needs its own UX (thumbnail jump, match
  highlight, sequential search). Out of scope here.
- **Customizing shortcuts.** The catalog is fixed in v1.

## Proposal Details

### Scope

| Category | Shortcut | Behavior |
|---|---|---|
| Selection | `Cmd/Ctrl+A` | Select all elements on the current slide. |
| Selection | `Esc` | Exit text edit → clear selection → otherwise no-op. |
| Selection | `Tab` / `Shift+Tab` | Cycle next/previous element on the current slide. With nothing selected, selects the bottom-most (Tab) or top-most (Shift+Tab) element. |
| Selection | `F2` / `Enter` | When exactly one text element is selected, enter text-edit mode. |
| Slide | `Cmd/Ctrl+M` | Add a new slide after the current, using the current slide's layout, and switch to it. |
| Slide | `Cmd/Ctrl+Shift+D` | Duplicate the current slide explicitly. (`Cmd+D` continues to duplicate selected elements; only falls back to slide-duplicate when nothing is selected.) |
| Slide | `Page Up` / `Page Down` | Switch to previous / next slide. Boundary-safe. |
| Present | `Cmd/Ctrl+Enter` | Start presentation from the current slide (via callback). |
| Present | `Cmd/Ctrl+Shift+Enter` | Start presentation from the first slide. |
| Clipboard | `Cmd/Ctrl+Shift+V` | While not editing text: same as `Cmd+V`. While editing text: handled by docs text-editor (plain-text paste). |
| Text-box | `Cmd/Ctrl+K` | Open link insert popover (callback). Only fires while a text-box is in edit mode — docs `text-editor.ts` already binds the key; slides plumbs the callback through `text-box-editor.ts`. |
| Discoverability | `Cmd/Ctrl+/` | Open the shortcuts-help modal (callback). Fires even while editing text. |

### Architecture

**Layer split:**

| Concern | Owner |
|---|---|
| Selection-level shortcuts | `slides/src/view/editor/interactions/keyboard.ts` keyRules (existing pattern). |
| Slide-level shortcuts (`Cmd+M`, `Page Up/Down`, …) | Same keyRules array. Uses `ctx.setCurrentSlide(id)` (new context entry) for slide switching. |
| Present-mode start (`Cmd+Enter`) | keyRule fires `ctx.onStartPresentation?.('current' \| 'first')`. Frontend (`slides-detail.tsx`) wires the callback. |
| Help modal (`Cmd+/`) | keyRule fires `ctx.onShowShortcutsHelp?.()`. Frontend mounts a modal that reads from the shortcuts catalog. |
| Link request (`Cmd+K`) | Slides text-box wrapper forwards docs' `onLinkRequest` callback up to `SlidesEditorOptions.onLinkRequest`. Frontend mounts a small link popover. |
| Catalog | New module `slides/src/view/editor/shortcuts-catalog.ts` exports `SHORTCUTS: ReadonlyArray<ShortcutEntry>`. The help modal renders from this list. |

**Extended `KeyboardContext`** (in `interactions/keyboard.ts`):

```ts
export interface KeyboardContext {
  store: SlidesStore;
  selection: Selection;
  currentSlideId(): string | undefined;
  setCurrentSlide(id: string): void;            // new
  enterEditMode?: (elementId: string) => void;  // new — for F2 / Enter
  requestRender(): void;
  onStartPresentation?: (from: 'current' | 'first') => void;
  onShowShortcutsHelp?: () => void;
  onLinkRequest?: () => void;                    // canvas-level (unused in v1, present for symmetry)
}
```

`enterEditMode` exists on `SlidesEditor` as a private path used by
`onDoubleClick`. We promote it to a method exposed to `KeyboardContext`
so the F2 / Enter rules can invoke it without duplicating the
text-box mount sequence.

**`SlidesEditorOptions`** adds three optional callbacks:

```ts
export interface SlidesEditorOptions extends SlideRendererOptions {
  // …existing fields…
  onStartPresentation?: (from: 'current' | 'first') => void;
  onShowShortcutsHelp?: () => void;
  onLinkRequest?: () => void;
}
```

All three are optional — frontend wiring is independent of the editor
package, and unit tests don't need to provide them.

**Editable-target gate.** Every selection-level rule keeps an
`isEditableTarget(e.target)` guard so typing into a focused
`<textarea>` (the text-box editor, the link popover input, the help
modal search field) is not intercepted. Exceptions:

- `Cmd+/` (help modal) bypasses the gate — help should always open.
- `Cmd+Enter` / `Cmd+Shift+Enter` (start presentation) bypass the
  gate — Google Slides treats this as a global shortcut.
- `Cmd+K` (link) flows through the docs text-editor inside text-box
  edit mode; no slides-level rule needed.

### Catalog module

`slides/src/view/editor/shortcuts-catalog.ts`:

```ts
export interface ShortcutEntry {
  /** Category for grouping in the help modal. */
  category: 'Selection' | 'Slide' | 'Clipboard' | 'Format' | 'Present' | 'Help';
  /** Display label. Use `Cmd` for mac and `Ctrl` elsewhere — rendered
   *  at runtime based on platform. */
  keys: ReadonlyArray<string>;
  /** Human description. */
  description: string;
}

export const SHORTCUTS: ReadonlyArray<ShortcutEntry>;
```

The keys field carries a platform-neutral token like `'Mod+/'` or
`'Page Up'`; the help modal renders it as `'⌘+/'` on mac and
`'Ctrl+/'` elsewhere. Keeping the catalog declarative (not coupled to
the keyRule match functions) trades one duplication risk (catalog
drift) for clean rendering. A unit test asserts that every catalog
entry has a corresponding keyRule (matched by description text in a
test-only table — sufficient to catch deletions).

### Esc semantics

Existing behaviour: text-box editor binds Esc on its own textarea
(calls `onCancel`, then blurs to commit). Context menu binds Esc to
close.

New: add a selection-level keyRule for Esc that fires only when

- no editable target is focused,
- no popover/context-menu open (those swallow it first via their own
  capture listeners), and
- the editor has a non-empty selection.

Action: clear selection, `requestRender()`. Pure UI; no store write.

### Link popover wiring

1. `docs/src/view/text-box-editor.ts` — add `onLinkRequest?: () =>
   void` to `TextBoxEditorOptions`, set
   `textEditor.onLinkRequest = opts.onLinkRequest` after construction.
2. `slides/src/view/editor/text-box-editor.ts` — forward
   `MountSlidesTextBoxOptions.onLinkRequest` to `initializeTextBox`.
3. `SlidesEditor.enterEditMode` passes
   `options.onLinkRequest` down to `mountSlidesTextBox`.
4. Frontend (`slides-detail.tsx`) wires `onLinkRequest` to a small
   floating input bound to the current text-box selection range.
   (Same shape as the docs link popover — defer richer UX.)

For v1, the popover is a minimal element ("URL: [____] [OK] [Cancel]")
positioned near the caret. Without selection it inserts a new link;
with a selection it wraps the run. Implementation reuses
`getStyleAtCursor` / `toggleStyle` already on the text-editor.

### Help modal

`frontend/src/app/slides/slides-shortcuts-help.tsx`:

- Centered, max-width modal with categories laid out vertically.
- Closes on `Esc`, click outside, or the `×` button.
- Content sourced from `SHORTCUTS` (imported from
  `@wafflebase/slides`).
- No search / filter in v1; the list is short enough to scan.

The modal is the only new visible UI surface in this PR.

### Testing

Two layers:

- **Unit (keyboard.test.ts).** One test per new rule, asserting:
  - The keyRule mutation observed (selection state, store contents, or
    callback invocation via `vi.fn()`).
  - The editable-target gate (where applicable) — focus a `<textarea>`,
    dispatch the key, assert no-op.
  - Platform parity for `Mod` — exercise both `metaKey` and `ctrlKey`.

- **Catalog test.** `shortcuts-catalog.test.ts` asserts catalog
  invariants (every entry has non-empty keys, every category is one
  of the expected values).

The frontend wiring is exercised by existing slides smoke tests; the
new help modal gets a focused jsdom test (open via callback, close via
Esc).

## Risks and Mitigation

- **Catalog drift.** Catalog and keyRules are separate arrays. If a
  rule is added without a catalog entry, the help modal silently
  omits it. Mitigation: include a developer-facing TODO comment in
  the catalog and document the dual-edit in `slides.md`'s
  Interactions table.

- **Tab-cycle ordering surprises.** Tab uses element-array order
  (current z-order). When the user reorders elements, Tab follows.
  This matches Google Slides. Document in the design.

- **Enter ambiguity.** Enter doubles as "enter edit mode on selected
  text element" and "submit dialogs / form inputs". The
  `isEditableTarget` gate handles form inputs; the rule no-ops when
  the selection isn't exactly one text element.

- **Page Up / Page Down conflict with text scrolling.** Slides has
  no scrolling content surface (slide thumbnails have their own
  scroll, but its container isn't a textarea/input). The rule
  invokes the editable-target gate so focused textareas keep their
  default behaviour.

- **Present-mode side effects.** `Cmd+Enter` while editing a text-box
  would today commit the text-box (Enter inserts newline; Cmd-Enter
  is special). We bypass the editable-target gate for the present
  shortcut, but the docs text-editor's own handler for
  Cmd/Ctrl+Enter (which inserts a page break in docs) is **not
  inherited** here — slides text-box doesn't expose page breaks. The
  text-editor's `case 'Enter'` branch fires only when the key is
  Enter and the `editContext` is 'body' (the default in slides);
  we keep the slides keyRule but call `e.preventDefault()` first.
