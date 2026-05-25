# Slides text-box edit-mode theme color fix

## Problem

In a dark deck theme (e.g. "Simple Dark"), entering text-box edit mode
turns the text black/invisible. The committed slide canvas renders text
in the theme's `text` role color, but the in-place text-box editor paints
with the docs `defaultColorResolver` — so stored `'#000000'` / `undefined`
colors render as literal black instead of the theme color.

## Root cause

- Slide canvas: `drawText` (`packages/slides/src/view/canvas/text-renderer.ts`)
  builds `makeColorResolver(theme)` and passes it to `paintLayout`. That
  resolver remaps `undefined` and the docs-default `'#000000'` string to
  the deck's `text` role color.
- Edit mode: `initializeTextBox` → `renderNow` calls `paintLayout`
  (`packages/docs/src/view/text-box-editor.ts:355`) WITHOUT a
  `colorResolver`, so it falls back to `defaultColorResolver` (literal
  black). The docs editor seeds new inlines with
  `DEFAULT_INLINE_STYLE.color = '#000000'` (`types.ts:174`).

Mismatch → text "turns black" on entering edit mode in dark themes.

## Plan

- [x] docs `text-box-editor.ts`: add `colorResolver?: ColorResolver` to
      `TextBoxEditorOptions`; thread it into the `paintLayout` call.
- [x] slides `text-renderer.ts`: export `makeColorResolver`.
- [x] slides wrapper `text-box-editor.ts`: add `colorResolver?` to
      `MountSlidesTextBoxOptions`; pass through to `initializeTextBox`.
- [x] slides `editor.ts` `enterEditMode`: build resolver from the active
      theme (`getActiveTheme(doc)` + `makeColorResolver`) and pass it.
- [x] Regression test in slides `text-box-editor.test.ts`; proven to fail
      without the fix (`colorResolver` undefined).
- [x] Verify: `pnpm verify:fast` green (frontend/backend/sheets/slides/cli/docs).
- [ ] Manual smoke in `pnpm dev` with Simple Dark (pending UI run).

## Review

- Single seam was missing: `paintLayout` already accepted `colorResolver`
  end-to-end (runs + list markers + inline backgrounds); only the in-place
  editor's `renderNow` call omitted it, and the slides editor never built
  one. Fix reuses the canvas renderer's existing `makeColorResolver` rather
  than duplicating the remap logic, so canvas + editor stay single-sourced.
- `getActiveTheme(doc)` throws on a deck whose `meta.themeId` isn't in
  `themes[]`. Safe here: the slide renderer already calls it every frame,
  so a misconfigured deck would fail to render before edit mode is reachable.
- Backward compatible: `colorResolver` is optional everywhere; docs/sheets
  callers fall back to `defaultColorResolver` (string passthrough) unchanged.
- Verified the regression test catches the bug by temporarily removing the
  editor's `colorResolver` arg → test failed with "expected undefined to be
  defined", then restored → green.
