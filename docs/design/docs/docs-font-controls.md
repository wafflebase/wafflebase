---
title: docs-font-controls
target-version: 0.2.0
---

# Docs Font Controls

## Summary

The Docs formatting toolbar ships a font-family picker, a Google
Docs–style font-size control, a line-spacing dropdown, and a "Clear
formatting" action. The data model already supported the underlying
inline styles (`InlineStyle.fontFamily` and `InlineStyle.fontSize`,
applied via `editor.applyStyle`), and `FontRegistry` already handled
on-demand web-font loading — this work added the missing UI.

The controls are built as stateless components under
`packages/frontend/src/components/text-formatting` and are shared with
the Slides text-editing toolbar. The two typography controls (family +
size) are also threaded into the header/footer slim toolbar.

> **Status:** shipped. The originally-scoped v1 has since been extended
> well past this doc — the curated catalog grew into a generated
> ~105-entry catalog plus a searchable "More fonts…" dialog backed by
> the full `google/fonts`-derived library (see
> [slides-fonts.md](../slides/slides-fonts.md)). The sections below
> describe the design as first built; where the shipped surface has
> moved on, that is called out inline.

### Goals

- Users can change the font family of a selection from a curated list of
  14 fonts (Korean + Latin sans/serif/mono) that covers everyday writing
  in both languages without a network round-trip for the common cases.
- Users can change the font size of a selection via a Google
  Docs–style control: numeric input, `±` spinner, and a preset dropdown
  (8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96 pt).
- Users can change the line spacing of paragraphs via a dropdown of
  presets (1.0 / 1.15 / 1.5 / 2.0) plus a Custom input.
- Users can clear all inline formatting (bold, italic, color, font
  family, font size, …) on a selection in one click, without touching
  block-level styles (alignment, line height, list kind).
- The header/footer slim toolbar gains the font-family and font-size
  controls so typography is editable from those contexts too.
- All controls reflect the current selection: a single resolved value
  when uniform, an empty / placeholder state when mixed.

### Non-Goals (as originally scoped)

- A full Google Fonts–style "More fonts…" dialog with hundreds of
  families and search across the entire library. *(Since shipped: the
  follow-up library expansion landed a searchable "More fonts…" dialog
  plus the full `google/fonts`-derived catalog and lazy loader —
  `more-fonts-dialog.tsx`, `more-fonts-filter.ts`, `font-catalog.full.ts`,
  `font-catalog-full-loader.ts`. See [slides-fonts.md](../slides/slides-fonts.md).)*
- User font upload.
- Per-character font preview on hover inside the family picker (each
  item still previews itself in its own font, but no live editor
  preview).
- Migrating the Slides text-editing toolbar onto the new shared
  components. *(Since shipped: the Slides text-edit toolbar now renders
  the same `FontFamilyPicker`/`FontSizePicker` from
  `@/components/text-formatting` — see
  `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx`.)*
- Changes to the Sheets toolbar.

## Proposal Details

### Shared text-formatting components

Four new files under
`packages/frontend/src/components/text-formatting/`:

| File                          | Responsibility                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `font-catalog.ts`             | Font-picker contract + size/line-spacing presets + the `ensureFontLink` lazy loader; re-exports the catalog from `font-catalog.data.ts`. |
| `font-family-picker.tsx`      | Stateless dropdown. Props: `value: string \| undefined` (undefined = mixed), `onChange(family)`.   |
| `font-size-picker.tsx`        | Stateless `<input type="number">` + spinner buttons + preset dropdown. Props mirror above.         |
| `line-spacing-picker.tsx`     | Stateless dropdown of presets plus Custom input. Props: `value: number`, `onChange(lh)`.           |
| `clear-formatting-button.tsx` | Stateless button. Props: `onClick`.                                                                |

> The curated list was originally hardcoded in `font-catalog.ts`. It now
> lives in a generated `font-catalog.data.ts` (~105 entries built from
> `google/fonts` metadata by `scripts/build-font-catalog.mjs`), which
> `font-catalog.ts` re-exports as `FONT_CATALOG`.

Each component is controlled: the toolbar owns the live value derived
from the editor and the component only renders + emits. No internal
state beyond transient input focus.

`font-catalog.ts` exports:

```ts
export type FontGroup =
  | 'Korean'
  | 'Sans-serif'
  | 'Serif'
  | 'Monospace'
  | 'Display'
  | 'Handwriting';

export interface FontEntry {
  /** Display label shown in the picker. */
  label: string;
  /** Canonical family name written to InlineStyle.fontFamily. */
  family: string;
  /** Section header in the picker. */
  group: FontGroup;
  /**
   * Whether the family is served from Google Fonts (needs a CSS link +
   * FontRegistry.ensureFont() before paint) vs a local/system face.
   */
  webFont: boolean;
  /** Google Fonts `wght@…` axis values to request. Defaults to '400;700'. */
  weights?: string;
  /** Open-source license (OFL / APACHE2 / UFL) for export-embed notices. */
  license?: 'OFL' | 'APACHE2' | 'UFL';
  /** Google Fonts subsets (scripts) the family covers. */
  scripts?: string[];
  /**
   * Loaded eagerly in the bootstrap CSS link (`true`) vs on demand via
   * `ensureFontLink` (absent/`false`). Only the small pre-catalog set is
   * eager so the bootstrap request stays small as the catalog grows.
   */
  eager?: boolean;
}

export const FONT_CATALOG: readonly FontEntry[];
export const FONT_SIZE_PRESETS: readonly number[];
```

The `Display` and `Handwriting` groups, along with the `weights` /
`license` / `scripts` / `eager` fields, arrived with the generated
catalog; the original spec listed only the first four groups and the
first three fields.

### Curated font list (original v1 — 14 entries)

The list below is the set shipped in the first version. It has since been
superseded by the generated ~105-entry `font-catalog.data.ts` (which adds
`Display` and `Handwriting` groups and dozens of Google Fonts web faces).

| Group      | Family               | Source         |
| ---------- | -------------------- | -------------- |
| Korean     | 맑은 고딕            | Local (Win/macOS bundles) |
| Korean     | 바탕                 | Local          |
| Korean     | Noto Sans KR         | Google Fonts   |
| Korean     | Noto Serif KR        | Google Fonts   |
| Korean     | 나눔고딕             | Google Fonts (Nanum Gothic) |
| Sans-serif | Arial                | Local          |
| Sans-serif | Helvetica            | Local          |
| Sans-serif | Roboto               | Google Fonts   |
| Sans-serif | Tahoma               | Local          |
| Sans-serif | Verdana              | Local          |
| Serif      | Times New Roman      | Local          |
| Serif      | Georgia              | Local          |
| Serif      | Cambria              | Local          |
| Monospace  | Courier New          | Local          |

`packages/docs/src/view/fonts.ts` extends `FONT_MAP` with fallback chains
for every entry and extends `SERIF_FONTS` with the new serif faces. Only
the small `eager` subset of web fonts is requested in the bootstrap
Google Fonts CSS `<link>`; the long tail lazy-loads its CSS via
`ensureFontLink(family, weights)` the first time a family is picked or
hovered. *Previewing* a picker row takes the cheaper path —
`ensurePreviewFontLink(family, text, weights)`, which requests only the
glyphs that row paints (css2 `&text=`) at a single weight, and no-ops for
a family some stylesheet already loads in full. A subset face carries no
`unicode-range`, so it is that family's face for the whole document while
connected — the preview surfaces therefore call `releasePreviewFontLinks()`
when their list goes away and before applying a pick. See
[slides-fonts.md](../slides/slides-fonts.md) for the full loading model.
Actual font binaries are still fetched lazily by
`FontRegistry.ensureFont()` on first paint of a run that requests them.

### Font size control

`FONT_SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96]`.

Layout (Google Docs parity):

```
[−] [ 11 ] [+]  ▾
```

- The input accepts integers 1–400. Out-of-range values clamp on blur.
- `+` and `−` step by 1 pt and respect the clamp.
- The chevron opens the preset dropdown; clicking a preset writes that
  value.
- Empty selection / mixed values render an empty input with placeholder
  text.

The control emits `onChange(size: number)` only on commit (Enter / blur
/ spinner click / preset pick), not on every keystroke. This avoids
churning the CRDT on partial typing like "1" → "11".

#### `±` on a mixed-size selection steps each run relative to its own size

Typed value / Enter / preset pick still write one absolute size to every
run in the selection (see the Risks table). The `±` spinner is different:
on a selection that mixes multiple sizes, `value` is `undefined` (see
"Mixed selections" above) so there is no single number to step from — `±`
instead steps **each run relative to its own current size** (an 11pt run
becomes 12pt, a 36pt run becomes 37pt, in the same click), matching Google
Docs. This addresses issue #343.

The picker gains an optional `onStepMixed?: (delta: number) => void` prop,
called by `±` only in the mixed case (`value === undefined && draft ===
""`); `onChange` is unchanged. `value === undefined` reaching the picker
means a true mixed selection ONLY, never "unset": callers
(`useResolvedFontSize`, and `docs-formatting-toolbar.tsx`'s `sizeValue`)
already resolve an *unset* run's `fontSize` to the docs default
(`summary.fontSize === 'mixed' ? undefined : (summary.fontSize ??
DEFAULT_INLINE_STYLE.fontSize)`) before it reaches the picker. So a
collapsed caret with no explicit size is always a concrete number here
and never trips `onStepMixed` — it keeps stepping that resolved default
through the existing single-value path. Callers wire the mixed case to
the new `editor.stepSelectionFontSize(delta, clamp)` (see below), which
does the per-run work: it walks the inline runs intersecting the selection
through the shared `visitStyledRunsInRange` walk (see *The shared range
traversal* below) — literally the same traversal and style-defaults resolution
`getRangeStyleSummary` and the keyboard toggles use — and
applies `clamp(effectiveSize + delta)` to each run's own sub-range via
`store.applyStyle`. `clamp` stays a caller-supplied function (`FONT_SIZE_MIN`
/ `FONT_SIZE_MAX` live in the frontend's `font-catalog.ts`, not in the docs
engine package) — the docs package has no opinion on legal size bounds.

### Line spacing control

Dropdown presets: `1.0`, `1.15`, `1.5`, `2.0`, `Custom…`. Choosing a
preset writes `editor.applyBlockStyle({ lineHeight })`. Selecting
Custom… opens an inline numeric input that accepts 0.5–10.0 in 0.05
increments (line height is a unitless multiplier of the run's font size)
and commits on Enter / blur. The current value is rendered with a
checkmark in the dropdown when it matches a preset.

### Clear formatting

Calls `editor.clearInlineFormatting()`, which over the current selection
range removes every inline-style attribute by dispatching the
`CLEAR_INLINE_STYLE` payload through the existing `applyStyle` path
(mapping each `InlineStyle` key to `undefined`). Block-level styles (alignment, line height,
list kind, list level, heading level) are intentionally preserved —
this matches Google Docs' behavior and avoids accidentally collapsing a
heading into a paragraph.

Per the existing Yorkie store bug fix
([20260526-docs-unlink-href]), `applyInlineStyle` already removes
attributes when their value is explicitly `undefined`, so no Yorkie
plumbing change is needed.

### Color reset — "cleared" is an absent key, and `''` means unset

The text-color and highlight pickers each carry a **Reset** entry, and it
follows the same rule as Clear formatting: reset calls `applyStyle` with the
key mapped to `undefined`, so the attribute is *removed*. It must never
**store** `''` (a store may still be *handed* one — see the write-path
subsection below — but folds it into this same removal rather than keeping
it). An empty string is not a color — `ctx.fillStyle = ''` is an invalid
assignment the canvas silently ignores, leaving the run painted in whatever
the previous pass set (on a selected run, the selection fill). That was the
visible bug in issue #728.

Documents written before this rule, and decks arriving through PPTX/DOCX
import or the content `PUT`, still hold the `''`. So the render side treats it
as unset rather than trying to migrate stored data: every paint-time read of a
stored color goes through `resolveStoredColor`
(`packages/docs/src/model/color.ts`), which collapses an empty color to
`undefined` on *both* sides of the theme resolver and returns `undefined` when
nothing is paintable, leaving each caller to apply its own fallback —
`resolveStoredColor(resolve, c) ?? theme.defaultColor`. Collapsing it *before*
the resolver is what makes a cleared run inherit the deck theme's text color
on a themed slide instead of the docs near-black default. Both spellings of
empty count: the bare `''` and the `{ kind: 'srgb', value: '' }` wrapper a
theme-color migration or PPTX import can produce.

The same convention holds at the export sinks: `toRgbHexColor` maps an empty
or unusable color to "no color child" rather than an empty OOXML attribute
value (see [docs-docx-import-export.md](docs-docx-import-export.md) and
[slides-pptx-export.md](../slides/slides-pptx-export.md)).

#### `''` on the write path is a clear, not a value

Fixing the pickers is not enough on its own, because they are not the only
writers. A caller the toolbar does not own — the slides text-box editor, the
pending-inline-style path, a batched `applyStyles`, the content `PUT` — can
still hand a store `{ backgroundColor: '' }`, and a picker that regresses to
the old spelling would silently reintroduce the bug (issue #793). So `''` on
a color key is a **model-layer contract**, enforced at the store boundary
rather than at each call site: it means *clear this key*, and is folded into
the explicitly-`undefined` form above — the one removal path — before any
store writes it.

Two exported helpers in `packages/docs/src/model/types.ts` do the folding,
and every store write goes through one of them:

| Helper | Keys | Wired into |
| ------ | ---- | ---------- |
| `normalizeStyleClears` | `color`, `backgroundColor` | `store/block-helpers.applyInlineStyle` (memory + cache) and `YorkieDocStore.applyStyleInTree` (the Yorkie tree, shared by `applyStyle` / `applyStyles`) |
| `normalizeCellStyleClears` | `backgroundColor` | `MemDocStore.applyCellStyle` and `YorkieDocStore.applyCellStyle` |

This adds no second way to clear an attribute: the helpers only rewrite the
sentinel into the existing `undefined` key, which `removedInlineStyleAttrs` /
`removedCellStyleAttrs` then turn into the `removeNodeStyle` removal that
`undefined` has always taken.

Merging `''` verbatim instead would leave a dead value behind: it stops
painting (`''` is falsy, and `resolveStoredColor` normalizes it away) but
never compares equal to an unset color, so `normalizeInlines` can no longer
merge the run back into its neighbours, and anything reading "is there a
highlight?" from key presence still sees one. In the Yorkie stores the damage
is worse, because `styleByPath` only *merges*: a cleared key must additionally
be dropped, or the old color survives in the CRDT while the local cache looks
cleared — a peer or a reload still sees the highlight.

Out of scope: boolean style keys (`bold: false` vs cleared — issue #749), and
migrating `''` values already stored in existing documents. Those are
normalized on write from this fix forward, and tolerated on read by
`resolveStoredColor` / `toRgbHexColor` above.

### Storage invariant: a boolean turned off is *cleared*, not stored as `false`

Clearing is not only how "Clear formatting" expresses itself — since
issue #749 it is how **every** boolean toggle-off is stored. The
invariant, which holds across the docs engine, the slides text-box
editor (which drives the same `Doc`), and the Yorkie store:

> A boolean inline key the user turns off is removed from the run's
> style — **unless some layer under the run style supplies it truthy**,
> where an explicit `false` is the override that makes the toggle
> visible at all.

There are exactly two such under-layers, and both are exceptions:

1. **The block's named style** — Heading 6 is italic, so `italic:
   false` is kept on a Heading 6 run.
2. **The hyperlink default** — `renderRun` underlines an `href` run
   whose `underline` is *absent* (`view/paint-layout.ts`), so on a link
   the absent key means underlined and `underline: false` is kept.
   Decided per slice: if any run the write touches is a link, the
   slice's `underline: false` survives. A dead flag on the plain runs
   beside a link is strictly better than an underline that cannot be
   turned off.

Exception 1 is *conditional on the named-style layer under the run*, so
it can go stale three ways, and each one sweeps:

- **The block's type changes** — the `italic: false` a Heading 6 run
  legitimately stores is a dead flag the moment the block becomes a
  paragraph. `Doc.setBlockType` re-normalises the block it just retyped
  (`dropStaleStyleOff`).
- **The style registry changes under an untouched run** — redefining,
  resetting, or replacing the document's styles moves the layer without
  the run being edited. Every such entry point (`setDocStyles`,
  `updateStyleToMatch`, `resetNamedStyle`, `resetAllNamedStyles`) runs
  `Doc.dropStaleStyleOffAll` over the whole document — body, header,
  footer, and every nested table cell — via `afterNamedStyleChange`.
- **A run is pasted into a differently-styled block** — the internal
  clipboard is the only paste payload that preserves an explicit
  `false` (the HTML and markdown parsers only ever write `true`), so
  that branch sweeps too.

Both sweeps write through `DocStore.applyStyles`, so however many runs
one strands it costs a single write. That write is still separate from
the action that caused it: `YorkieDocStore.snapshot()` is a no-op
because Yorkie takes its undo units from `doc.update()`, so under the
collaborative store a redefinition that strands a flag takes two Cmd+Z,
the first of which looks like it did nothing. Folding them needs a
`DocStore.batch()` seam that does not exist yet — the slides store has
one ([slides-native-undo.md](../slides/slides-native-undo.md)). That
cost is also why **block merge is not a fourth sweep site**: Backspace
at the start of a Heading 6 does strand the flag, but paying two Cmd+Z
on the hottest editing path is the worse trade, so `Doc.mergeBlocks`
knowingly leaves it (pinned by a test) until the seam lands.

Exception 2 needs no sweep — its under-layer is the run's own `href`,
which none of the three can remove.

A stored `false` is a dead flag. `inlineStylesEqual` compares strictly,
so `false !== undefined` and `normalizeInlines` can never re-merge the
run with the identical-looking neighbour it was split from — bold-then-
unbold left the paragraph permanently fragmented. It also pins the run
against a later redefinition of the block's named style, the same
lazy-cascade hazard `getSelectionStyleImpl` documents.

Three pieces implement it, none of which any caller has to know about:

- `Doc.applyInlineStyle` / `applyInlineStyleToCells` demote a boolean
  `false` to `undefined` (`styleOffAsClear`), consulting
  `resolveStyleInline` for the named-style exception. Every toggle
  caller — the keyboard `toggleStyle`, both docs toolbars, the slides
  text box, the pending-inline-style flush — funnels through these two,
  so the demotion happens once.
- `store/block-helpers.applyInlineStyle` merges a patch such that **a
  key set to `undefined` deletes the key** rather than storing a
  phantom `undefined` entry. This is the merge semantic
  `CLEAR_INLINE_STYLE` and the toggle-off path share.
- `YorkieDocStore` already turned an `undefined` key into
  `removeStyleByPath` (see above), so the CRDT attribute is dropped
  too. Undo is unaffected: Yorkie's `TreeStyleOperation` builds the
  reverse of a remove from the attributes it displaced. The tree write
  sends *only* the patch's own attributes — re-asserting the node's
  existing ones would make every toggle-off a full rewrite that
  clobbers a concurrent remote change to an unrelated attribute.

Two consumers of the old "off is stored as `false`" shape had to change
with it:

- **The format painter** (Cmd+Shift+C / Cmd+Alt+V) applies its buffer as
  a merge patch, so it used to get "remove bold from the target" for
  free from the source run's `bold: false`. It now bakes every boolean
  explicitly when copying (`captureFormatAtCursor`), reading the
  *effective* value so painting from an italic Heading 6 makes the
  target italic rather than clearing it.
- **`normalizeInlines`** merges any two adjacent runs whose styles
  compare equal, and clearing a key is exactly what can make two runs
  equal. Structural inlines (images, page numbers) are now excluded
  from that merge, matching `isStructuralInline`'s contract: two
  *identical* images are still two images, and concatenating them
  loses one. `Doc.mergeCells` had its own copy of the merge rule; it
  now calls `normalizeInlines`, so the table-merge path cannot drift
  from the exception again.

Out of scope: `false` flags already stored by older builds are left
alone — they resolve identically and are cleared the next time the user
toggles that key. Non-boolean keys (colors, font size) are untouched;
only `CLEAR_INLINE_STYLE` clears those.

### Editor API additions

Two additions to the `EditorAPI` surface exposed by
`packages/docs/src/view/editor.ts`:

```ts
/**
 * Summary of the inline styles across the current selection. For each
 * key, returns the resolved value when uniform across the selection,
 * the string literal 'mixed' when at least two distinct values exist,
 * or undefined when the property is unset throughout.
 */
getRangeStyleSummary(): {
  bold?: boolean | 'mixed';
  italic?: boolean | 'mixed';
  underline?: boolean | 'mixed';
  strikethrough?: boolean | 'mixed';
  fontFamily?: string | 'mixed';
  fontSize?: number | 'mixed';
  color?: InlineStyle['color'] | 'mixed';
  backgroundColor?: InlineStyle['backgroundColor'] | 'mixed';
  superscript?: boolean | 'mixed';
  subscript?: boolean | 'mixed';
};

/**
 * Remove every inline style attribute from the current selection.
 * Block-level styles (alignment, line height, list kind/level, heading
 * level) are preserved.
 */
clearInlineFormatting(): void;

/**
 * Step the font size of every inline run intersecting the current
 * selection by `delta`, relative to each run's OWN effective size —
 * not a single absolute value. `clamp` is caller-supplied (the docs
 * engine has no opinion on legal size bounds; the frontend passes
 * FONT_SIZE_MIN/MAX). A collapsed caret has only one "current" value,
 * so it steps that value directly instead (equivalent to the existing
 * single-value `applyStyle({ fontSize })` path).
 */
stepSelectionFontSize(delta: number, clamp: (n: number) => number): void;
```

`getRangeStyleSummary` is implemented by walking the inline runs that
intersect the selection range — a key with two or more distinct values
reads as 'mixed'. When there is no selection, it returns
the style of the inline at the cursor (same as the existing
`getSelectionStyle`).

### The shared range traversal (`model/range-slices.ts`, `model/range-runs.ts`)

Reading a range's formatting and writing it must agree on *which runs the
range covers* — a toggle that decides "already bold" from a different set
of runs than the one it then styles is how issue #715 left a style
impossible to re-apply. Two copies of the dispatch kept in sync would only
postpone that; instead there is **one traversal, in the model**, and both
sides drive it:

```
                       visitRangeSlices(doc, range, visit)      model/range-slices.ts
                        (blockId, from, to) per block slice
                          ↑                            ↑
     Doc.applyInlineStyle │ (write)            (read) │ visitStyledRunsInRange
     → store.applyStyle   │                           │ → per-run effective style
                                                      │   model/range-runs.ts
                                                      ├── EditorAPI.getRangeStyleSummary
                                                      ├── stepSelectionFontSize (both editors)
                                                      ├── TextBoxEditorAPI.getRangeStyleSummary
                                                      └── TextEditor.isStyleOnInSelection
```

`visitRangeSlices` answers *which text*; `visitStyledRunsInRange` adds *what
style* on top of the same slices. Because the write is a visitor over the
identical traversal, read/write agreement is structural rather than
maintained. A cell rectangle (`tableCellRange`) is a selection shape of its
own, so it has a sibling — `visitCellRectangleSlices`, driven by the read and
by `Doc.applyInlineStyleToCells` (which both editors' `applyStyleToCellRange`
now delegates to).

The dispatch is: same block → same cell; cross-block inside one cell;
cross-block at top level with cell endpoints normalized to their parent table
block. Four consequences are load-bearing:

- **Header/footer cells resolve.** Parentage comes from `doc.blockParentMap`
  (the merged body + header + footer map), not the body-only
  `layout.blockParentMap` the pre-#715 summary used, which returned an empty
  summary for a header-cell selection.
- **A table caught in a cross-block selection is covered whole.**
- **An endpoint with no context-block index is a no-op** — an endpoint inside
  a *nested* table (whose parent table is not itself a context block), or a
  parentage entry stale since the last layout. The read reported nothing for
  those ranges while the write indexed `contextBlocks[-1]` and threw a
  `TypeError`; sharing the traversal makes both sides skip it. Nested table
  content is therefore neither read nor written — a styling gap recorded in
  [docs-nested-tables.md](tables/docs-nested-tables.md#known-gap-inline-styling-does-not-descend),
  and one that a single traversal would close for the read and the write
  together.
- **Every run is reported with its effective style** — the block's named
  style inline defaults (`resolveStyleInline`) layered under the run's
  explicit style — so a read sees what the renderer paints. A built-in
  Heading 6 reads as italic even though no run carries the flag. This holds
  for a collapsed caret as well as a range, in the full editor and the text
  box alike. Reads layer defaults; *writes* (pending style, style
  application) keep storing raw runs, so redefining a named style still
  cascades.

Zero-width runs are skipped: they carry no style and would otherwise make
every empty block read as 'mixed'.

### The shared caret walk (`model/caret-style.ts`)

A *collapsed caret* is the other half of the same question, and it used to
be hand-copied into `view/editor.ts`, `view/text-editor.ts` and
`view/text-box-editor.ts`. The copies drifted, which is how #715 reached the
text box: its caret read returned the raw run style while its range summary
reported the effective one, so the toolbar saw "not italic" inside a
Heading 6 and applying italic was a permanent visual no-op. The walk now
lives in the model next to the range traversal and every editor delegates:

```
                  caretInlineStyle(doc, position, withStyleDefaults)
                  caretStyleDefaults(doc, position)     model/caret-style.ts
                    ↑                ↑                    ↑
   editor.ts        │  text-editor.ts│    text-box-editor.ts
   getSelectionStyleImpl / styleAtCaret   getStyleAtCursor / styleDefaultsAtCursor
                                          caretStyle(withStyleDefaults)
```

`withStyleDefaults` is the one axis the callers differ on, and it maps onto
the read/write split above: **true** to present or to decide (toolbar
pickers, add-vs-remove), **false** whenever the result is *stored* (pending
style, format painter), because baking a named-style default into a run
breaks the lazy cascade when the style is later redefined.

### One write path per editor

`Doc.applyInlineStyle` ignores `range.tableCellRange` by contract: handed a
rectangle it normalizes the endpoints to the parent *table* block and
rewrites every cell in the table. Routing that shape to
`Doc.applyInlineStyleToCells` is therefore the caller's job, and every
keyboard style command in `view/text-editor.ts` — the B/I/U/S toggles, clear
formatting (Cmd+\\) and the format painter's apply (Cmd+Alt+V) — goes through
one private `applyStyleToSelection(range, style)` that does the routing (and
the matching dirty-marking) once. Clear formatting and the format painter
previously called `applyInlineStyle` directly and so restyled the whole
table; `view/editor.ts`'s `applyStyleImpl` is the toolbar's equivalent single
path.

**The repaint is derived, not restated.** Each write site used to recompute
the blocks to mark dirty by hand: parent-table lookup for a cell endpoint,
otherwise `Doc.getBlockIndex(anchor)`…`getBlockIndex(focus)` fed back into
`doc.document.blocks`. Those indices count within the *context* region (body /
header / footer) while that array is the body's, so editing a header longer
than the body dereferenced `undefined.id` and threw — killing the repaint the
write had just earned. `dirtyBlockIdsForRange(doc, range)`
(`model/range-slices.ts`) replaces all three copies by folding
`visitRangeSlices` down to the top-level block that paints each visited slice.
Repaint therefore covers exactly what was written, for the same structural
reason the read covers exactly what the write touches — no index arithmetic,
and no region to get wrong. Cell rectangles keep marking the table block they
route to.

### Toolbar layout — body context

Final order in `docs-formatting-toolbar.tsx`, body context:

```
[Undo Redo]
| [Styles ▾]
| [FontFamily ▾] [− 11 + ▾]
| [B I U] [TextColor ▾ Highlight ▾ Link]
| [Image Table]
| [Align ▾ LineSpacing ▾ Bulleted Numbered Indent− Indent+]
| [Clear formatting]
| [Export ▾]
```

Mobile body context: the family + size controls render inline between
Styles and B/I/U (kept compact via the size input alone, no spinner
buttons on narrow viewports). Line spacing and Clear formatting move
into the mobile overflow menu.

### Toolbar layout — header / footer context

The slim toolbar gains family + size:

```
Header
| [FontFamily ▾] [− 11 + ▾]
| [B I U] [TextColor ▾ Highlight ▾]
| [Align ▾]
| [Page number]
```

No line-spacing or clear-formatting in header/footer — page chrome is
not where users restructure typography.

### Selection state synchronization

The toolbar already subscribes to editor state changes (selection move,
content edit) to refresh button toggle states. The new controls hook
into the same subscription and call `editor.getRangeStyleSummary()` on
every refresh. The summary's `'mixed'` sentinel maps to an empty value
in each picker.

For line spacing, the toolbar reads the block style of the block
containing the selection's anchor; mixed line heights across multiple
blocks render the dropdown trigger with an em dash.

### Web-font loading flow

1. Toolbar mounts; `font-catalog.ts` is statically imported.
2. App bootstrap injects a single Google Fonts CSS `<link>` (built by
   `buildGoogleFontsHref` in
   `packages/frontend/src/components/text-formatting/font-catalog.ts`)
   with only the families flagged `eager: true` (the small pre-catalog
   set), each at its own `weights`. This is a one-time CSS load, not a
   binary load. Non-eager web families load on demand via
   `ensureFontLink(family, weights)`.
3. When the user picks a web font, the toolbar calls
   `editor.getStore().fonts.ensureFont(family)` (via the existing
   `FontRegistry`) before dispatching `applyStyle`. The applyStyle
   itself doesn't wait — the registry's `onFontLoaded` listener kicks
   off a re-render once the binary arrives.
4. Pasting external content that references unknown families still
   falls back via `resolveFontFamily()` exactly as today.

### Testing

- **Unit (Vitest, `.test.ts` in `tests/components/text-formatting/`)**
  - Each picker renders the resolved value, fires `onChange` with the
    expected payload, and shows an empty state when value is undefined.
  - `font-size-picker` clamps to 1–400, only commits on Enter / blur /
    spinner / preset, rejects non-numeric input.
  - `±` on a mixed selection calls `onStepMixed(delta)` instead of
    `onChange` (issue #343 regression — previously a no-op after PR #358,
    before that a collapse to `FONT_SIZE_MIN`).
- **Editor (Vitest in `packages/docs/src/`)**
  - `getRangeStyleSummary` returns uniform value, `'mixed'`, and
    `undefined` correctly across single-block and multi-block ranges
    and across table cells.
  - `stepSelectionFontSize` applies `clamp(effectiveSize + delta)` per
    run across a mixed-size single-block selection, a cross-block
    selection, and a table cell-range; clamps at the bounds; leaves
    runs outside the selection untouched. `clamp` is a small test-local
    function here (mirroring `FONT_SIZE_MIN`/`MAX`'s values) — these
    tests live in `packages/docs/src/`, which has no dependency on the
    frontend package, so they must not import `font-catalog.ts`.
    `FONT_SIZE_MIN`/`MAX` wiring itself is a frontend-test concern (see
    the Unit bullet above).
  - `clearInlineFormatting()` removes every inline attribute on the range,
    leaves block-level style untouched, and rebuilds the rendered
    layout (no stale style on remeasure).
- **Integration (`docs-tree-attached.e2e-spec.ts` pattern)**
  - Apply font family / font size / line spacing on an attached Yorkie
    document, detach + reattach, assert the new style survives.
  - Apply clear-formatting and assert the removed attributes are gone
    from the underlying Tree node (no zombie attrs, mirroring the
    [20260526-docs-unlink-href] regression test).

### Risks and Mitigation

| Risk                                                                                                          | Mitigation                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy web-font load causes layout shift on first paint of a Noto/Roboto run.                                   | `FontRegistry` already triggers a re-render on load; pagination recomputes only the affected blocks via `markDirty`. The picker also prefetches the family on hover so most picks are ready before commit. |
| Mixed selections silently apply the new family/size to runs that already had a different value.               | Match Google Docs: a typed value / Enter / preset pick writes that value to every run in the selection. The `±` spinner is the exception — it steps each run relative to its own size instead (see "`±` on a mixed-size selection" above; issue #343). Mixed state renders an empty input only while the local draft is empty (`draft === ""`); once the user starts typing an absolute value, that draft stays visible until commit, regardless of which path (`±` or typed value) the input is headed toward.                                             |
| `clearInlineFormatting` accidentally collapses headings to paragraphs (regression vs. Google Docs).           | Restrict the new method to `InlineStyle` keys only; block-type and block-style updates go through unrelated APIs and are not touched.                                                                       |
| Size input causes runaway CRDT writes if `onChange` fires on every keystroke.                                 | Commit only on Enter / blur / spinner / preset pick (specified above).                                                                                                                                      |
| 14 fonts is too small for some users; a future "More fonts" dialog would change the picker contract.          | Picker's `value` and `onChange` are already typed as `string`, not a closed union — the dialog can extend the catalog without breaking the contract.                                                        |
| Slides currently has its own `ThemedFontPicker` that resolves theme tokens to families; sharing risks a fork. | Keep `ThemedFontPicker` as-is. The new `FontFamilyPicker` is for "raw family" selection only. Slides will adopt it later for the box-edit case; theme-token UX stays separate.                              |
