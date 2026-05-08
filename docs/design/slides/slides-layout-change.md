---
title: slides-layout-change
target-version: 0.4.1
---

# Slides Layout Change

## Summary

Expose layout switching to slide authors. The store-level
`applyLayout(slideId, layoutId)` already exists, but no UI surfaces
it and the current implementation is conservative (additive only,
no placeholder identity tracking). This design upgrades the model
with **placeholder identity tracking** (Element `placeholderRef`),
rewrites `applyLayout` with type-first slot matching, and adds two
UI entry points sharing a single `LayoutPicker` component.

### Goals

- Authors can pick a layout when inserting a new slide (the `+`
  button in the thumbnail panel), instead of always getting `blank`.
- Authors can change an existing slide's layout via the slide
  context menu ("Change layout ▶") without losing typed content.
- Switching from a richer layout (more placeholders) to a leaner
  layout never silently destroys typed content — orphaned
  placeholders demote to plain elements rather than disappear.
- Picker previews track the current theme so users see what they
  will get.
- The whole feature ships in a single PR, including model
  migration considerations (see Non-Goals: no migration pass).

### Non-Goals

- **Backwards-compat migration of pre-existing decks.** The slides
  package is not yet deployed to production users; dev/test decks
  may go through one awkward "first applyLayout" if their elements
  pre-date `placeholderRef`. Acceptable cost for shipping simply.
- **A toolbar "Layout ▾" button.** Deferred — context menu +
  split-button on insert is enough for v1. Add later if usage data
  shows demand.
- **Custom (user-defined) layouts.** Only the 11 built-in layouts
  defined in `BUILT_IN_LAYOUTS` are exposed. Custom layouts wait
  for the v2 master-slides initiative.
- **"Last-used layout" memory on the `+` button.** Plain click
  always inserts `blank`. Adding session-state memory is a small
  follow-up.
- **Confirm dialogs.** Layout switches never block on a dialog;
  users rely on undo for recovery (no destructive operation
  happens — orphans demote, not delete).

## Proposal Details

### Model — `Element.placeholderRef`

Add an optional `placeholderRef` to `Element`
(`packages/slides/src/model/element.ts`):

```ts
export type PlaceholderType =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'big-number';

export type PlaceholderRef = {
  type: PlaceholderType;
  index: number; // 0-based among same-type slots in the source layout
};

export type Element = {
  id: string;
  type: ElementType;
  frame: Frame;
  placeholderRef?: PlaceholderRef; // absent = user-added
  // ...existing fields
};
```

Extend `PlaceholderSpec`
(`packages/slides/src/model/presentation.ts`) with the slot type:

```ts
export type PlaceholderSpec = ElementInit & {
  placeholder: { type: PlaceholderType };
};
```

The `index` is computed from the `layout.placeholders` array
(count of preceding entries with the same type), not stored on
the spec — this avoids redundant data and keeps the layout
authoring concise.

### Layout placeholder type assignments

Every entry in `BUILT_IN_LAYOUTS`
(`packages/slides/src/model/layout.ts`) gets a `placeholder.type`:

| Layout id | Slot types (in array order) |
|---|---|
| `blank` | (none) |
| `title-slide` | `title`, `subtitle` |
| `section-header` | `title` |
| `title-body` | `title`, `body` |
| `title-two-columns` | `title`, `body`, `body` |
| `title-only` | `title` |
| `one-column-text` | `body` |
| `main-point` | `title` |
| `section-title-description` | `title`, `body` |
| `caption` | `body`, `caption` |
| `big-number` | `big-number`, `body` |

### Store — `addSlide` annotates new placeholders

`Store.addSlide(layoutId)` (in both `MemSlidesStore` and
`YorkieSlidesStore`) annotates each new placeholder element with
its `placeholderRef`:

```ts
const sameTypeBefore = layout.placeholders
  .slice(0, i)
  .filter((p) => p.placeholder.type === spec.placeholder.type)
  .length;
slide.elements.push({
  ...clone(spec),
  id: generateId(),
  placeholderRef: { type: spec.placeholder.type, index: sameTypeBefore },
});
```

### Store — `applyLayout` semantics

A pure function `applyLayoutToSlide(slide, newLayout): void` lives
in `packages/slides/src/model/layout.ts` and is called by both
stores so the semantics never diverge.

The algorithm has three passes:

1. **Partition** existing `slide.elements` into:
   - **placeholder elements** (`placeholderRef` present)
   - **user-added elements** (no `placeholderRef`) — these are
     never touched.

2. **Match** every slot in the new layout, by `(type, index)`:
   - If a placeholder element matches `(type, index)` exactly,
     reuse it: update its `frame` to the new slot's frame, update
     its `placeholderRef` to the new layout's slot, and **preserve
     its content** (`data.blocks` for text).
   - If no match, create a fresh empty placeholder element from
     the slot's spec.

3. **Demote orphans** — placeholder elements not chosen by any
   slot in pass 2:
   - Empty (all inlines have `text === ''` for text elements) →
     **delete**.
   - Non-empty → **demote**: `delete element.placeholderRef`. The
     element keeps its frame and content and becomes a plain user
     element.

Finally `slide.layoutId = newLayout.id`.

The "is empty" check is a small helper in `model/element.ts`
(`isElementEmpty(element): boolean`). All v1 layouts produce only
**text** placeholders, so the helper today returns `true` when
every inline of every block has `text === ''`. When v1.5
introduces image/shape placeholders, extend the helper —
non-text element types fall back to `false` (treated as
non-empty) until then so we never lose a non-text orphan.

### Yorkie store

`YorkieSlidesStore.applyLayout`
(`packages/frontend/src/app/slides/yorkie-slides-store.ts:559`)
calls the same pure `applyLayoutToSlide` from inside its existing
`this.doc.update((r) => …)` block, where direct mutation of the
slide proxy already works for the simpler additive logic today.
`addSlide` likewise invokes the shared placeholder-annotation
helper so the two stores stay byte-for-byte equivalent for the
same input. No new collaboration-specific logic is introduced.

Concurrent `applyLayout` from two clients converges via the
underlying CRDT on `slide.layoutId` (last-write-wins) and the
`elements` array (Yorkie array merge). Coverage is added behind
`RUN_YORKIE_INTEGRATION_TESTS`.

### UI — vanilla-DOM layout picker

The slides package is intentionally framework-free
(`packages/slides/README.md`). Both UI surfaces that invoke the
picker (`thumbnail-panel.ts`, `context-menu.ts`) are vanilla DOM,
so the picker itself is also a vanilla-DOM module living in
`packages/slides/src/view/editor/layout-picker.ts`.

Public API:

```ts
export interface LayoutPickerOptions {
  store: SlidesStore; // for theme/master lookup
  selectedLayoutId?: string; // outlined cell, optional
  anchor: { x: number; y: number };
  onPick: (layoutId: string) => void;
  onClose: () => void;
}

export function showLayoutPicker(
  host: HTMLElement,
  opts: LayoutPickerOptions,
): void;
```

The picker mounts a `<div>` popover into `host`, positioned at
`anchor`. Layout grid cells are 4×3 (last cell empty), each cell
is a `<canvas>` produced by `renderLayoutPreview` plus a label.
Click → `onPick(layoutId)` then `onClose()`. Outside-click and
Esc → `onClose()` only. Arrow-key nav and Enter for keyboard.

### UI — split-button on `+`

`packages/slides/src/view/editor/thumbnail-panel.ts:120` is the
only place that calls `addSlide('blank')`. Split the existing
`<button>` into a flex container with two hit zones:

- Left (`+ Add slide`) — preserves current behaviour: insert
  `blank` after the current slide.
- Right (`▾`, ≥24 px wide) — calls `showLayoutPicker(host, …)`
  positioned at the button's bounding rect. `onPick(layoutId)`
  runs `store.batch(() => store.addSlide(layoutId, atIndex))` and
  re-renders the panel. `selectedLayoutId` is omitted (no current
  selection — it is a new slide).

### UI — context menu "Change layout"

`packages/slides/src/view/editor/context-menu.ts` currently
supports flat items only (`{ label, run }`); submenus are not
needed here. Add a "Change layout…" item whose `run` calls
`showLayoutPicker(host, …)` at the click anchor. `onPick` runs
`store.batch(() => store.applyLayout(slideId, layoutId))`. Only
shown when the right-click target is the slide background, not
an element (matching where layout matters).

### Layout previews — synthetic-slide thumbnails

New helper file: `packages/slides/src/view/canvas/layout-preview.ts`.

```ts
export function renderLayoutPreview(
  layout: Layout,
  theme: Theme,
  master: Master,
  size: { w: number; h: number }, // e.g., 160 × 90
): HTMLCanvasElement;
```

Internally:
1. Build a synthetic `Slide` from `layout.placeholders` (kept
   empty) and `layout.staticElements`. Background comes from the
   layout (or theme default).
2. Pass the synthetic slide through the existing
   `view/canvas/thumbnail.ts` pipeline at scale =
   `size.w / SLIDE_WIDTH`.
3. Return the resulting `HTMLCanvasElement`.

A module-level `Map` cache keyed
`${themeId}:${masterId}:${layoutId}:${w}x${h}` avoids re-rendering
the same preview. Theme/master switches naturally produce
different keys; old entries fall out of reachability and become
GC eligible. No LRU eviction in v1 (5 themes × 1 master × 11
layouts × 2 sizes = 110 entries max).

### Empty-placeholder ghost text

A new slide produced from a non-blank layout immediately presents
empty placeholder text boxes. Without a hint, the slide reads as
visually empty — the author can't tell where the title goes vs.
where the body goes. Google Slides, PowerPoint, and Keynote all
solve this with **ghost text**: a faint grey label inside any
empty placeholder ("Click to add title", "Click to add text", …)
that disappears the moment a character is typed.

Implementation:

- `packages/slides/src/model/placeholder-hints.ts` — small lookup
  table from `PlaceholderType` to default English hint string. The
  function is a single seam, ready for future i18n via either a
  per-document override or a runtime locale lookup.

  ```ts
  export const PLACEHOLDER_HINTS: Record<PlaceholderType, string> = {
    title: 'Click to add title',
    subtitle: 'Click to add subtitle',
    body: 'Click to add text',
    caption: 'Click to add caption',
    'big-number': 'Click to add number',
  };

  export function placeholderHintFor(type: PlaceholderType): string {
    return PLACEHOLDER_HINTS[type];
  }
  ```

- `drawText` (`view/canvas/text-renderer.ts`) gains an optional
  `placeholderHint?: string` parameter. When set **and** the text
  element's blocks are all empty (existing `isElementEmpty`
  semantics), it paints the hint string in a muted theme-aware
  grey at the placeholder's natural baseline instead of running
  the empty layout pass.

- `drawElement` (`view/canvas/element-renderer.ts`) passes the
  hint when the element has a `placeholderRef`, otherwise omits
  it. User-added text boxes get no hint — by design.

- The text-box editor (vanilla `contentEditable`) is **out of
  scope** for v1. While the user is actively editing, the
  contentEditable layer covers the canvas; if the user deletes
  every character, the canvas hint shows through provided the
  editor's background is transparent. If a future test or visual
  smoke shows a flicker on first character typed, add a
  placeholder hint at the contentEditable layer too — small
  follow-up.

- Presentation mode is not yet built (Phase 5b-2). When it lands,
  it gates its own renderer flag and skips the hint entirely so
  ghost text never reaches the audience.

### Migration

**None.** The slides package is not yet deployed to production
users. Dev/test decks may have pre-`placeholderRef` elements; on
their first `applyLayout`, those elements are treated as
user-added — meaning the new layout's empty placeholders will be
laid down on top while existing typed content stays demoted. This
is a one-time awkward experience for dev decks only.

The existing `LAYOUT_ID_MIGRATIONS` pass in
`packages/slides/src/model/migrate.ts` is unchanged.

### Testing

Unit (Vitest, in `@wafflebase/slides`):
- `model/layout.test.ts` — every layout in `BUILT_IN_LAYOUTS` has
  the expected slot types (snapshot).
- `store/memory.test.ts` — six `applyLayout` cases:
  1. blank slide → new layout's placeholders only.
  2. placeholder with content → preserved into same-type slot.
  3. ambiguous same-type, different index (two-columns body 0/1)
     → matched by index.
  4. fewer slots, empty orphans → deleted.
  5. fewer slots, non-empty orphans → demoted (no `placeholderRef`,
     frame and content unchanged).
  6. user-added text/image/shape → untouched (frame/content).
- `addSlide` test — every produced placeholder element carries a
  `placeholderRef`.
- Two-store equivalence — both `MemSlidesStore` and
  `YorkieSlidesStore` route through the shared
  `applyLayoutToSlide` and produce identical results for the same
  inputs.

Yorkie integration (gated by `RUN_YORKIE_INTEGRATION_TESTS=true`):
- Two clients call `applyLayout` concurrently → final state
  converges (one client's `layoutId` wins; element edits merge).

Canvas render (jsdom):
- `view/canvas/layout-preview.test.ts` — renders all 11 layouts
  for the default theme without throwing; cache hits on second
  call with the same key.

Browser smoke (manual, `pnpm dev`):
1. New deck → `+ ▾` → exercise 5 layouts; placeholders render.
2. Type into a placeholder → context-menu Change layout →
   content preserved in same-type slot.
3. Two-columns with text in both bodies → switch to title-only →
   exactly one demoted body element remains, plus the new
   `title-only` placeholder.
4. Theme switch → reopen picker → previews reflect new theme.
5. Undo after layout change is one step (covered by the
   surrounding `store.batch`).

`pnpm verify:fast` plus the manual smoke list is the merge gate.

## Risks and Mitigation

- **Risk: `applyLayout` matching surprises authors.** A slide
  with two body slots (two-columns) collapsed into a single body
  layout will have a clearly visible orphan demoted element.
  Mitigation: undo is one step (we batch) and the demoted element
  stays put, easy to find and delete. If usage data later shows
  this is too surprising, we can add a sticky toast on demote
  ("N items kept as free elements — click to undo") in a
  follow-up.

- **Risk: dev decks see one awkward first switch.** Acceptable —
  not deployed yet. If decks accumulate before launch, a
  one-shot back-fill in `migrate.ts` is a 30-line change.

- **Risk: preview cache grows unbounded with many themes.** Today
  there are 5 themes, ≤2 masters per deck in practice, 11
  layouts, and 1–2 preview sizes — roughly ≤220 canvases. At
  160×90 RGBA, each canvas is ≈ 56 KB, so ≤ 13 MB worst case.
  Acceptable. If custom themes ship, add LRU.

- **Risk: split-button hit-target ambiguity.** Mitigated by
  separator + ≥24 px right zone, and unambiguous icons (`+` left,
  `▾` right). Verified in browser smoke.

- **Risk: collaboration races on concurrent `applyLayout`.**
  Yorkie's array-merge plus last-write-wins on `slide.layoutId`
  handles this; the integration test asserts convergence.
