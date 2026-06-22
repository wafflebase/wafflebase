# Slides Rich Fonts — TODO

Design: [`docs/design/slides/slides-fonts.md`](../../design/slides/slides-fonts.md)

Goal: grow the shared font picker from a hardcoded ~19-family list into a
data-driven Google Fonts catalog with per-font lazy loading, a "More
fonts…" search dialog, per-doc/used + recent accumulation, and a
license-aware export embed path. Shared layer → benefits Docs + Slides;
Slides is the driving surface.

## Decisions (settled with user)

- Font source: **Google Fonts CSS API** (not self-hosting).
- License: every Google Font is usable (OFL/Apache/UFL all allow web
  serve + doc embed). Obligations only on embed/bundle: ship license
  texts, respect OFL Reserved Font Name on subsets.
- License is **not** in the webfonts REST API → capture at build time
  from the `google/fonts` repo (`ofl/`,`apache/`,`ufl/` dirs +
  `METADATA.pb`), optionally via `fontsource/google-font-metadata`.

## Phase P0 — generated catalog + lazy loading

- [x] `scripts/build-font-catalog.mjs` — fetch google/fonts `METADATA.pb`
      per family, derive license/weights(incl. variable `axes`)/scripts,
      emit typed `font-catalog.data.ts` (104 families: 94 web, 8 eager).
      Run via `pnpm frontend build:font-catalog`.
- [x] `font-catalog.ts` — source `FONT_CATALOG` from the generated data
      module; add `license`/`scripts`/`eager` to `FontEntry`; add
      `Display`/`Handwriting` groups; keep existing exports/contract.
- [x] `ensureFontLink(family, weights?)` per-family CSS link injector
      (idempotent via `data-wafflebase-font`, HMR/charset-safe); bootstrap
      link loads only `eager` web fonts (the pre-expansion set) — the long
      tail lazy-loads. Docs toolbar `ensureFont` calls it before load.
- [x] Picker shows the new groups; tests updated (eager bootstrap, lazy
      non-eager catalog font, system/eager skips).
- [x] Slides toolbar font family: the Slides text-edit toolbar had NO
      font-family picker (only size/format/paragraph), so the catalog was
      not exposed in Slides at all. Added `FontFamilyPicker` to desktop
      `text-edit-section.tsx` + mobile `TextFormatSheet`, wired through a
      shared `applySlideFontFamily` helper (lazy `ensureFontLink` +
      `document.fonts.load().then(markDirty/render)` for the dirty-gated
      canvas) and a new `useResolvedFontFamily` value hook.
- [ ] (follow-up) docs `resolveFontFamily` serif/mono classification for
      the new families (currently unknown → sans-serif generic fallback
      during load; real face still loads). Known limitation, low impact.

## Phase P1 — "More fonts…" dialog + accumulation

- [x] `more-fonts-dialog.tsx`: search (debounced 150ms) + category +
      script (All/Korean/Latin) filters. Pure `filterFonts` extracted to
      `more-fonts-filter.ts` (unit-tested).
- [x] IntersectionObserver in-view preview loading (single observer
      rooted on the scroll container; `data-font-row` → `ensureFontLink`).
      Windowing deferred to P2 where the row count jumps to ~1,800.
- [x] `font-recents.ts` — localStorage recents (cap 8, dedup, defensive).
      Per-doc Yorkie `usedFonts` deferred as an app-specific follow-up;
      recents cover the picker's accumulation need.
- [x] `FontFamilyPicker`: Recent section + "More fonts…" entry opening
      the dialog; every pick records a recent. Focus deferral mirrors the
      dropdown across the menu→dialog hop.
- [ ] (follow-up) Per-doc `usedFonts` on Yorkie meta (Slides + Docs).

## Phase P2 — full library

- [x] `scripts/build-font-catalog-full.mjs` — fontsource metadata
      (names/category/subsets/exact weights, one request) + google/fonts
      git-trees (license dir) → `font-catalog.full.ts` (1,908 families:
      OFL 1868 / Apache 35 / UFL 5). Run via `pnpm frontend
      build:font-catalog-full`.
- [x] `font-catalog-full-loader.ts` — memoized `import()` so the library
      is a separate 272 kB chunk, downloaded only when the dialog opens.
      The picker loads it on first open and swaps it into the dialog
      (curated fallback until resolved).
- [x] Chunk gate: 99/100 chunks, full-library chunk 272 kB < 710 kB cap
      (`node scripts/verify-frontend-chunks.mjs` green).
- [x] Row paint scales via `content-visibility: auto` (no windowing lib);
      IO still lazy-loads each visible row's web font.

## Phase P3 — export embed + notices

### P3-a — Docs PDF embeds curated Google Fonts (CURRENT)

Scope decisions (settled with user): embed the **curated catalog (~104)**
only (full-library picks fall back to Helvetica/Times); embed
**regular + bold** TTFs and **synthesize italic** via the existing oblique
shim (mirrors on-screen + Korean handling). Custom embed applies to the
**Latin (`needsCustomFont=false`) segments** of `splitMixedScript`; CJK
segments keep the Noto path, so mixed-script docs compose correctly.
Slides PDF is raster (`slides/src/export/pdf.ts`) and embeds nothing — so
this is **Docs PDF only**.

Architecture: today `resolveFontKey` collapses every family to a fixed
12-key set (serif/sans × bold/italic × CJK), discarding `fontFamily`.
P3-a moves to **family-keyed embedding** with a resolver injected from the
frontend (the docs package can't import the frontend catalog), reusing the
established `PdfFontsOptions` injection + IndexedDB cache + fontkit subset.

- [x] **Build script** — `scripts/build-font-files.mjs` emits
      `font-files.data.ts`: `family → { license, regular: url, bold?: url }`
      for curated web fonts. TTF URLs are version-pinned static gstatic
      `.ttf`s from fontsource `google-font-metadata`
      (`variants[w].normal.<subset>.url.truetype`) — static per-weight
      (variable fonts can't be instanced to a weight at embed time).
      Korean-group + no-latin families excluded (Noto handles CJK). 74
      families (54 with bold). Output committed. New
      `pnpm frontend build:font-files`. (Added a main-guard to
      `build-font-catalog.mjs` so importing its `GOOGLE_SEED` doesn't
      re-run the network catalog build.)
- [x] **`pdf-fonts.ts`** — `PdfFontKey` widened to `custom:${string}`;
      `customFontKey()` helper; `PdfFonts.registerCustom()` + `customUrls`
      so `load`/IDB cache resolve custom keys. `scanFontsUsed(doc, resolver?)`
      returns `customFamilies: Map<family,{needsBold,regular,bold?}>`,
      gated on Latin content (`HAS_LATIN_GLYPH`).
- [x] **`pdf-style-map.ts`** — `resolveFontKey(style, needsCustomFont, embeddable?)`
      returns a `custom:` key for embedded Latin families; `isItalicShim`
      fires for custom (no italic face embedded).
- [x] **`pdf-painter.ts`** — `embedAllFonts` fetches +
      `embedFont(buf, {subset:true})` each custom regular/bold (bold
      aliases regular when absent; fetch/embed failure drops the family);
      `embeddableFamilies` threaded into `PaintContext`.
- [x] **`pdf-exporter.ts` + frontend `pdf-actions.ts`** — added
      `fontResolver?: PdfFontResolver` to `PdfExportOptions`; exporter
      derives `embeddableFamilies` from successfully-embedded keys;
      frontend injects `(family) => FONT_FILES[family]`.
- [x] **Tests** — resolveFontKey custom/bold/italic/CJK/fallback;
      isItalicShim custom; scanFontsUsed custom (Latin-only, bold merge,
      CJK skip, no-resolver); pdf-fonts custom load; embedAllFonts
      regular+bold/alias/drop-on-failure; PdfExporter embeds 1 font
      program with resolver, 0 without (reload + FontFile2 count).
- [x] **Design docs** — updated `docs/design/docs/docs-pdf-export.md`
      (family-keyed embedding) and marked P3-a in `slides-fonts.md`.
- [ ] (follow-up) Collect embedded licenses for the P3-b notices page —
      data already lives in `font-files.data.ts` (`license` per family).

### P3-b / P3-c (after P3-a)

- [ ] Collect embedded-font licenses → in-app open-source notices page.
- [ ] (later) PPTX font embedding.

## P4 (deferred / out of scope)

- [ ] User-uploaded brand fonts + license attestation.

## Verification

- [ ] `pnpm verify:fast` green per commit.
- [ ] Manual smoke in `pnpm dev`: pick curated + non-curated font, FOUT
      behaves, PDF export embeds the chosen face.
- [ ] Code review over branch diff before push.

## Review / Lessons

(filled in on completion → `20260616-slides-fonts-lessons.md`)
