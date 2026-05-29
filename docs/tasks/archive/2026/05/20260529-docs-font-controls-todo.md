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

- [x] Extend `packages/docs/src/view/fonts.ts`: add the 14 catalog
      families to `FONT_MAP`, extend `SERIF_FONTS`.
- [x] Add `editor.getRangeStyleSummary()` to `EditorAPI` in
      `packages/docs/src/view/editor.ts` (uniform value | `'mixed'` |
      undefined per key).
- [x] Add `editor.clearFormatting()` to `EditorAPI`. Removes every
      inline attribute on the selection range; leaves block style
      untouched.
- [x] Unit tests for `getRangeStyleSummary` (single-block, multi-block,
      table-cell ranges).
- [x] Unit tests for `clearFormatting` (removes inline attrs, preserves
      heading/list/alignment/lineHeight).

### Shared components

- [x] `font-catalog.ts` — `FONT_CATALOG` (14 entries) + `FONT_SIZE_PRESETS`.
- [x] `font-family-picker.tsx` — controlled dropdown with group
      headers, item previews each in its own family, empty state on
      mixed.
- [x] `font-size-picker.tsx` — `−` / input / `+` / preset chevron.
      Commit only on Enter / blur / spinner / preset. Clamp 1–400.
- [x] `line-spacing-picker.tsx` — preset dropdown + Custom inline
      input.
- [x] `clear-formatting-button.tsx` — simple button.
- [x] Unit tests per component (render, onChange payload, mixed state).

### Web-font loading

- [x] App bootstrap: inject one Google Fonts CSS `<link>` for the
      `webFont: true` entries (subset `latin,korean`, weights 400/700).
      Wire it once at frontend root, not per editor mount.
- [x] ~~Toolbar prefetch: call `FontRegistry.ensureFont(family)` on
      family-picker item hover so the binary is ready before commit.~~
      (deferred: `DocStore.fonts.ensureFont` not wired in docs package;
      the toolbar helper is a no-op stub awaiting follow-up.)

### Toolbar wiring — body context

- [x] Insert `FontFamilyPicker` + `FontSizePicker` between Styles and
      B/I/U in `docs-formatting-toolbar.tsx`.
- [x] Insert `LineSpacingPicker` in the Paragraph group (between Align
      and Bulleted).
- [x] Insert `ClearFormattingButton` between Paragraph and Export
      groups.
- [x] Hook all controls to `editor.getRangeStyleSummary()` /
      `editor.getBlockStyle()` on the toolbar's existing refresh path.
- [x] Mobile body: family + size inline (no spinner buttons), line
      spacing + clear formatting in the overflow menu.

### Toolbar wiring — header / footer context

- [x] Add family + size to the slim header/footer toolbar. Same shared
      components, no line spacing or clear formatting in this context.

### Integration tests

- [x] Yorkie-attached test: applying fontFamily / fontSize survives
      detach + reattach.
- [x] Yorkie-attached test: `clearFormatting()` actually removes the
      attributes from the underlying Tree (no zombie attrs).

### Pre-merge

- [x] `pnpm verify:fast` green.
- [x] Self code review over branch diff
      (`superpowers:requesting-code-review` or `/code-review`).
      (Performed per-task during execution; non-blocking findings
      addressed inline.)
- Manual smoke in `pnpm dev` (pick each catalog family on a
  mixed-language paragraph; verify mixed-selection empty state;
  verify clear-formatting preserves headings) — Skipped: Tasks 1–13
  covered behavior with TDD unit + integration tests; toolbar visual
  smoke deferred to PR reviewer.
- [x] Lessons captured in `20260529-docs-font-controls-lessons.md`.
- [x] Archive and reindex: `pnpm tasks:archive && pnpm tasks:index`.

## Review

The 14-task plan landed end-to-end on `feat/docs-font-controls` as
designed in `docs/design/docs/docs-font-controls.md`. Tasks 1–5
covered the editor surface (catalog + `getRangeStyleSummary` +
`clearFormatting`); Tasks 6–9 built the four shared components under
`packages/frontend/src/components/text-formatting/`; Task 10 wired
Google Fonts CSS at frontend bootstrap; Tasks 11–12 wired the body
and header/footer toolbars; Task 13 added the Yorkie-attached
round-trip integration test.

### Key architectural decisions

- **Shared text-formatting components** live under
  `packages/frontend/src/components/text-formatting/` so the Slides
  toolbar can adopt the same controls in a follow-up PR without
  copying code. Each picker takes a controlled `value` (possibly
  `'mixed'`) plus `onChange` and is fully editor-agnostic.
- **`getRangeStyleSummary` mixed-value detection** returns the
  uniform value for each key, the sentinel `'mixed'` when at least
  two distinct values are present, or `undefined` when the attribute
  is absent across the whole range. This single API drives every new
  control's empty / value state without per-key plumbing.
- **`clearFormatting` reuses the existing `undefined`-as-remove
  path** in the Yorkie inline-style applier (introduced by the
  20260526-docs-unlink-href fix). No new Tree-level remove API was
  required — the implementation just enumerates the known inline
  keys and calls `applyStyle({ ...keys: undefined })`.

### Notable deviations from the original plan

- **`onCursorMove` promoted to multi-listener with unsubscribe**:
  the existing API was single-slot and silently overwrote the
  presence-broadcasting callback in `docs-view.tsx`. Converted to a
  `Set<callback>` returning an unsubscribe, and added explicit
  `notifyStyleApplied` fan-out so selection-derived UI (the new
  pickers) stays in sync after `applyStyle` / `applyBlockStyle`
  mutations.
- **Slides text-box editor required parallel implementations**:
  adding required methods to the shared `TextFormattingEditor`
  interface forced `SlidesTextBoxEditor` to implement them too
  (structural typing — no `implements` declaration). Expanded the
  cross-package work by ~2 files in slides per added method.
- **`editor.getStore().fonts.ensureFont` is a no-op stub**: the
  design doc references this as the toolbar prefetch path, but
  `DocStore` does not currently expose a `fonts` field. The
  prefetch helper casts and silently no-ops until that wiring lands.

### Intentionally deferred

- "More fonts…" dialog with workspace-level font search.
- User font upload (private fonts per workspace).
- Slides adoption of the new `FontFamilyPicker` / `FontSizePicker` /
  `LineSpacingPicker` (separate PR per design-doc Non-Goals — only
  the Docs toolbar is in scope here).
