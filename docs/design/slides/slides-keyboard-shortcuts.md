---
title: slides-keyboard-shortcuts
target-version: 0.4.1
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

### Shift modifiers during drag

Holding Shift while dragging applies a context-specific constraint
(1:1 shape draw, 15° angle snap on lines/connectors and endpoints,
axis lock on element move; the existing aspect-ratio resize and 15°
rotate continue to apply). Sampled live — pressing or releasing Shift
mid-drag updates the constraint immediately. For connector draw and
endpoint drag, Shift wins over connection-site snap.

Full design and per-interaction matrix:
[slides-shift-modifiers.md](./slides-shift-modifiers.md).

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
modal search field) is not intercepted. The gate also bails when the
focused element is inside an interactive widget (`role="dialog"`,
`role="menu"`, focused `<button>`, etc.) so the help modal's own Tab
navigation doesn't get hijacked by the slides Tab-cycle rule.

Exceptions:

- `Cmd+/` (help modal) bypasses the gate — help should always open.
- `Cmd+K` (link) flows through the docs text-editor inside text-box
  edit mode; no slides-level rule needed.
- `Cmd+Enter` / `Cmd+Shift+Enter` (start presentation) **respect** the
  gate. The original intent was to make them global like Google
  Slides, but the docs text-editor binds Cmd+Enter to a `handlePageBreak`
  op that writes a `page-break` block into the doc store (a docs-only
  concept). Letting both fire produces stale page-break blocks in
  slide text-element data. The pragmatic v1 behaviour: respect the
  gate, document that the user can press Esc to exit text edit
  before starting present mode. A clean fix is to expose a
  `disablePageBreak` option on `TextBoxEditorOptions` (or skip
  Cmd+Enter in the docs handler when `editContext` flags it as a
  shim) — tracked as a follow-up.

### Catalog module

`slides/src/view/editor/shortcuts-catalog.ts`:

```ts
export type ShortcutCategory =
  | 'Selection'
  | 'Slide'
  | 'Clipboard'
  | 'Z-order'
  | 'Nudge'
  | 'Format'
  | 'Present'
  | 'Help';

export interface ShortcutEntry {
  /** Category for grouping in the help modal. */
  category: ShortcutCategory;
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

`Cmd+K` flows: docs `TextEditor.onLinkRequest` → docs `text-box-editor`
forward → slides `text-box-editor` forward →
`SlidesEditorOptions.onLinkRequest` → host shell. The slides side
plumbs the callback through without owning the popover UI; a real
popover requires extending `TextBoxEditorAPI` with `insertLink(url)`
/ `getLinkAtCursor()` so the host can mutate the active text-box.

### Help modal

The host shell renders the modal from the `SHORTCUTS` catalog. It is
the only path users have to discover the parity shortcuts, so its
content must remain in lock-step with the catalog — see the
"Catalog drift" risk below.

## Risks and Mitigation

- **Catalog drift.** Catalog and keyRules are separate arrays. If a
  rule is added without a catalog entry, the help modal silently
  omits it. The catalog test asserts surface invariants (non-empty
  keys, valid category), which catches typos but not deletions. The
  dual-edit convention is documented in the `shortcuts-catalog.ts`
  head comment.

- **Tab-cycle ordering surprises.** Tab uses element-array order
  (current z-order). When the user reorders elements, Tab follows.
  This matches Google Slides.

- **Enter ambiguity.** Enter doubles as "enter edit mode on selected
  text element" and "submit dialogs / form inputs". The
  `isEditableTarget` gate handles form inputs; the rule no-ops when
  the selection isn't exactly one text element.

- **Present-mode side effects.** `Cmd+Enter` while editing a text-box
  routes through the docs text-editor first, which binds it to
  `handlePageBreak()` — inserts a `page-break` block. That block is
  filtered at render but persists in the in-memory store and would
  be committed to the slide on blur. Mitigation: the present-mode
  keyRule respects the editable-target gate, so Cmd+Enter inside a
  text-box defers to the docs handler. A cleaner fix (a docs
  text-box `disablePageBreak` option) is tracked as a follow-up.
