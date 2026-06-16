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
- [ ] (follow-up) Slides `themed-font-picker` lazy-load wiring.
- [ ] (follow-up) docs `resolveFontFamily` serif/mono classification for
      the new families (currently unknown → sans-serif generic fallback
      during load; real face still loads). Known limitation, low impact.

## Phase P1 — "More fonts…" dialog + accumulation

- [ ] Dialog component: search (debounced) + category/script filters.
- [ ] Virtualized list + IntersectionObserver in-view preview loading.
- [ ] Per-doc `usedFonts` on Yorkie meta; local `recent` in localStorage.
- [ ] Wire dropdown to show curated + used + recent; "More fonts…" entry.

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
