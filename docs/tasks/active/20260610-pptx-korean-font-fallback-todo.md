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

- [ ] `packages/docs/src/view/fonts.ts` — `resolveFontFamily(family)`
      returns a stack that always includes `'Noto Sans KR'` before the
      generic, unless the chain already names a Korean-capable face.
  - Detect Korean-capable families via a small `KOREAN_FAMILIES` set
    (Noto Sans KR, Noto Serif KR, Malgun Gothic / 맑은 고딕, Batang /
    바탕, Nanum Gothic, and any P1 additions) so we don't double-append.
  - For families with an existing explicit chain in `FONT_MAP`, splice
    `'Noto Sans KR'` into the chain right before the generic.
  - Pick `Noto Serif KR` (not Noto Sans KR) when the resolved face is
    in `SERIF_FONTS`, so Times New Roman + Hangul still feels serif.
- [ ] `packages/slides/src/import/pptx/text.ts:353-357` — remove the
      Korean fallback guard; rendering layer handles it uniformly now.
      Add a regression test asserting that import preserves the original
      `fontFamily` even for Hangul runs (no longer overridden).
- [ ] `packages/docs/src/view/fonts.ts` test additions:
  - `resolveFontFamily('Arial')` → contains `'Noto Sans KR'` before
    `sans-serif`.
  - `resolveFontFamily('Times New Roman')` → contains `'Noto Serif KR'`
    before `serif`.
  - `resolveFontFamily('Noto Sans KR')` → does NOT double-append.
  - `resolveFontFamily('NanumSquare Neo OTF Bold')` (unknown family) →
    `'NanumSquare Neo OTF Bold', 'Noto Sans KR', sans-serif`.
- [ ] Canvas `measureText` / `ctx.font` callers in `packages/docs/src/view`
      (paint-layout.ts, table-renderer.ts) already feed the resolved
      string — verify they go through `resolveFontFamily` or update them
      to pick up the new fallback. If any path builds the CSS font string
      with raw `style.fontFamily`, route it through `resolveFontFamily`.

## P1 — Catalog expansion via Google Fonts (this PR)

`packages/frontend/src/components/text-formatting/font-catalog.ts`
already builds a single `<link href="…fonts.googleapis.com…">` from
`FONT_CATALOG` entries with `webFont: true`. Extend the catalog with
the Korean families that are actually on Google Fonts so common decks
render with their original face.

- [ ] Add Korean entries to `FONT_CATALOG` (all `webFont: true`,
      family names match Google Fonts canonical names):
  - `Gothic A1` — neutral sans, broad weight range.
  - `Gowun Dodum` — friendly modern sans.
  - `Gowun Batang` — modern serif counterpart.
  - `Black Han Sans` — display.
  - `Jua` — rounded display.
  - `Do Hyeon` — bold display.
  - `Nanum Myeongjo` — serif companion to Nanum Gothic.
  - (do NOT add NanumSquare Neo / Pretendard / SUIT — not on Google
    Fonts; route through P1.5/P3, see "Out of scope".)
- [ ] Mirror these into `packages/docs/src/view/fonts.ts` `FONT_MAP`
      so `resolveFontFamily` returns proper stacks (each with the
      Korean fallback from P0 spliced in).
- [ ] Add a typeface-name normalizer used by the PPTX importer:
      strip trailing weight suffixes (`" Regular"`, `" Bold"`,
      `" ExtraBold"`, `" OTF"`, `" OTF Regular"`, etc.) when matching
      against `FONT_MAP` / `FONT_CATALOG`. PPTX writes per-weight as
      separate family names (`"NanumSquare Neo OTF Bold"`); the
      canonical family is `"NanumSquare Neo"`. This unblocks future
      catalog hits without a custom mapper for every weight.
  - Implementation: a `normalizeTypeface(face)` helper in
    `packages/slides/src/import/pptx/font.ts`, called from
    `parsePrimaryTypeface` and the run-level reader in `text.ts:318`.
  - Test: `normalizeTypeface('NanumSquare Neo OTF Bold')` →
    `'NanumSquare Neo'`; benign for already-canonical names.
- [ ] Bootstrap `ensureGoogleFontsLink()` from the Slides editor mount
      (it's currently called from the Docs editor mount only). The
      Slides canvas needs the same web fonts during paint — without
      this, the link injection only happens on the Docs route.

## Verification

- [ ] `pnpm verify:fast` green.
- [ ] `pnpm sheets test`, `pnpm docs test`, `pnpm slides test` pass.
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
