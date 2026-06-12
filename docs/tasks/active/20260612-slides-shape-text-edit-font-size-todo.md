# Slides Shape Text-Edit Font Size — Empty Value + Stepper Exits Edit

**Goal:** Fix two regressions visible only when editing inline text inside a Shape in Slides:

1. Toolbar Font Size input renders empty.
2. Clicking the `+` / `−` steppers immediately exits text-edit mode.

**Architecture:** Two independent root causes, both anchored in the shared `FontSizePicker` surface:

- **Bug 1 (empty value)** — `text-edit-section.tsx` reads `textEditor.getSelectionStyle().fontSize` directly. A freshly typed Shape's text is seeded by `emptyShapeTextBlock()` (`packages/slides/src/view/editor/editor.ts:5755`) with `inlines: [{ text: '', style: { color: SHAPE_TEXT_SEED_COLOR } }]` — **no `fontSize`**. The renderer fills in the size from theme defaults at paint time, but the toolbar has no fallback. Docs solves the same shape in `docs-formatting-toolbar.tsx:330-333` with `summary.fontSize ?? DEFAULT_INLINE_STYLE.fontSize` and an `onCursorMove` subscription.
- **Bug 2 (steppers exit edit)** — `font-size-picker.tsx` is the only sibling in `components/text-formatting/` missing `data-text-edit-keepalive` and missing `onMouseDown preventDefault` on the `+`/`−` buttons. Pressing a stepper moves focus to the button → textarea blur → docs `handleBlur` (`packages/docs/src/view/text-box-editor.ts:677`) sees no keepalive ancestor → commit fires → slides `onCommit` (`packages/slides/src/view/editor/editor.ts:3169`) calls `finishEditMode()`. `font-family-picker.tsx`, `text-format-group.tsx`, `text-paragraph-group.tsx`, and `text-style-group.tsx` already have the right tagging.

**Tech Stack:** TypeScript, React, Vitest + React Testing Library for the picker, shared with docs and slides.

---

## Scope

In scope (single PR):

- Tag the FontSizePicker wrapper + dropdown content with `data-text-edit-keepalive`.
- `onMouseDown preventDefault` on the `+`/`−` buttons (matches `text-format-group.tsx`'s pattern so focus stays on the editor textarea).
- Slides `text-edit-section.tsx`: replace the inline `getSelectionStyle().fontSize` read with a `useState` + `editor.onCursorMove` refresh that pulls from `getRangeStyleSummary`, falling back to `DEFAULT_INLINE_STYLE.fontSize` (mirrors `docs-formatting-toolbar.tsx`).
- Unit-test regression: `font-size-picker.test.tsx` (or the existing keepalive test) asserts a `+` mousedown does not blur the host textarea.

Out of scope:

- Audit of other slides text-edit toolbar controls — they already use the keepalive pattern.
- Fixing the same empty-input symptom in `text-element-controls.tsx` (object-selection mode): present, but a separate UX surface; track as a follow-up if the user wants parity.
- Making `getSelectionStyle()` resolve theme / block defaults at the source (would need a wider docs API change).

## File Structure

**Modify:**

- `packages/frontend/src/components/text-formatting/font-size-picker.tsx` — keepalive attrs + mousedown preventDefault on steppers.
- `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx` — state + cursor-move refresh + fallback.

**Tests:**

- `packages/frontend/src/components/text-formatting/font-size-picker.test.tsx` — add (or extend if exists) a regression covering the stepper-mousedown blur path.

## Implementation Steps

- [x] Cut feature branch `fix/slides-shape-text-edit-font-size` from `main`.
- [x] Add `data-text-edit-keepalive` to the outer wrapper `<div>` and `DropdownMenuContent` in `font-size-picker.tsx`.
- [x] Add `onMouseDown={(e) => e.preventDefault()}` to both stepper `<button>` elements (matches `text-format-group.tsx`).
- [x] Refactor `text-edit-section.tsx` to mirror `docs-formatting-toolbar.tsx`: `useState<RangeSummary>` + `editor.onCursorMove(refresh)` + `summary.fontSize === 'mixed' ? undefined : (summary.fontSize ?? DEFAULT_INLINE_STYLE.fontSize)`.
- [x] Add Vitest regression: dispatch `mousedown` on the `+` button, assert the host textarea retains focus / the keepalive attribute is present on an ancestor.
- [x] `pnpm verify:fast` green.
- [ ] Self review via `/code-review`; address findings.
- [ ] Manual smoke: insert rectangle → start typing → Font Size shows 14 (or theme default) → click `+` → size increments, still in text-edit mode.
- [ ] Lessons file + archive + commit.

## Review

**Outcome.** Two-bug fix landed on `fix/slides-shape-text-edit-font-size`. `pnpm verify:fast` clean (lint + sheets/slides/cli/docs typecheck + 6 test packages green).

**Surprise during implementation.** The docs `TextBoxEditorAPI.onCursorMove` is **single-callback** (`cursorMoveCallback = cb`) — not multi-listener like `DocsEditorAPI.onCursorMove`. The slides editor (`editor.ts:3253`) already registers a callback for cell-boundary navigation. A second registration from the toolbar would silently clobber it, breaking Tab navigation between table cells.

Resolved by upgrading `SlidesTextBoxEditor.onCursorMove` to a multi-listener fan-out at the slides wrapper layer (a single docs-level callback fans out to a `Set<Listener>` and returns an unsubscribe). The wrapper change cascaded into six existing test mocks (`() => {}` → `() => () => {}`) but no production callers needed updating: the slides editor's cell-boundary path discards the returned unsubscribe (matched its original `void` expectation).

**Files touched.**

- `packages/frontend/src/components/text-formatting/font-size-picker.tsx` — `data-text-edit-keepalive` on wrapper + `DropdownMenuContent`; `onMouseDown preventDefault` on ± steppers.
- `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx` — `useState` + `onCursorMove` subscription + `DEFAULT_INLINE_STYLE.fontSize` fallback (mirrors `docs-formatting-toolbar.tsx`).
- `packages/slides/src/view/editor/text-box-editor.ts` — multi-listener fan-out for `onCursorMove`; updated `SlidesTextBoxEditor` interface to return `() => void`.
- `packages/frontend/tests/components/text-formatting/toolbar-focus.test.ts` — added three assertions covering FontSizePicker keepalive + stepper preventDefault.
- Test mock fixes (`() => () => {}` updates): `packages/slides/test/view/editor/{editor,empty-placeholder-entry,grouped-text-edit-entry,hover-highlight,text-box-editor}.test.ts`, `packages/frontend/tests/app/slides/toolbar/text-edit-section.test.ts`, `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`.

**Follow-up not done here.**

- `text-element-controls.tsx` (object-selection toolbar) reads `firstRunFontSize(el)` — same `undefined`-on-fresh-shape symptom in the size input. Out of scope for this PR but the same `?? DEFAULT_INLINE_STYLE.fontSize` fallback would close it.
- Per-package theme/master-derived default font size (instead of docs `11`) would be more accurate when PPTX decks override defaults, but requires a wider docs API change.
