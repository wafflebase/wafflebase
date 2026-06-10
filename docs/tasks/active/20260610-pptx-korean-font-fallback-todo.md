# PPTX Korean font fallback — P0 + P1

After importing a PPTX whose theme/runs reference Korean families that
Wafflebase does not register (e.g. `NanumSquare Neo OTF Bold`, or a
Latin-only face like `Arial` on a Hangul run), the canvas paints the
Korean text with the browser's default sans-serif because:

- the importer preserves the typeface name string but no fallback chain
  exists in `FONT_MAP` for unknown families;
- the existing Korean fallback at `packages/slides/src/import/pptx/text.ts:355`
  only fires when `style.fontFamily` is unset (so it misses any explicit face);
- embedded font binaries in `ppt/fonts/font*.fntdata` are ignored.

Repro file: `최상위영입채널_유튜브비교_260608_vF.pptx` — theme uses
`<a:latin typeface="NanumSquare Neo OTF"/>`, slides use the Bold/ExtraBold
weights, and Arial appears on some Hangul runs.

P3 (embedded font extraction) is deferred — see "Out of scope" below.

## P0 — Render-layer Korean fallback (this PR)

Guarantee that every resolved fontFamily ends with a Korean-capable
family, so the browser handles per-glyph fallback at paint time. This
makes Hangul readable for any imported deck regardless of the original
typeface name.

- [x] `packages/docs/src/view/fonts.ts` — `resolveFontFamily(family)`
      returns a stack that always includes `'Noto Sans KR'` (or `'Noto
      Serif KR'` for serif chains) before the generic, unless the chain
      already names a Korean-capable face. Monospace skipped to keep
      code alignment intact.
- [x] `packages/slides/src/import/pptx/text.ts` — remove the Korean
      fallback guard; rendering layer handles it uniformly now. Updated
      regression tests assert the importer preserves the original
      typeface verbatim (even on Hangul runs with an explicit Latin
      face) and leaves `fontFamily` unset when the source has no
      override (theme default + render-layer fallback take over).
- [x] `packages/docs/src/view/fonts.ts` test additions for Arial /
      Times New Roman / unknown family / NotoSansKR-no-double-append /
      monospace-skipped cases.
- [x] Canvas `ctx.font` callers — `buildFont` (`theme.ts`) and
      `resolveInlineFont` (`layout.ts`) both route through
      `resolveFontFamily` so Canvas measure + paint share the chain the
      DOM/CSS path uses. Previously `buildFont` passed the raw family
      into `ctx.font`, so measure and paint diverged once the new
      fallback landed.

## P1 — Catalog expansion via Google Fonts (this PR)

`packages/frontend/src/components/text-formatting/font-catalog.ts`
already builds a single `<link href="…fonts.googleapis.com…">` from
`FONT_CATALOG` entries with `webFont: true`. Extend the catalog with
the Korean families that are actually on Google Fonts so common decks
render with their original face.

- [x] Added 4 body-text Korean entries to `FONT_CATALOG`:
      Gothic A1, Nanum Myeongjo, Gowun Dodum, Gowun Batang. Display
      fonts (Black Han Sans / Jua / Do Hyeon) deferred — body coverage
      gets us the higher-leverage parity wins for imported decks first.
      NanumSquare Neo / Pretendard / SUIT still parked under "Out of
      scope" — they're not on Google Fonts.
- [x] `FontEntry.weights?: string` — per-entry override for the
      `wght@…` axis on the Google Fonts URL. Default stays `'400;700'`;
      Gowun Dodum overrides to `'400'` (it ships only Regular, and a
      bad weight request 400s the entire CSS payload poisoning every
      other family on the link).
- [x] Mirrored the 4 new entries into `FONT_MAP` (docs renderer) with
      matching generic suffix (sans-serif vs serif) so
      `resolveFontFamily` returns the right shape. Updated
      `KOREAN_CAPABLE_SANS` / `KOREAN_CAPABLE_SERIF` so the new
      Korean-capable faces don't double-append the Noto fallback.
- [x] `stripTypefaceSuffixes` normalizer added to fonts.ts (NOT to
      the importer — keeping the stored `style.fontFamily` verbatim so
      PPTX export round-trips). `resolveFontFamily` tries the verbatim
      family first, falls back to the normalized form for the FONT_MAP
      lookup. Covers `" Bold"`, `" ExtraBold"`, …, `" OTF"`, `" TTF"`
      and combinations like `"X OTF Bold"`.
- [x] `ensureGoogleFontsLink()` wired into both `SlidesView` and
      `DocsView` mounts. Was previously called only from the toolbar /
      font-picker surfaces, so read-only and shared-URL viewers (no
      toolbar mount) painted imported decks against the browser's
      local fonts. Idempotent guard means editable mounts still pay
      one request.

## Verification

- [x] `pnpm verify:fast` green (docs 915 / slides 1720 / frontend 531
      / sheets 1279 / cli 191 / backend 175 passing).
- [ ] Manual: in `pnpm dev`, re-import the repro PPTX and confirm
      Hangul renders with proper Korean glyphs (Noto Sans KR if the
      original face is not in the catalog; the original face if it is
      — e.g. add a deck with `Gothic A1` and verify Google Fonts loads
      it).
- [ ] Manual: confirm an `Arial`-tagged Hangul run no longer renders
      as system default — Korean glyphs come from Noto Sans KR while
      Latin stays Arial.
- [ ] Self-review with `/code-review` over the branch diff before push.

## Out of scope (separate task)

- **NanumSquare Neo / Pretendard / SUIT loading.** These are widely
  used in Korean decks but are not on Google Fonts. Loading them
  requires either jsDelivr / fontsource / per-font CDN URLs (extending
  `buildGoogleFontsHref` into a multi-source resolver) or admin-uploaded
  workspace fonts. Track as P1.5 in a follow-up todo once we see usage
  signal from real decks.
- **Embedded font extraction (P3).** `<p:embeddedFontLst>` parsing,
  OBFCTT/EOT decoding, license-flag honoring, blob `@font-face`
  registration, and per-doc asset storage. Significant security and
  licensing surface; design doc required before scoping.
- **EA / CS typeface slot reading.** This repro has `<a:ea typeface=""/>`,
  so it does not block the current symptom. Worth picking up when we
  see a deck that uses the EA slot in anger.

## Notes

- The P0 trick (always-append Korean fallback) lets the browser solve
  per-glyph selection via the standard CSS `font-family` cascade. It
  costs nothing at paint time and removes the need for a separate
  "is this Hangul?" branch in the importer.
- `FONT_CATALOG` (frontend) and `FONT_MAP` (docs render) are two
  separate sources of truth today. P1 keeps them in sync manually;
  a future cleanup could fold `FONT_MAP` into the catalog (with each
  entry owning its render-time stack) so there's a single source.
