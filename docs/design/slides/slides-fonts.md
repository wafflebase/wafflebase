---
title: slides-fonts
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Rich Fonts

## Summary

Today the font picker is a closed, hardcoded list of ~19 families
(`packages/frontend/src/components/text-formatting/font-catalog.ts`)
loaded as a **single Google Fonts CSS `<link>` at bootstrap**. This is
fine for a small curated set but does not scale to the rich font
experience users expect from Google Slides / Canva (hundreds to
thousands of families, searchable, previewed in-place).

This document proposes growing the catalog into a **data-driven Google
Fonts catalog** with **per-font lazy loading**, a **"More fonts…"
search dialog**, **per-document/per-user accumulated font lists**, and a
**license-aware export embedding path** so the on-screen richness
survives PDF/PPTX export.

The shared text-formatting components (`font-catalog.ts`,
`font-family-picker.tsx`, `fonts.ts`) are used by **both Docs and
Slides**, so this work lands in the shared layer and benefits both
editors; Slides is the driving surface.

### Goals

- Expand the available fonts from ~19 to a **curated 100+** (P1), with a
  path to the **full Google Fonts library (~1,800)** via search (P2).
- Keep first paint fast: only **fonts in use + the curated menu** load
  at bootstrap; everything else loads **on demand** (selection / hover /
  in-view preview).
- A **"More fonts…" dialog** with search, category, and script
  (Korean / Latin) filters, each row previewed in its own typeface.
- **License correctness**: every catalog entry carries its license
  (`OFL` / `APACHE2` / `UFL`), the data is sourced at build time from
  the authoritative `google/fonts` repo, and embedded fonts ship their
  license texts.
- **Export parity**: PDF (and later PPTX) export embeds any used Google
  Font, not just Noto KR.

### Non-Goals

- **User-uploaded brand fonts** (Canva Brand Kit style). Deferred — it
  introduces a license-attestation flow we do not need while we stay
  inside Google Fonts. Noted as a future phase only.
- **Self-hosting the font files.** We keep using the Google Fonts CSS
  API for on-screen serving. Self-hosting is revisited only if CSP /
  offline requirements force it.
- **Variable-font axis UI** (weight/optical-size sliders). Out of scope;
  we keep the current bold/regular weight model.
- Changing the Canvas text rendering or `resolveFontFamily` fallback
  semantics beyond what lazy loading requires.

## Proposal Details

### Background: how fonts flow today

| Concern | Current implementation | File |
| --- | --- | --- |
| Catalog | Hardcoded `FONT_CATALOG` (19 entries) | `font-catalog.ts:35` |
| Bootstrap load | One Google Fonts CSS `<link>` built from the whole catalog | `buildGoogleFontsHref()` `font-catalog.ts:75` |
| Runtime load | `FontRegistry.ensureFont()` → `document.fonts.load()` → re-layout | `fonts.ts:293` |
| Fallback chain | `resolveFontFamily()` maps family → CSS stack, injects Noto KR for Hangul | `fonts.ts:219` |
| Prefetch | Picker item `onPointerEnter` → `onPrefetch` | `font-family-picker.tsx:120` |
| PDF embed | Noto KR Subset OTF from jsdelivr, fontkit subsets at embed time | `pdf-fonts.ts:106` |

The two structural limits: (1) **the catalog is a closed hardcoded
list** and (2) **the bootstrap loads the whole catalog in one CSS
request** — the file's own comment notes v1 deliberately stays "under
one network request." Both must change for rich fonts.

### License model (why "everything in Google Fonts is usable")

Every family served by Google Fonts is licensed under exactly one of
three open licenses — Google filters at intake:

| License | Share | Commercial | Web serve | Doc embed (PDF/PPTX) |
| --- | --- | --- | --- | --- |
| **OFL** (SIL Open Font License) | ~99% | ✅ | ✅ | ✅ explicit |
| **Apache 2.0** | small (Roboto family etc.) | ✅ | ✅ | ✅ |
| **UFL** (Ubuntu Font License) | tiny (Ubuntu family) | ✅ | ✅ | ✅ |

All three permit commercial use with **no attribution requirement** and
**explicitly permit embedding into documents** (OFL FAQ: embedding a
font in a document is not "redistribution of the font software"). So
there is no "forbidden" font inside Google Fonts — the only obligations
arise when we **ship font bytes** (export embed / bundling):

1. **Carry the license text** with embedded/bundled fonts. Satisfied by
   an in-app open-source notices page collecting per-license texts.
2. **OFL Reserved Font Name (RFN)**: a subset is a "modified" font;
   don't redistribute it under the original name. PDF/PPTX subset
   embedding is standard industry practice and is internal to the
   exported file — we just must not re-publish the subset as a named
   font.

#### Identifying a font's license programmatically

The official `googleapis.com/webfonts/v1` REST API **does not expose a
license field** (confirmed: it returns
`family/variants/subsets/files/category/menu/axes/lastModified` only).
The authoritative source is the **`google/fonts` GitHub repo**:

- Top-level directory = license: `ofl/`, `apache/`, `ufl/`.
- Each family folder has a `METADATA.pb` with `license: "OFL"`.

So license must be captured at **build time** from the repo metadata,
not at runtime from the API. The `fontsource/google-font-metadata` npm
package aggregates this into JSON and is a convenient build input.

### Catalog: hardcoded list → generated data

Replace the hand-maintained `FONT_CATALOG` array with a
**build-time-generated catalog** committed to the repo as JSON.

```ts
interface FontCatalogEntry {
  family: string;             // canonical Google Fonts family
  label?: string;             // localized display label (e.g. '나눔고딕')
  category: FontGroup;        // Korean | Sans-serif | Serif | Monospace | Display | Handwriting
  scripts: string[];          // Google "subsets": 'latin', 'korean', ...
  weights: string;            // wght axis values, e.g. '400;700'
  license: 'OFL' | 'APACHE2' | 'UFL';
  popularity: number;         // for default sort
  curated: boolean;           // true → shown in the dropdown menu
}
```

A generator script (`scripts/build-font-catalog.ts`, run on demand —
**not** at every build, to keep the catalog deterministic and
reviewable) reads `google/fonts` metadata + `fontsource/google-font-metadata`
and emits:

- `font-catalog.curated.json` — ~100 families with `curated: true`
  (Korean body + display, popular Latin sans/serif/mono).
- `font-catalog.full.json` — full library, consumed only by the "More
  fonts…" dialog (lazy-imported so the editor bundle isn't bloated).

`font-catalog.ts` keeps its existing **named exports and types** (the
`value: string` contract, `FONT_SIZE_PRESETS`, etc.) so call sites don't
change; only the data source becomes the generated JSON.

### Loading model: bootstrap-all → per-font lazy

Generalize the bootstrap injector into a **per-family** loader.

- Keep injecting **one CSS `<link>` for the curated-menu web fonts** at
  view mount (today's `useGoogleFontsLink`), so the dropdown previews
  are instant.
- Add `ensureFontLink(family, weights)` that injects a **per-family CSS
  `<link>`** the first time a non-curated family is needed (selection,
  picker hover, or in-view preview in the dialog). Idempotent + id-keyed
  per family, mirroring the existing `ensureGoogleFontsLink` guard.
- `FontRegistry.ensureFont()` is unchanged — it already does
  `document.fonts.load()` + re-layout notification; the only addition is
  that the CSS `<link>` for that family must be present first, which
  `ensureFontLink` guarantees.
- FOUT is handled as today via `display=swap`; the re-layout listener
  repaints the Canvas when the real face resolves.

### UX: "More fonts…" dialog + recent / in-use

`font-family-picker.tsx` keeps its grouped dropdown of **curated +
in-use + recent** families, and gains a **"More fonts…"** item at the
bottom that opens a dialog:

- **Search** box (debounced) over the full catalog.
- **Category** and **script** (Korean / Latin / …) filters.
- **Virtualized list** (windowed) so 1,800 rows stay smooth; each
  visible row previews in its own family via an `IntersectionObserver`
  that calls `ensureFontLink` only for on-screen rows.
- Selecting a font adds it to the document's **used-fonts** set and the
  user's **recent** list, so it surfaces in the dropdown next time.

**Where the used-fonts set lives:** persist per presentation in the
Yorkie doc (a `usedFonts: string[]` on the presentation/meta object) so
collaborators and the export path see the same set. "Recent" is a local
(user-level) list in `localStorage`. The slides surface wires this
through `SlidesView`; Docs reuses the same shared dialog.

### Export: license-aware embedding

`pdf-fonts.ts` today hardcodes four Noto KR URLs in `DEFAULT_URLS`.
Generalize to resolve **any used Google Font** to its TTF:

- Add a resolver that, given a family + weight, returns the
  `github.com/google/fonts/raw/main/<license>/<family>/...ttf` URL (or
  a jsdelivr mirror), pinned to a commit for reproducibility — same
  pattern as the current tag-pinned Noto URLs.
- Reuse the existing IndexedDB cache + fontkit subsetting so each used
  family is fetched once and subset-embedded.
- Collect the license of every embedded family and surface it on the
  in-app **open-source notices** page (and, for PPTX later, embed per
  OOXML font-embedding rules).

This phase is what makes the richness *real* — without it, a deck using
a fancy font would export with a fallback face. P0–P2 (on-screen) and
this embed path must be designed together.

### Phased rollout

| Phase | Scope | Primary files |
| --- | --- | --- |
| **P0** | Generated curated catalog (~100) with `license` field; per-family lazy `ensureFontLink`; bootstrap loads curated menu only | `scripts/build-font-catalog.ts`, `font-catalog.ts`, `fonts.ts` |
| **P1** | "More fonts…" dialog: search + category/script filters + virtualized in-view previews; recent + per-doc used-fonts persistence | new dialog component, `font-family-picker.tsx`, `SlidesView`, Yorkie meta |
| **P2** | Full ~1,800 library in the dialog (lazy-imported `font-catalog.full.json`) | dialog data source |
| **P3** | Export embed for arbitrary Google Fonts + open-source notices page; PPTX font embedding | `pdf-fonts.ts`, export paths, notices page |
| **P4 (deferred)** | User-uploaded brand fonts + license attestation | out of scope here |

### Risks and Mitigation

- **Bundle bloat from the full catalog.** Mitigation: only the curated
  JSON is in the editor bundle; `font-catalog.full.json` is
  dynamic-imported by the dialog and counts against the chunk gate
  (`harness.config.json`) separately.
- **Third-party request volume / CSP.** Per-font `<link>`s multiply
  requests; mitigate with preconnect (already present), `display=swap`,
  in-view-only preview loading, and dedup via the id-keyed guard. CSP
  must allow `fonts.googleapis.com` / `fonts.gstatic.com` (already
  whitelisted for the existing link).
- **Export embed misses a glyph / wrong weight.** Reuse the proven Noto
  KR subset+IndexedDB path; pin URLs to a commit; fall back to the
  current Noto/standard faces when a family fails to fetch (never block
  export).
- **License drift.** The catalog is regenerated from `google/fonts`
  on demand and committed, so license values are reviewable in PRs
  rather than silently changing at runtime.
- **RFN on subset embedding.** We embed subsets internally in the
  exported document and never republish them as named fonts, which is
  the accepted OFL-compatible practice.
- **Catalog staleness.** Acceptable — the curated list changes rarely;
  the generator is re-run when we want to refresh, and the full library
  is fetched fresh enough via the dialog's data source.
