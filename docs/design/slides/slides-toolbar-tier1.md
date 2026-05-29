---
title: slides-toolbar-tier1
target-version: 0.4.3
---

# Slides Toolbar — Tier 1 Universal Controls

## Summary

Add five universal toolbar controls to the slides editor to close the
most-cited gaps against Google Slides and PowerPoint without changing
the existing morphing-toolbar architecture:

1. **Format painter** — copy fill/stroke or inline text style to the
   next click. Global-L (next to Undo/Redo).
2. **Zoom dropdown** — Fit / 50 / 75 / 100 / 150 / 200 % with `⌘+` /
   `⌘−` keyboard shortcuts. Global-R, before Theme.
3. **Layout split-button** — change the current slide's layout from
   the toolbar. Right of `+ Slide ▾`.
4. **Clear formatting** — strip all inline text styles from the
   current selection. Text-edit section.
5. **Font size steppers (A↑ / A↓)** — bump font size up/down in the
   slides text-edit and text-element states.

The five controls are additive and ship in one PR organised into
five independent commits (one per control) so a partial revert is
trivial. No changes to the morphing-toolbar state machine in
`packages/frontend/src/app/slides/toolbar/index.tsx` — all five drop
into existing zones.

## Goals / Non-Goals

### Goals

- Close the most-cited GS / PPT toolbar gaps in a single, low-risk PR.
- Reuse existing APIs wherever possible: `store.applyLayout`,
  `showLayoutPicker`, `editor.applyStyle`. New surface area is
  minimised to two editor methods (`beginFormatPaint`,
  `cancelFormatPaint`) and one optional method on the shared
  `TextFormattingEditor` interface (`clearInlineFormatting`).
- Zoom is a *view-level* feature: lives in `slides-view.tsx` state,
  flows to the toolbar via props. The slides editor itself stays
  unaware of user zoom — `setHostSize` already absorbs it.
- Format painter v1 handles **homogeneous** paste only: shape→shape,
  text-run→text-run. Cross-type paint (e.g. shape stroke → text-box
  border) is out of scope for v1.

### Non-Goals

- Mouse/touch hover-preview while painting (PowerPoint shows a paint
  cursor; v1 just shows the standard "crosshair" cursor).
- Multi-target paint with the paintbrush still held — single-shot
  only; double-click for sticky paint is v1.1.
- Persisting per-slide zoom — zoom is a session-only UI state, reset
  to Fit on doc reload, matching Google Slides behaviour.
- Pinch / trackpad-gesture zoom — keyboard `⌘+` / `⌘−` + dropdown
  only.
- Cross-package text formatting unification beyond
  `clearInlineFormatting` — the docs editor already covers its own
  Clear-formatting menu item, no docs UI change is bundled.

## Proposal Details

### 1. Layout split-button

Currently the `+ Slide ▾` chevron opens the layout picker for a
**new** slide. Layout change for the **current** slide is reachable
via right-click → "Change layout" only. Toolbar exposure mirrors
Google Slides' "Layout ▾" button.

**Component** — new `toolbar/layout-button.tsx`:

```tsx
export function LayoutButton({ store, editor }: { store: SlidesStore | null; editor: SlidesEditor | null }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const onOpen = useCallback(() => {
    const slideId = editor?.getCurrentSlideId();
    if (!store || !slideId) return;
    if (closeRef.current) { closeRef.current(); return; }
    const slide = store.read().slides.find((s) => s.id === slideId);
    const rect = ref.current!.getBoundingClientRect();
    closeRef.current = showLayoutPicker(document.body, {
      store,
      trigger: ref.current!,
      anchor: { x: rect.left, y: rect.bottom + 4 },
      selectedLayoutId: slide?.layoutId,
      onPick: (layoutId) => store.batch(() => store.applyLayout(slideId, layoutId)),
      onClose: () => { closeRef.current = null; },
    });
  }, [store, editor]);

  // ...trigger button render (label "Layout", chevron icon)
}
```

Reuses `store.applyLayout` (existing) and `showLayoutPicker`
(existing, already used by `+ Slide` and the thumbnail panel).
Mounted in `toolbar/index.tsx` right of `<SlideGroup>`, inside the
same separator zone.

### 2. Font size steppers (A↑ / A↓)

**Where it appears:**
- Text-edit state (existing `text-edit-section.tsx`) — next to the
  Font / Size dropdowns.
- Text-element state (existing `text-element-controls.tsx`) — same
  position relative to Size ▾.

**New shared component** —
`packages/frontend/src/components/text-formatting/text-size-stepper.tsx`:

```tsx
const SIZE_STOPS = [6, 7, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96] as const;

function bumpSize(current: number | undefined, dir: 1 | -1): number {
  const cur = current ?? 11; // matches docs default in types.ts
  if (dir === 1) return SIZE_STOPS.find((s) => s > cur) ?? cur;
  return [...SIZE_STOPS].reverse().find((s) => s < cur) ?? cur;
}

export function TextSizeStepper({ editor }: { editor: TextFormattingEditor | null }) {
  const cur = editor?.getSelectionStyle().fontSize;
  return (
    <>
      <button aria-label="Decrease font size" onClick={() => editor?.applyStyle({ fontSize: bumpSize(cur, -1) })}>A↓</button>
      <button aria-label="Increase font size" onClick={() => editor?.applyStyle({ fontSize: bumpSize(cur, +1) })}>A↑</button>
    </>
  );
}
```

`SIZE_STOPS` matches Google Slides' size list. No new API on
`TextFormattingEditor` is needed — `applyStyle({ fontSize })` already
exists.

For the **text-element** (box-level) state, the stepper is a thin
wrapper that calls `store.withTextElement(...)` to write the new
size to every inline run, matching the existing Size ▾ behaviour in
`text-element-controls.tsx`. We extract the per-run write loop into
a tiny `setBoxFontSize(store, slideId, ids, size)` helper so both the
existing Size ▾ and the new stepper share the path.

### 3. Clear formatting

**New method on `TextFormattingEditor`** (interface in
`components/text-formatting/types.ts`):

```ts
/** Strip all inline styles (B / I / U / S, color, highlight, size, family) from the selection. */
clearInlineFormatting(): void;
```

**Implementations:**
- Docs `EditorAPI` — already has a `clearFormatting` action exposed
  via Cmd+\ (verify path; if absent, add); just rename or alias the
  method to match the interface name.
- Slides text-box editor (`view/editor/text-box-editor.ts`) — new
  method that walks the active selection and writes `style = {}` to
  each run. Uses the existing `applyInlineStyleAt(...)` low-level
  helper if available, else falls back to `withTextElement` over the
  full selection range.

**UI** — append to `text-format-group.tsx` after the Link button:

```tsx
<button aria-label="Clear formatting" onClick={() => editor?.clearInlineFormatting()}>
  <IconClearFormatting size={16} />
</button>
```

Disabled when no selection style exists (i.e. when
`Object.keys(getSelectionStyle()).length === 0`).

### 4. Zoom dropdown

**State location** — `slides-view.tsx` already owns the canvas
sizing math. Add a `userZoom: number` (default `1.0`) ref + setter
exposed through a `ZoomController` shape:

```ts
export interface ZoomController {
  get(): number;            // 1.0 = Fit
  set(value: number): void; // clamps to [MIN_ZOOM, MAX_ZOOM]; 1.0 ⇒ Fit
  subscribe(cb: () => void): () => void;
}
```

`refitCanvas` multiplies `fit.width` / `fit.height` by `userZoom`,
then clamps host size by `MAX_HOST_W`. When `userZoom > 1` and the
clamp kicks in, horizontal/vertical scroll appears (the existing
`canvasWrap` scroll container already supports this; no scroll-pan
work needed).

**Flow:** `slides-detail.tsx` creates the controller, passes it to
both `<SlidesView />` (the view subscribes to repaint) and
`<SlidesToolbar />` (the dropdown reads + writes through it).

**Component** — new `toolbar/zoom-control.tsx`:

```tsx
const PRESETS = [0.5, 0.75, 1.0, 1.5, 2.0] as const;

export function ZoomControl({ controller }: { controller: ZoomController | null }) {
  // Subscribe to controller.subscribe to rerender on change.
  // Dropdown shows: Fit (1.0), 50%, 75%, 100%, 150%, 200%.
  // 1.0 always labelled "Fit" because that *is* the auto-fit baseline.
}
```

**Keyboard:** add `⌘+` / `⌘−` to
`packages/slides/src/view/editor/interactions/keyboard.ts` — both
fire `controller.set(next/prev preset)`. Catalog entry added to
`shortcuts-catalog.ts` for the help modal.

### 5. Format painter

**Editor state** — three new methods on `SlidesEditor`:

```ts
beginFormatPaint(source: 'shape-fill' | 'shape-stroke' | 'shape-all' | 'text-run'): void;
cancelFormatPaint(): void;
isPaintingFormat(): boolean;
onPaintFormatChange(cb: () => void): () => void;
```

Internally the editor stashes a snapshot of the source style when
`beginFormatPaint` is called from the *current* selection, and the
next pointer-down on an element of compatible type writes the
snapshot to the target, then auto-cancels the paint mode.

**v1 capture matrix:**

| Source selection | Captured |
|---|---|
| Single shape | `{ fill, stroke }` from `shape.data` |
| Single connector | `{ stroke }` from `connector` |
| Single text-element (box) | `{ fill, stroke }` from `text.data` |
| Text edit (selection) | `getSelectionStyle()` snapshot |

**v1 paste matrix:**

| Cursor target | Writes |
|---|---|
| Shape | captured `fill` and/or `stroke` via `updateElementData` |
| Connector | captured `stroke` via `updateConnectorStroke` |
| Text-element (box) | captured `fill`/`stroke` via `updateElementData` |
| Text run (during paint, with text-edit active) | captured inline style via `applyStyle` over current selection |

Cross-type paste is a no-op + toast in v1.

**UI** — `toolbar/format-painter.tsx`:

```tsx
export function FormatPainterButton({ editor }: { editor: SlidesEditor | null }) {
  const [active, setActive] = useState(false);
  useEffect(() => editor?.onPaintFormatChange(() => setActive(editor.isPaintingFormat() ?? false)), [editor]);

  return (
    <Toggle pressed={active} aria-label="Format painter (single)" onPressedChange={(p) => {
      if (!editor) return;
      if (p) editor.beginFormatPaint(currentSource(editor));
      else editor.cancelFormatPaint();
    }}>
      <IconBrush size={16} />
    </Toggle>
  );
}
```

Mounted in `toolbar/index.tsx` directly after `UndoRedoGroup`. Esc
already cancels editor-level modes; we hook into the same path so a
single Esc cancels paint mode too.

### Component map

```
packages/frontend/src/app/slides/toolbar/
├── format-painter.tsx                 (NEW)
├── layout-button.tsx                  (NEW)
├── zoom-control.tsx                   (NEW)
├── text-element-controls.tsx          (MODIFY — mount stepper)
├── text-edit-section.tsx              (MODIFY — mount stepper, clear-format)
├── global-controls.tsx                (MODIFY — RightGlobals gets ZoomControl)
└── index.tsx                          (MODIFY — mount FormatPainter, LayoutButton)

packages/frontend/src/components/text-formatting/
├── text-size-stepper.tsx              (NEW)
├── text-format-group.tsx              (MODIFY — clear-format button)
└── types.ts                           (MODIFY — add clearInlineFormatting)

packages/frontend/src/app/slides/
└── slides-view.tsx                    (MODIFY — userZoom in refitCanvas + ZoomController)

packages/slides/src/view/editor/
├── editor.ts                          (MODIFY — beginFormatPaint API + Esc handling)
├── text-box-editor.ts                 (MODIFY — clearInlineFormatting)
├── interactions/keyboard.ts           (MODIFY — Cmd+/- zoom shortcuts)
└── shortcuts-catalog.ts               (MODIFY — zoom + paint-format entries)

packages/docs/src/view/editor-api.ts    (MODIFY — clearInlineFormatting if absent)
```

### Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Format painter capture snapshot drifts if user changes the source after `beginFormatPaint`. | User clicks paint, then edits the source, then clicks target — sees stale paste. | Capture happens **at `beginFormatPaint` time**, then the source is irrelevant. Editor state is small and read-only. |
| Zoom > 1 causes huge host canvas and OOM on low-end laptops. | Memory exhaustion on a 4K display × 2.0 zoom. | `MAX_HOST_W = 1600` clamp in `slides-view.tsx` already caps host width; user just gets scroll above that. |
| Layout button confuses users — they see `+ Slide ▾ Layout ▾` and don't know which adds and which changes. | Mis-clicks. | Different icons (`+` vs grid icon), tooltip "Change layout of current slide" on the second button, both already follow existing GS conventions. |
| Clear-formatting on a slides text-box wipes a placeholder's role styles. | Title placeholder loses its bold + large font. | `clearInlineFormatting` strips run styles only, not layout-defaulted block styles. A re-paint after clear pulls layout defaults from the slide layout's placeholder, so the visible result equals "back to layout default". |
| Format painter cross-type silently no-ops surprise users. | "Why didn't my paint work?" | v1 explicitly shows a toast `"Format painter only works between shapes or between text runs"` on incompatible drop. |
| Cmd+/− on zoom conflicts with the docs editor's own Cmd+/− if shared elsewhere. | Keystroke collision. | Slides keyboard wiring lives in `view/editor/interactions/keyboard.ts` and only fires when the slides editor has focus. Docs is mounted separately. |
