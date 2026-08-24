# Font list previews render in a fallback face — TODO

Issue: [#727](https://github.com/wafflebase/wafflebase/issues/727)

## Problem

Every row of the font-family dropdown is styled with its own family, but the
list paints in a fallback face until the pointer enters a row. Hover loads the
font; scrolling does not, and keyboard navigation never loads anything.

## Root cause

`FontFamilyPicker` injects a family's Google Fonts `<link>` from one place —
`onPointerEnter` (`font-family-picker.tsx:176`, `:204`). Only 8 of the 105
catalog entries are `eager: true` and ride the bootstrap link; the other 87
have no `<link>` until they are hovered, so their preview label falls back.

Hover was never the preview path. When the picker shipped (`7a8d91fb3`, 14
families) `buildGoogleFontsHref()` filtered on `f.webFont` alone, so the
bootstrap link carried every family the dropdown could show. #371
(`78b2cc236`) grew the catalog to 105 and narrowed that to
`f.webFont && f.eager` to keep the request small — right for body text, but
it left the other 87 previews with no face to paint in. Hovering to check
repairs the row, which is why it went unnoticed.

`MoreFontsDialog` got the fix in that same commit: one IntersectionObserver
rooted on the scroll container calls `ensureFontLink` when a row scrolls into
view (`more-fonts-dialog.tsx:126-145`). The dropdown was left on hover.

## Approach

Port that observer to the dropdown, loading per visible row instead of via the
bootstrap link. It issues the same requests `onPointerEnter` already
issues, triggered by visibility instead of hover — no new network behaviour, no
change to `ensureFontLink` or the catalog, so nothing new interacts with the
CSS cascade or the Canvas `FontRegistry`.

`onPrefetch` stays on hover. For Docs it also warms the Canvas font registry
(`docs-formatting-toolbar.tsx:344`), which should not run for every row
scrolled past.

The picker is shared, so Docs, Slides, and the Slides mobile toolbar are all
fixed by the one change.

## Changes

- [x] `packages/frontend/src/components/text-formatting/font-family-picker.tsx`
  - [x] Import `ensureFontLink`.
  - [x] Hold the content node in state (`ref={setListEl}`) rather than a
        `useRef` — Radix remounts the portalled content on every open, and the
        callback ref is what tells the effect the node exists (and cleans up
        when it goes).
  - [x] Tag both item maps (Recent + groups) with `data-font-row={family}`.
  - [x] Observer effect keyed on `[listEl, recents]` — `recents` is set in
        `onOpenChange`, which re-renders the list a second time. Load on first
        intersect, then `unobserve`.

## Tests

- [x] `packages/frontend/tests/components/text-formatting/font-family-picker.test.ts`
  - [x] Opening the dropdown injects **no** `link[data-wafflebase-font]` —
        guards against regressing into "load the whole catalog on open".
  - [x] Firing the observer callback for a row injects exactly that family's
        link.
  - Together they pin the rule #371 silently dropped.
  - jsdom has no `IntersectionObserver`, so it needs a stub; the dialog test
    documents the same gap.

## Verify

- [ ] `pnpm verify:fast`
- [ ] Self code review over the branch diff
- [ ] Manual: open the picker in Docs and Slides with DevTools Network filtered
      on `fonts.googleapis.com` — only visible rows request, more as you
      scroll, keyboard navigation loads too. Do not hover while checking; that
      is what hid the bug in the first place.
- No visual-lane impact: the harness never mounts `FontFamilyPicker`
  (`slides-pickers` is the standalone theme-font picker), so no baseline moves
  and no new font fixture is needed.

## Follow-up (new issue, not this branch)

- [ ] File **"font previews: subset a preview to its label glyphs"**. A row
      pulls its family's entire CSS just to paint that family's name; Google
      Fonts' `&text=` subsets it to those glyphs. Noticed while fixing #727,
      not part of it.

## Out of scope

- **Preview subsetting** — see Follow-up above.
- **`MoreFontsDialog`** pays the same per-row cost across 1,908 rows. Same
  follow-up, and no report against it either.
- The trigger button label (`:135`) also previews in the applied family and may
  fall back for a non-eager font. Check whether it reproduces; one line if so.
