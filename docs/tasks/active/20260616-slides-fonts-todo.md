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

## Phase P0 — generated curated catalog + lazy loading

- [ ] `scripts/build-font-catalog.ts` — read google/fonts metadata, emit
      `font-catalog.curated.json` (~100, `license` field) + `.full.json`.
- [ ] `font-catalog.ts` — source data from JSON; keep existing exports/types.
- [ ] `fonts.ts` — `ensureFontLink(family, weights)` per-family CSS link
      injector (idempotent, id-keyed); bootstrap loads curated menu only.
- [ ] Verify Korean fallback + `resolveFontFamily` unchanged.

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
