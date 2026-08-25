# Subset font previews to the glyphs each row actually paints

Issue: [#963](https://github.com/wafflebase/wafflebase/issues/963). Follow-up
memo from #947.

## Problem

Both per-row visibility observers — `FontFamilyPicker`'s dropdown list and
`MoreFontsDialog`'s result list — call `ensureFontLink(family)` when a row
scrolls into view. That is the **full-load** path: it fetches every glyph of
the family just to paint a ~10-character label. Scrolling the 1,908-entry
full library therefore pulls whole families the user only ever glanced at.

Google Fonts' css2 endpoint can serve a glyph subset via `&text=`, so a
preview only needs the characters that row displays.

## Approach

Add a **separate** function, `ensurePreviewFontLink(family, text, weights?)`,
to `packages/frontend/src/components/text-formatting/font-catalog.ts`.
`ensureFontLink` / `findFontLink` keep their logic and signatures — the
full-load path (picker selection, `onPrefetch`, dialog selection) stays
provably untouched.

- [ ] `ensurePreviewFontLink` marks its link with a **different** attribute,
      `data-wafflebase-font-preview`, so `findFontLink`'s
      `link[data-wafflebase-font]` query cannot see it. Otherwise selecting a
      previewed-only family would dedupe against the subset and render with
      missing glyphs.
- [ ] It no-ops when a full link already exists (`findFontLink` resolves) —
      a later-declared subset link would otherwise win the cascade for the
      label's glyphs after a hover-prefetch.
- [ ] It keeps `ensureFontLink`'s other guards: SSR, system fonts, eager
      bootstrap families, and idempotency per family.
- [ ] Weight is derived from the entry's `weights`, never hardcoded to 400:
      `Sunflower` (`해바라기`) ships only 700 and `css2?…:wght@400` answers
      HTTP 400 with an HTML error page, which would strand that row in a
      fallback face forever. Take the first weight of the spec.
- [ ] The subset text is read from the row's own `textContent`, not from a
      catalog lookup — recents and the full library contain families absent
      from `CATALOG_INDEX`. This also covers `MoreFontsDialog`'s group-name
      span, which inherits the row button's `fontFamily` and so must not
      split across two faces (e.g. "Sans-serif" needs U+2d and U+72).
- [ ] Both observers pass the row's text plus a `data-font-weights`
      attribute carrying the entry's `weights`.

## Tests

- [ ] `ensure-font-link.test.ts`: preview injects under the new marker, is
      invisible to the full path, carries `&text=`, no-ops when a full link
      exists, and requests a shipped weight for a 700-only family.
- [ ] `font-family-picker.test.ts`: a row scrolling into view injects a
      **preview** link; previewing then selecting injects the full link too.
- [ ] `more-fonts-dialog.test.ts`: the dialog's observer subsets the label
      *and* the group name.
- [ ] `pnpm verify:fast` green before the draft PR.

## Out of scope

- Any change to `ensureFontLink` / `findFontLink`.
- `?subset=menu` (silently ignored by css2; the v1 endpoint aliases the
  family name, which would mean rewriting every row's `fontFamily`).
