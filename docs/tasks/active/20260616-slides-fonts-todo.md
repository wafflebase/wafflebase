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

- [ ] Dialog consumes lazy-imported `font-catalog.full.json` (~1,800).
- [ ] Chunk-gate check for the lazy chunk.

## Phase P3 — export embed + notices

- [ ] Generalize `pdf-fonts.ts` resolver to any Google Font TTF (pinned).
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
