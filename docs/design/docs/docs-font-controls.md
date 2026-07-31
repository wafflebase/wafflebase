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
`ensureFontLink(family, weights)` the first time a family is picked,
hovered, or previewed. Actual font binaries are still fetched lazily by
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
(single-block, cross-block, and table cell-range, mirroring
`getRangeStyleSummary`'s traversal and its style-defaults resolution) and
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
intersect the selection range — exiting early as 'mixed' once a key
sees a second distinct value. When there is no selection, it returns
the style of the inline at the cursor (same as the existing
`getSelectionStyle`).

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
