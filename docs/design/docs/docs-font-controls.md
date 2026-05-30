---
title: docs-font-controls
target-version: 0.2.0
---

# Docs Font Controls

## Summary

The Docs formatting toolbar currently has no controls for font family or
font size. The data model already supports both (`InlineStyle.fontFamily`
and `InlineStyle.fontSize`, applied via `editor.applyStyle`), and
`FontRegistry` already handles on-demand web-font loading — only the UI
is missing. Headings/Title/Subtitle in the Styles dropdown are the only
way users can change typography today, which forces them to redefine the
heading hierarchy whenever they want to vary body type.

This document specifies adding a curated font-family picker, a Google
Docs–style font-size control, a line-spacing dropdown, and a "Clear
formatting" button to the Docs toolbar, and threading the first two
into the header/footer slim toolbar. The new controls are built as
stateless components under `packages/frontend/src/components/text-formatting`
so they can be reused by the Slides text-editing toolbar later.

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

### Non-Goals

- A full Google Fonts–style "More fonts…" dialog with hundreds of
  families and search across the entire library. Curated list only in
  v1; library expansion is a follow-up document.
- User font upload.
- Per-character font preview on hover inside the family picker (each
  item still previews itself in its own font, but no live editor
  preview).
- Migrating the Slides text-editing toolbar onto the new shared
  components. The components are built reusable, but Slides adoption is
  scheduled in a separate PR after the Docs work lands.
- Changes to the Sheets toolbar.

## Proposal Details

### Shared text-formatting components

Four new files under
`packages/frontend/src/components/text-formatting/`:

| File                          | Responsibility                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `font-catalog.ts`             | Single source of truth for the curated font list (display name, CSS family, group, web-load flag). |
| `font-family-picker.tsx`      | Stateless dropdown. Props: `value: string \| undefined` (undefined = mixed), `onChange(family)`.   |
| `font-size-picker.tsx`        | Stateless `<input type="number">` + spinner buttons + preset dropdown. Props mirror above.         |
| `line-spacing-picker.tsx`     | Stateless dropdown of presets plus Custom input. Props: `value: number`, `onChange(lh)`.           |
| `clear-formatting-button.tsx` | Stateless button. Props: `onClick`.                                                                |

Each component is controlled: the toolbar owns the live value derived
from the editor and the component only renders + emits. No internal
state beyond transient input focus.

`font-catalog.ts` exports:

```ts
export interface FontEntry {
  /** Display label shown in the picker. */
  label: string;
  /** Canonical family name written to InlineStyle.fontFamily. */
  family: string;
  /** Group header in the picker. */
  group: 'Korean' | 'Sans-serif' | 'Serif' | 'Monospace';
  /**
   * Whether ensureFont() should be called before paint — true for web
   * fonts (Google Fonts CSS), false for fonts that are expected to be
   * present locally on most systems.
   */
  webFont: boolean;
}

export const FONT_CATALOG: readonly FontEntry[];
export const FONT_SIZE_PRESETS: readonly number[];
```

### Curated font list (14 entries)

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
for every entry and extends `SERIF_FONTS` with the new serif faces. Web
fonts get a single Google Fonts CSS `<link>` injected at app
bootstrap (subset = latin + korean), and actual font binaries are still
fetched lazily by `FontRegistry.ensureFont()` on first paint of a run
that requests them.

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

### Line spacing control

Dropdown presets: `1.0`, `1.15`, `1.5`, `2.0`, `Custom…`. Choosing a
preset writes `editor.applyBlockStyle({ lineHeight })`. Selecting
Custom… opens an inline numeric input that accepts 0.5–10.0 in 0.05
increments (line height is a unitless multiplier of the run's font size)
and commits on Enter / blur. The current value is rendered with a
checkmark in the dropdown when it matches a preset.

### Clear formatting

Calls a new `editor.clearFormatting()` method that, over the current
selection range, removes every inline-style attribute by mapping each
`InlineStyle` key to `undefined` and dispatching through the existing
`applyInlineStyle` path. Block-level styles (alignment, line height,
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
  color?: string | 'mixed';
  backgroundColor?: string | 'mixed';
  // ...
};

/**
 * Remove every inline style attribute from the current selection.
 * Block-level styles (alignment, line height, list kind/level, heading
 * level) are preserved.
 */
clearFormatting(): void;
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
2. App bootstrap injects a single Google Fonts CSS `<link>` with the
   subset of families flagged `webFont: true`, weight 400/700, subset
   `latin,korean`. This is a one-time CSS load, not a binary load.
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
- **Editor (Vitest in `packages/docs/src/`)**
  - `getRangeStyleSummary` returns uniform value, `'mixed'`, and
    `undefined` correctly across single-block and multi-block ranges
    and across table cells.
  - `clearFormatting()` removes every inline attribute on the range,
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
| Mixed selections silently apply the new family/size to runs that already had a different value.               | Match Google Docs: applying any value writes that value to every run in the selection. Mixed state shows empty in the input but a click still writes uniformly.                                             |
| `clearFormatting` accidentally collapses headings to paragraphs (regression vs. Google Docs).                 | Restrict the new method to `InlineStyle` keys only; block-type and block-style updates go through unrelated APIs and are not touched.                                                                       |
| Size input causes runaway CRDT writes if `onChange` fires on every keystroke.                                 | Commit only on Enter / blur / spinner / preset pick (specified above).                                                                                                                                      |
| 14 fonts is too small for some users; a future "More fonts" dialog would change the picker contract.          | Picker's `value` and `onChange` are already typed as `string`, not a closed union — the dialog can extend the catalog without breaking the contract.                                                        |
| Slides currently has its own `ThemedFontPicker` that resolves theme tokens to families; sharing risks a fork. | Keep `ThemedFontPicker` as-is. The new `FontFamilyPicker` is for "raw family" selection only. Slides will adopt it later for the box-edit case; theme-token UX stays separate.                              |
