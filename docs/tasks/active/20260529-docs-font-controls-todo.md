# Docs font controls — toolbar additions

Design doc: [`docs/design/docs/docs-font-controls.md`](../../design/docs/docs-font-controls.md)

## Scope

Add font-family + font-size + line-spacing + clear-formatting controls to
the Docs formatting toolbar (body and header/footer contexts). Build the
controls as stateless components under
`packages/frontend/src/components/text-formatting/` so they can later be
reused by the Slides text-editing toolbar.

## Checklist

### Model + editor

- [ ] Extend `packages/docs/src/view/fonts.ts`: add the 14 catalog
      families to `FONT_MAP`, extend `SERIF_FONTS`.
- [ ] Add `editor.getRangeStyleSummary()` to `EditorAPI` in
      `packages/docs/src/view/editor.ts` (uniform value | `'mixed'` |
      undefined per key).
- [ ] Add `editor.clearFormatting()` to `EditorAPI`. Removes every
      inline attribute on the selection range; leaves block style
      untouched.
- [ ] Unit tests for `getRangeStyleSummary` (single-block, multi-block,
      table-cell ranges).
- [ ] Unit tests for `clearFormatting` (removes inline attrs, preserves
      heading/list/alignment/lineHeight).

### Shared components

- [ ] `font-catalog.ts` — `FONT_CATALOG` (14 entries) + `FONT_SIZE_PRESETS`.
- [ ] `font-family-picker.tsx` — controlled dropdown with group
      headers, item previews each in its own family, empty state on
      mixed.
- [ ] `font-size-picker.tsx` — `−` / input / `+` / preset chevron.
      Commit only on Enter / blur / spinner / preset. Clamp 1–400.
- [ ] `line-spacing-picker.tsx` — preset dropdown + Custom inline
      input.
- [ ] `clear-formatting-button.tsx` — simple button.
- [ ] Unit tests per component (render, onChange payload, mixed state).

### Web-font loading

- [ ] App bootstrap: inject one Google Fonts CSS `<link>` for the
      `webFont: true` entries (subset `latin,korean`, weights 400/700).
      Wire it once at frontend root, not per editor mount.
- [ ] Toolbar prefetch: call `FontRegistry.ensureFont(family)` on
      family-picker item hover so the binary is ready before commit.

### Toolbar wiring — body context

- [ ] Insert `FontFamilyPicker` + `FontSizePicker` between Styles and
      B/I/U in `docs-formatting-toolbar.tsx`.
- [ ] Insert `LineSpacingPicker` in the Paragraph group (between Align
      and Bulleted).
- [ ] Insert `ClearFormattingButton` between Paragraph and Export
      groups.
- [ ] Hook all controls to `editor.getRangeStyleSummary()` /
      `editor.getBlockStyle()` on the toolbar's existing refresh path.
- [ ] Mobile body: family + size inline (no spinner buttons), line
      spacing + clear formatting in the overflow menu.

### Toolbar wiring — header / footer context

- [ ] Add family + size to the slim header/footer toolbar. Same shared
      components, no line spacing or clear formatting in this context.

### Integration tests

- [ ] Yorkie-attached test: applying fontFamily / fontSize survives
      detach + reattach.
- [ ] Yorkie-attached test: `clearFormatting()` actually removes the
      attributes from the underlying Tree (no zombie attrs).

### Pre-merge

- [ ] `pnpm verify:fast` green.
- [ ] Self code review over branch diff
      (`superpowers:requesting-code-review` or `/code-review`).
- [ ] Manual smoke in `pnpm dev`: pick each catalog family on a
      mixed-language paragraph; verify mixed-selection empty state;
      verify clear-formatting preserves headings.
- [ ] Lessons captured in `20260529-docs-font-controls-lessons.md`.
- [ ] Archive and reindex: `pnpm tasks:archive && pnpm tasks:index`.

## Review

(Filled in after implementation.)
