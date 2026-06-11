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

Reproduced against a private PPTX deck whose theme declares
`<a:latin typeface="NanumSquare Neo OTF"/>` with the Bold / ExtraBold
weights used per-run, and `Arial` appearing on some Hangul runs. The
filename is intentionally omitted from the design doc — the deck is
not redistributable.

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

## P2 — Code-review findings rolled into the same PR

Self-review with `/code-review` at xhigh effort surfaced 13 findings
across correctness, downstream regressions, simplification, and
performance. All addressed in this PR (not split into follow-ups):

- [x] **CLI FontkitMeasurer cache miss (Critical).** `ResolvedFont.family`
      was changed to carry the resolved CSS chain so Canvas measure /
      paint stayed aligned. That broke `FontkitMeasurer.variantKey`
      (CLI PDF export), which keys its registered-font cache on the
      raw family name. Reverted `resolveInlineFont` to return the raw
      family; moved the resolver call into
      `CanvasTextMeasurer.fontToCss` so the Canvas path still gets
      the Korean fallback chain at `ctx.font` time, while FontkitMeasurer
      hits its cache directly.
- [x] **`stripTypefaceSuffixes` peeled `Italic`.** Many real families
      ship with `Italic` in the canonical family name (`Lucida Sans
      Italic`). Stripping it routed the lookup to the upright cut and
      sans-classified serif italic faces. Dropped `Italic` from
      `WEIGHT_SUFFIXES`; italic is carried by `InlineStyle.italic`.
- [x] **Slides ghost-hint bypassed `buildFont`.** `text-renderer.ts`
      set `ctx.font` directly from `resolveFont()`'s raw family, so
      a Korean placeholder hint rendered with the browser default
      while typed text in the same box went through Noto Sans KR.
      Routed through `resolveFontFamily`.
- [x] **DOCX export dropped `<w:rFonts>` on Hangul runs.** Old behavior
      depended on the importer stamping `style.fontFamily='Noto Sans KR'`
      on Hangul-only runs; removing that left the exporter without a
      rFonts override, so Word opened those runs in Calibri. Now always
      emits `<w:rFonts>`: ascii/hAnsi default to `'Arial'`, eastAsia
      defaults to `'Noto Sans KR'` when the run's family isn't already
      Korean-capable. New `isKoreanCapableFamily` helper exported from
      docs.
- [x] **`resolveFontFamily` was not idempotent.** Exported public API,
      but feeding it its own chain output produced garbage CSS because
      `escapeFontFamily` re-escaped the inner quotes. Added an
      idempotency guard: any input containing a comma is treated as
      already-resolved and returned verbatim (CSS forbids unescaped
      commas in family identifiers).
- [x] **Verbatim weight-bearing family dropped when normalized hit
      the catalog.** `"Roboto Bold"` → normalized `"Roboto"` → chain
      = `"'Roboto', sans-serif"` lost the explicit `'Roboto Bold'`
      face name, so a browser with the weight-specific PostScript
      face installed fell through to CSS-synthesized bold. Now prepend
      the verbatim family before the canonical mapping: `"'Roboto
      Bold', 'Roboto', sans-serif"`.
- [x] **Case-sensitive suffix matching.** LibreOffice writes
      `'Pretendard Semibold'` (lowercase b); the strip missed it.
      Now case-insensitive against `WEIGHT_SUFFIXES` / `FORMAT_SUFFIXES`.
- [x] **Hardcoded 2-pass strip loop dropped 3+ trailing tokens.**
      Replaced with `while (changed)` peel — handles arbitrary
      combinations of format + weight tokens without a hardcoded depth.
- [x] **`KOREAN_CAPABLE_*` duplicated FONT_MAP facts.** Replaced the
      two manual sets with a single `KOREAN_CAPABLE` set derived at
      module init from FONT_MAP entries whose chain contains a Noto KR
      face. Updated FONT_MAP entries (Nanum Gothic, Nanum Myeongjo,
      Gothic A1, Gowun pair) to include Noto KR in their fallback
      chains — uniform missing-glyph safety net AND keeps the
      capability set self-deriving.
- [x] **`containsHangul` was dead export.** Removed from
      `slides/src/import/pptx/font.ts` along with its unit test —
      no production callers remained after the importer fallback
      guard was deleted.
- [x] **5-site copy-paste `useEffect(() => ensureGoogleFontsLink(), [])`.**
      Extracted `useGoogleFontsLink()` hook in `font-catalog.ts`.
      SlidesView / DocsView call the hook at mount; toolbar /
      font-picker call sites dropped their redundant copies (idempotent
      injection means the view-level call covers them).
- [x] **`resolveFontFamily` ran uncached on every paint / measure call.**
      Added a module-level `RESOLVE_CACHE` keyed by raw family input.
      Bounded by unique typeface names per session (catalog + brand
      fonts) so memory stays O(unique families).
- [x] **`fontKey` cache key bloat from chain string.** Implicitly fixed
      by reverting `ResolvedFont.family` to raw above — keys go back
      to ~25-char family names instead of ~70-char chains.

## Verification

- [x] `pnpm verify:fast` green (docs 919 / slides 1718 / frontend 531
      / sheets 1279 / cli 191 / backend 175 passing).
- [x] Manual: stress-tested the repro PPTX in `pnpm dev` — Hangul
      renders in Noto Sans KR fallback (NanumSquare Neo isn't on Google
      Fonts, deferred). Mixed Latin + Hangul runs render correctly.
- [x] Self-review with `/code-review` at xhigh effort; all 13 findings
      addressed (see P2 above).

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
