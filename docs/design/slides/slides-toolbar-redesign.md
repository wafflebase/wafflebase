---
title: slides-toolbar-redesign
target-version: 0.4.2
---

<!-- Append this document link to docs/design/README.md after merging. -->

# Slides Toolbar Redesign

## Summary

Replace the current always-on slides toolbar with a single morphing
toolbar that mirrors Google Slides: a fixed global frame on the
outside, a contextual middle region that swaps based on selection
state. The redesign also fills in commonly-missing affordances
(Undo/Redo, image insert, slide background, text formatting on
selection, shape border, image replace/crop) and consolidates the
eight always-visible align/distribute buttons into a single
**Arrange** dropdown. Text formatting controls are extracted from
`docs-formatting-toolbar.tsx` into shared components so docs and
slides stop duplicating the same B/I/U/color/align widgets.

The work ships in three PRs of declining risk: shell restructure +
Arrange consolidation, shared text-formatting extraction + slides
text-edit state, and the remaining shape/image affordances.

### Goals

- Reduce visual density: the eight align/distribute icons are no
  longer always on the toolbar.
- Make the toolbar contextual: irrelevant controls hide instead of
  showing as disabled hints.
- Close the most jarring gaps with Google Slides parity: Undo/Redo,
  Insert image, Slide background, Shape border, Image replace/crop,
  text formatting controls inside text-edit mode (B/I/U, color,
  alignment, lists, link, font, size).
- One source of truth for text formatting controls — both docs and
  slides import the same components from
  `packages/frontend/src/components/text-formatting/`.
- Keep the global areas (left: Undo/Redo + Slide; right: Theme +
  Present) stable across state transitions so users don't lose their
  place when the toolbar morphs.
- Land in three separately-verifiable PRs, each green on
  `pnpm verify:fast` and `pnpm verify:browser:docker`.

### Non-Goals

- Menu bar (File / Edit / View / Insert / Slide / Format / Help).
  The slides design doc shows one in its layout sketch but it has
  never been built. Tracked as a separate follow-up spec; the toolbar
  is designed to coexist cleanly with a future menu bar without
  rework.
- Slide transitions and animations. Out of scope per `slides.md`.
- Master slides and user-editable layouts. v2.
- Speaker-notes presenter view. v2.
- Flip horizontal/vertical. Requires `frame.flipH` / `frame.flipV`
  fields and Yorkie schema migration; deferred to v1.1.
- External-URL image embed. Already deferred to v1.1 in `slides.md`.
- Mobile-specific toolbar layout. Desktop-first; an overflow
  (`IconDotsVertical`) menu pattern from docs is reused so narrow
  viewports degrade gracefully without a separate mobile spec.

## Proposal Details

### Architecture: single morphing toolbar

The toolbar is one row organized into four zones:

```
[Global L] | [Insert + Slide actions] | [Contextual — varies] | (push-right) | [Global R]
```

| Zone | Contents | Stability |
|---|---|---|
| Global L | Undo, Redo | Always visible |
| Insert + Slide | `+ Slide ▾`, then `Select / Text / Image / Shape ▾ / Line ▾` (insert group) | Always visible *except* during text edit, where the insert group hides |
| Contextual | Varies by `ToolbarState` (idle / object / text-edit) | Swaps wholesale |
| Global R | Theme, Present | Always visible (Done button replaces Present hint when text-editing) |

**Rule:** the global zones never reflow. The contextual middle is the
only area that changes shape. This keeps Undo/Redo/Slide/Theme/Present
at predictable screen positions across state transitions.

#### State enumeration

```ts
type ToolbarState =
  | { kind: 'idle' }
  | { kind: 'object'; selectionType: 'shape' | 'image' | 'text-element' | 'mixed'; ids: string[] }
  | { kind: 'text-edit'; elementId: string; textEditor: EditorAPI };
```

Derivation lives in `slides-toolbar/index.tsx`:

```ts
function getToolbarState(editor: SlidesEditor | null, store: SlidesStore | null): ToolbarState {
  if (editor?.isTextEditing()) {
    return { kind: 'text-edit', elementId: editor.getEditingElementId()!, textEditor: editor.getActiveTextEditor()! };
  }
  const selection = editor?.getSelection() ?? [];
  if (selection.length === 0) return { kind: 'idle' };
  const types = collectSelectedTypes(store, editor, selection);
  const selectionType = types.size > 1 ? 'mixed' : (types.values().next().value as 'shape' | 'image' | 'text-element');
  return { kind: 'object', selectionType, ids: selection };
}
```

`isTextEditing()`, `getEditingElementId()`, and `getActiveTextEditor()`
are new methods on `SlidesEditor`. They wrap state already tracked by
`view/editor/text-bridge.ts`; the bridge currently knows when text
edit is active but does not expose it. Surface area is three getters
plus an `onTextEditingChange` event so the toolbar can re-render.

### Per-state layout

#### State 1 — Idle

```
[↶ Undo] [↷ Redo] | [+ Slide ▾] | [↖ Select] [T Text] [🖼 Image] [▢ Shape ▾] [— Line ▾] | [🎨 Background] | … [🎨 Theme] [▶ Present]
```

| Button | Source | Notes |
|---|---|---|
| Undo / Redo | New | Wires to `editor.undo()` / `editor.redo()`. Disabled state from `editor.canUndo()` / `canRedo()` with `onHistoryChange` event. Both already work via keyboard. |
| `+ Slide ▾` | Existing | Split-button; chevron opens layout picker. No change. |
| Select / Text / Shape ▾ / Line ▾ | Existing | Insert-mode toggles; behavior unchanged. |
| Image | New | Click opens file picker. On file pick: upload via existing workspace image API (same path as drag-drop and clipboard paste documented in `slides.md`), then `store.batch(() => store.addElement(slideId, { type: 'image', frame: <centered>, data: { src: uploadedUrl } }))`. |
| Background | New | `ThemedColorPicker` reused. On change: `store.batch(() => store.updateSlideBackground(slideId, { fill: color }))`. |
| Theme | Existing | Toggles theme panel. Position unchanged. |
| Present | Moved | Currently lives in `slides-present-button.tsx`, mounted separately. Pulled into the toolbar's Global R zone. The component itself moves intact; only the parent changes. |

**Removed from Idle:** the eight align/distribute buttons (no
selection → meaningless), the always-on Fill/Font hint buttons
(replaced by contextual variants in State 2/3).

#### State 2 — Object selected

Common prefix: `Global L | + Slide | Insert group |`. Differences come
in the contextual middle and the Arrange dropdown at the end.

##### 2a. Shape selected

```
… | [🎨 Fill] [▢ Border ▾] [Border weight ▾] [Border dash ▾] | [⇊ Arrange ▾]
```

- **Fill** — existing `ThemedColorPicker` + `applyShapeFill`.
- **Border color** — new picker; writes `shape.data.stroke.color`.
- **Border weight** — dropdown with values `0 / 1 / 2 / 4 / 8 / 16` px;
  writes `shape.data.stroke.width`.
- **Border dash** — dropdown with `solid / dashed / dotted`; writes
  `shape.data.stroke.dash`. **Model change:** add optional
  `dash?: 'solid' | 'dashed' | 'dotted'` to
  `ShapeElement.data.stroke`. Optional + 'solid' default keeps
  existing Yorkie documents valid.

##### 2b. Image selected

```
… | [🔄 Replace] [✂ Crop] [↺ Reset crop] [Aa Alt text…] | [⇊ Arrange ▾]
```

- **Replace** — file picker, swaps `image.data.src` via
  `updateElementData`.
- **Crop** — toggles a crop edit mode on the editor; resize handles
  on the canvas overlay become crop handles. Writes
  `image.data.crop`.
- **Reset crop** — clears `image.data.crop`. Disabled when no crop is
  set.
- **Alt text** — popover with a textarea; writes `image.data.alt`.

##### 2c. Text element selected (box level, not editing inside)

```
… | [🎨 Background fill] [▢ Border ▾] [Aa Font ▾] [Size ▾] | [⇊ Arrange ▾]
```

- Background/Border act on the text-box frame (treats the text box
  like a shape with a text payload — same `stroke` model). For now,
  text elements get the same `stroke` field as shapes; lift `stroke`
  from `ShapeElement.data` to a shared frame-decoration concept in
  the same PR if convenient, otherwise duplicate the field on
  `TextElement.data` and unify in v1.1.
- Font / Size apply to **all inlines** in the text box at once via
  `withTextElement`. This is the box-level shorthand; per-run editing
  happens in State 3.

##### 2d. Multi-select (mixed types)

```
… | (contextual region empty) | [⇊ Arrange ▾]
```

When the selection spans more than one element type, the contextual
formatting region is omitted. Arrange is always available.

##### Arrange dropdown (common to all object states)

```
Order ▸     Bring to front          ⌘⇧↑
            Bring forward           ⌘↑
            Send backward           ⌘↓
            Send to back            ⌘⇧↓
─────────
Align ▸     Left / Center / Right
            Top / Middle / Bottom
─────────
Distribute ▸  Horizontally  (3+ objects)
              Vertically    (3+ objects)
─────────
Rotate      90° clockwise
            90° counter-clockwise
```

- **Order** — `editor.bringForward()` etc. The keyboard shortcuts
  exist; this just exposes them in UI.
- **Align / Distribute** — `editor.align()` / `editor.distribute()`
  unchanged. Each menu item disabled by the same predicate the
  current toolbar buttons use (`selectionSize === 0` for align,
  `< 3` for distribute).
- **Rotate 90°** — writes `frame.rotation += π/2` (or `-π/2`),
  normalised into `[0, 2π)`. Wraps in `store.batch`. No model change.
- **Flip H / V** — *not in this redesign.* See Non-Goals.

#### State 3 — Text editing

```
[↶ Undo] [↷ Redo] | [+ Slide ▾] | [Size ▾] | [B] [I] [U] [Aa Color ▾] [🔗 Link] | [≡ Align ▾] [• List ▾] [⇥ Indent±] | … [▶ Done] [▶ Present]
```

| Group | Source |
|---|---|
| Undo / Redo | Same buttons as Idle/Object. Always route to `editor.undo()` / `editor.redo()` on `SlidesEditor`. Text-box typing is already grouped into `store.batch` boundaries by the IME-aware grouping rule in `slides.md` ("composition end + ~300 ms idle = one batch"), so a single Undo collapses the right amount of typing. The docs `EditorAPI` undo is *not* called separately from inside text-edit mode — that would risk diverging two undo stacks against the same Yorkie tree. |
| Size | Shared `font-size-picker.tsx`. Value resolved via `getRangeStyleSummary()` with `DEFAULT_INLINE_STYLE.fontSize` as the fallback for unset runs. |
| B / I / U, Color, Link | Shared `text-format-group.tsx`, rendered with `showStrikethrough={false}` and `showHighlight={false}`. |
| Align / List / Indent | Shared `text-paragraph-group.tsx`. |
| Done | New. Calls `editor.exitTextEditing()` (equivalent to Esc). |

The block-style dropdown (Normal / Title / Heading 1–3 — `text-style-group.tsx`) and the Font family picker are intentionally omitted on the slides text-edit surface. Block-level typography is owned by the deck's theme + layout tier (slide titles, body placeholders, headings), so promoting an arbitrary run inside a shape to "Heading 1" lacks the semantic anchor it has in a flowing document. The Font family picker is reachable from the object-level toolbar (`text-element-controls.tsx`) before entering text-edit. Strikethrough and Highlight are dropped to keep the in-edit row at the B/I/U/Color/Link essentials — Highlight backgrounds in particular rarely read against themed slide backgrounds.

The corresponding mobile sheet (`mobile-toolbar.tsx` → `TextFormatSheet`) mirrors the same surface: FontSizePicker on top, then TextFormatGroup (`showStrikethrough={false}, showHighlight={false}`), then TextParagraphGroup. The shared `useResolvedFontSize(textEditor)` hook in `@/components/text-formatting` keeps the three-case font-size resolution (uniform / mixed / unset → docs default) consistent between desktop and mobile.

The docs text-editor's Cmd/Ctrl+Shift+X strikethrough shortcut is suppressed inside `mountSlidesTextBox` via a capture-phase keydown listener on the textarea. Without that suppression the shortcut would still fire from muscle memory inside a slide text-box and apply strike with no UI to read or clear it.

The Insert group is hidden in State 3 — adding a new shape mid-text-edit
is a state-transition footgun. Esc / Done first, then insert.

### Shared text formatting components

Today, B/I/U/Color/Align controls are inlined into
`docs-formatting-toolbar.tsx` (860 lines, no internal componentization
that slides can borrow). PR 2 extracts them:

```
packages/frontend/src/components/text-formatting/
├── text-style-group.tsx        # Font ▾, Size ▾
├── text-format-group.tsx       # B / I / U / S, Color, Highlight, Link
├── text-paragraph-group.tsx    # Align ▾, List ▾, Indent +/-
├── alignment-dropdown.tsx      # already exists inline; extracted
└── color-picker-grid.tsx       # already exists at @/components/color-picker-grid
```

Each component takes `editor: EditorAPI | null` plus a `disabled` flag
and reads/writes through the same `EditContext` API the docs toolbar
uses today. Block-type dropdown (Title / Heading 1–3) stays
docs-specific — it's not extracted because slides text boxes don't
support block types as a v1 concept.

The docs toolbar is refactored in the same PR to import these
components. **No behavior change for docs users**; the PR is a
mechanical extraction guarded by the existing visual + interaction
tests.

### Component layout

```
packages/frontend/src/app/slides/toolbar/
├── index.tsx                        # state derivation + global zones
├── insert-group.tsx                 # Select / Text / Image / Shape / Line
├── slide-group.tsx                  # + Slide split-button
├── arrange-menu.tsx                 # Order / Align / Distribute / Rotate
├── idle-section.tsx                 # Background button
├── object-section.tsx               # router on selectionType
│   ├── shape-controls.tsx
│   ├── image-controls.tsx
│   ├── text-element-controls.tsx
│   └── mixed-controls.tsx
└── text-edit-section.tsx            # composes shared text-formatting groups
```

The existing `slides-formatting-toolbar.tsx` is replaced by
`slides/toolbar/index.tsx`. Imports from `slides-detail.tsx` change
once.

### State machine + event wiring

```ts
// inside slides/toolbar/index.tsx
const [state, setState] = useState<ToolbarState>(() => getToolbarState(editor, store));
useEffect(() => {
  if (!editor) return;
  const refresh = () => setState(getToolbarState(editor, store));
  refresh();
  const offs = [
    editor.onSelectionChange(refresh),
    editor.onCurrentSlideChange(refresh),
    editor.onTextEditingChange(refresh),    // new event
    editor.onHistoryChange(refresh),         // new event for Undo/Redo enablement
    store?.onChange?.(refresh) ?? (() => {}),
  ];
  return () => offs.forEach((off) => off());
}, [editor, store]);
```

`onTextEditingChange` and `onHistoryChange` are added to
`SlidesEditor`. Both already have internal sources of truth
(text-bridge for editing, batch system for history); the events just
fan them out.

### Delivery — single PR (chosen)

The redesign ships as a **single PR** by author preference. The work
is committed in ~13 task-sized commits (one per Task in
`docs/tasks/active/20260515-slides-toolbar-redesign-todo.md`) so the
PR remains reviewable commit-by-commit even though it lands together.
Internal commit order matches the dependency order: model fields →
editor API surface → shared text-formatting extraction → toolbar
scaffold → per-state sections → wire-up + harness scenarios →
final verify.

A three-PR alternative was considered (shell + arrange / shared text
formatting + state 3 / object formatting). It was rejected for
delivery convenience. The risks the three-PR split would have
mitigated are addressed instead by:

- Each commit is independently green on `pnpm verify:fast`, so
  bisect remains useful.
- The docs toolbar refactor commit lands first among the UI changes
  and is guarded by the existing docs visual harness — any regression
  is caught at that commit, not at PR-end.
- The final task runs `pnpm verify:browser:docker` and a manual
  smoke pass before requesting code review.

### Testing strategy

- **Visual harness** — `harness/visual/slides-scenarios.tsx` adds six
  scenarios: idle, single-shape, single-image, single-text-element,
  text-editing-active, multi-select. Each PR updates relevant
  baselines.
- **Interaction tests** (Vitest + jsdom):
  - State transitions: object selected → object section appears;
    text-element double-click → text-edit section appears; Esc →
    object section returns; clear selection → idle section returns.
  - Arrange dropdown: align items disabled with empty selection;
    distribute items disabled with `< 3` selection.
  - Undo/Redo button enablement reflects `editor.canUndo()` /
    `editor.canRedo()`. Verify a typing burst inside a text box
    collapses to a single undo step (per the IME-aware batch rule).
  - Image insert button: file picker opens, mock upload, element
    appears centered on slide.
- **Existing tests** unchanged. The slides editor's behavior is not
  modified — only the UI surfacing it.
- **Docs regression guard (PR 2 only)**: existing docs visual +
  interaction tests must pass with no snapshot diffs (the extraction
  is a refactor, not a redesign of docs).

### Model changes

| Field | PR | Migration |
|---|---|---|
| `ShapeElement.data.stroke.dash?: 'solid' \| 'dashed' \| 'dotted'` | this PR | Optional; reads default to `'solid'`. No Yorkie schema migration needed (Yorkie objects accept new optional keys). |
| `TextElement.data.stroke?: { color, width, dash }` | this PR | Optional; same migration story. Considered: lifting `stroke` to a shared frame-decoration concept on `ElementBase`. Decision: keep duplicated as a v1.1 candidate; revisit when the third element type wants it. |

No changes to `frame`, `Slide`, or `SlidesDocument`.

### Tier 1 universal controls (v0.4.3, additive)

Five universal controls layered on top of the morphing-toolbar shell
without touching the state machine — each drops into an existing zone:

1. **Format painter** — Global L, after Undo/Redo. `beginFormatPaint` /
   `cancelFormatPaint` / `isPaintingFormat` on `SlidesEditor` snapshot the
   source style at click time; the next pointer-down on a compatible
   element writes it, then auto-cancels. v1 is homogeneous only
   (shape→shape `{fill, stroke}`, text-run→text-run inline style); cross-type
   is a no-op + toast. Esc cancels via the existing editor-mode path.
2. **Zoom dropdown** — Global R, before Theme. Fit / 50 / 75 / 100 / 150 /
   200 % plus `⌘+` / `⌘−`. View-level only: a `ZoomController`
   (`get/set/subscribe`) owned by `slides-view.tsx`; `refitCanvas`
   multiplies fit size by `userZoom`, clamped by `MAX_HOST_W`. Session-only,
   resets to Fit on reload. The editor stays zoom-unaware.
3. **Layout split-button** — right of `+ Slide ▾`. Reuses `showLayoutPicker`
   + `store.applyLayout` to change the *current* slide's layout from the
   toolbar (previously right-click only). See
   [`slides-themes-layouts-import.md`](slides-themes-layouts-import.md) for
   the placeholder-identity layout-change model it drives.
4. **Clear formatting** — text-edit section. New
   `clearInlineFormatting()` on the shared `TextFormattingEditor` interface;
   strips run styles only (not layout-defaulted block styles, so the result
   reads as "back to layout default"). Shared with the docs editor.
5. **Font size steppers (A↑ / A↓)** — text-edit and text-element states.
   Shared `text-size-stepper.tsx` bumps through Google-Slides `SIZE_STOPS`
   via the existing `applyStyle({ fontSize })`; box-level reuses a
   `setBoxFontSize` helper over every inline run.

The controls shipped as one PR in five independent commits. Full
per-control component map, capture/paste matrices, and risk table are
preserved in git history (this doc absorbed the former
`slides-toolbar-tier1.md`).

### Out-of-scope items (explicit)

The following came up during design and are **not** in this redesign:

- Menu bar (File / Edit / View / …) — separate spec.
- Slide transitions / animations — `slides.md` non-goal.
- Master slides / user-editable layouts — v2.
- Speaker-notes presenter view — v2.
- Flip H/V — v1.1; needs `frame.flipH/flipV` fields and overlay
  handle work.
- External-URL image embed — already deferred to v1.1 in `slides.md`.
- Find / replace, comments, version history — out of `slides.md` v1
  scope.

### Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Extracting docs text controls causes a docs regression. | Existing docs users see B/I/U/Color/Align break. | The extraction commit is a pure refactor — same external prop API, same DOM structure where possible. Existing docs visual tests act as the guard; any snapshot diff blocks the commit. Manual smoke of docs B/I/U/Color/Align in `pnpm dev` before continuing past the extraction commit. |
| `onTextEditingChange` / `onHistoryChange` events introduce render storms. | Editor performance regression, especially during active typing. | Both events are debounced at the source: text-edit fires once on enter/exit (not per keystroke); history fires once per `store.batch` boundary. The toolbar already re-renders on every selection change today, so the additional event volume is negligible. |
| State morphing disorients users mid-action (e.g. selecting a shape while a popover is open). | Lost popover, accidental clicks. | Global zones (Undo/Redo/Slide/Theme/Present) never move. Open popovers close on state transition (Radix default). Insert group hides only during text-edit, which the user explicitly entered — predictable. |
| `stroke.dash` Yorkie change conflicts with concurrent edits to old documents. | Schema desync. | Optional new field; readers default to `'solid'`. Older clients ignore it (Yorkie objects allow unknown keys). No migration script needed. |
| Single PR is large and risks a slow review. | Cycle time hurts. | The 13-task internal commit ordering keeps the diff reviewable commit-by-commit (model → API → extraction → scaffold → sections → wire-up). Each commit is independently green so reviewers can land partial reverts if needed. If review stalls, the natural fallback is to split at the docs-extraction commit (everything before lands as a refactor PR; everything after lands as the slides redesign PR). |
| Image insert button duplicates drag-drop / paste paths and silently diverges. | Three insert paths drift. | Centralise the upload + element-insert call in a single helper (`packages/frontend/src/app/slides/insert-image.ts`) used by all three paths. The button is a thin trigger that opens the file picker and calls the helper. |
