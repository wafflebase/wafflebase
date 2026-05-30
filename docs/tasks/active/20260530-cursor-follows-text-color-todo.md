# Cursor color follows text color

## Problem

In Slides with the **Simple Dark** theme (and any future deck theme whose
text is light on a dark background), the text-edit caret renders with
`Theme.cursorColor` from the docs `Theme` (light/dark mode of the docs
package itself, *not* the deck theme). When the docs theme is in light
mode but the slide background is dark, the caret paints in dark ink and
is effectively invisible against the slide background.

Google Slides / Docs solve this by making the caret track the **resolved
text color at the cursor position**, so a red run shows a red caret, a
white run on a dark slide shows a white caret. That is the fix we want.

## Scope

Three caret paint sites use `Theme.cursorColor` today:

1. `paint-layout.ts` — caret drawn for any caller that hands a `cursor`
   option to `paintLayout` (slides text-box editor goes through this).
2. `doc-canvas.ts` — body caret in the paginated docs editor.
3. `doc-canvas.ts` — header / footer carets in the paginated docs editor.

All three should resolve the caret color from the inline at the cursor
position, with the existing `theme.cursorColor` as fallback.

## Plan

1. **Helper** — add `resolveColorAtPosition(block, offset, colorResolver, fallback)`
   to `packages/docs/src/model/color.ts`. Walks the inline list the same
   way `getStyleAtCursor` / `getSelectionStyle` do, reads
   `inline.style.color`, runs it through `colorResolver`, returns the hex
   string or the supplied fallback.
2. **paint-layout** — extend `PaintLayoutOpts.cursor` with an optional
   `color?: string`. In the cursor paint block, use
   `cursor.color ?? theme.cursorColor`.
3. **doc-canvas** — widen the `cursor` / `headerCursor` / `footerCursor`
   render params with the same optional `color`, fall back to
   `Theme.cursorColor`.
4. **Callers compute the color**:
   - Slides text-box (`packages/docs/src/view/text-box-editor.ts`) —
     resolve from `doc.getBlock(cursor.position.blockId)` + the
     theme-aware `colorResolver` already passed in; fall back to
     `Theme.cursorColor`.
   - Docs body / header / footer (`packages/docs/src/view/editor.ts`) —
     resolve from the relevant doc; no colorResolver in docs today, so
     pass `defaultColorResolver`.
5. **Tests** — extend the existing `text-box-editor` / `paint-layout`
   unit tests to assert the caret fill matches the resolved text color.

## Verification

- `pnpm verify:fast` before commit.
- Manual smoke in `pnpm dev`: open a Simple Dark deck, enter a text
  placeholder, confirm the caret is visible (light on dark background).
- Manual smoke: in light-theme docs, change run color to red and confirm
  the caret turns red as the cursor crosses into the red run.

## Out of scope

- Honouring `styleBuffer` (toolbar-picked color before the next keystroke)
  in the caret. The buffer is a TextEditor-internal concept; today it
  flips back to the stored style on the next selection. Keeping caret
  color tied to the stored style matches Google Slides v1 and avoids a
  cross-class refactor.
- Selection-spanning caret. The caret only paints at the focus end of
  the selection; same behaviour as today.
- Cursor visibility for peer carets (those already carry a per-peer
  color from presence).
