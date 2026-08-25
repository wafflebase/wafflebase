---
title: slides-fonts
target-version: 0.4.6
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Rich Fonts

## Summary

The font picker used to be a closed, hardcoded list of ~19 families
loaded as a **single Google Fonts CSS `<link>` at bootstrap** — fine for
a small curated set but not the rich font experience users expect from
Google Slides / Canva (hundreds to thousands of families, searchable,
previewed in-place).

That rich-fonts system is now **shipped** (P0–P2). The catalog is a
**build-time-generated data file** (`font-catalog.data.ts`, ~105 curated
entries) with **per-font lazy loading** (`ensureFontLink`), a
**"More fonts…" search dialog** over the full ~1,900-family Google Fonts
library (`font-catalog.full.ts`, dynamic-imported), and a per-browser
**recent-fonts** list. On the export side, **license-aware embedding is
partly shipped** (P3-a: Docs PDF embeds curated Google Fonts); a
per-presentation used-fonts set, license-notices page, and PPTX
embedding remain (see the Phased rollout table).

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
- **License correctness**: every **web-font** catalog entry carries its
  license (`OFL` / `APACHE2` / `UFL`) — the non-web system faces
  (`webFont: false`, e.g. Arial/Times New Roman) omit it since we never
  embed their bytes. The data is sourced at build time from the
  authoritative `google/fonts` repo, and embedded fonts ship their
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
| Catalog | Generated `FONT_CATALOG = FONT_CATALOG_DATA` (~105 entries, with `license`/`eager`) | `font-catalog.ts:66`, `font-catalog.data.ts` |
| Full library | ~1,900-family `FONT_CATALOG_FULL`, dynamic-imported for the dialog | `font-catalog.full.ts`, `font-catalog-full-loader.ts` |
| Bootstrap load | One Google Fonts CSS `<link>` built from the **`eager`** entries only | `buildGoogleFontsHref()` `font-catalog.ts:102` |
| Lazy load | `ensureFontLink(family, weights)` injects a per-family CSS `<link>` on demand | `font-catalog.ts:142` |
| Runtime load | `FontRegistry.ensureFont()` → `document.fonts.load()` → re-layout | `fonts.ts` |
| Fallback chain | `resolveFontFamily()` maps family → CSS stack, injects Noto KR for Hangul | `fonts.ts` |
| Prefetch | Picker item `onPointerEnter` → `onPrefetch` → `ensureFontLink` | `font-family-picker.tsx` |
| PDF embed | Curated Google Fonts subset-embedded (P3-a); Noto KR + arbitrary curated families | `pdf-fonts.ts`, `pdf-painter.ts` |

The two original structural limits — a **closed hardcoded catalog** and a
**bootstrap that loaded the whole catalog in one CSS request** — have both
been removed: the catalog is generated data, and the bootstrap link now
covers only the small `eager` set while the long tail lazy-loads via
`ensureFontLink`.

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

The hand-maintained `FONT_CATALOG` array was **replaced by
build-time-generated data** committed to the repo as a TS module. The
shipped entry shape (`FontEntry` in `font-catalog.ts`) is:

```ts
export interface FontEntry {
  label: string;              // display label (e.g. '나눔고딕')
  family: string;             // canonical Google Fonts family
  group: FontGroup;           // Korean | Sans-serif | Serif | Monospace | Display | Handwriting
  webFont: boolean;           // Google Fonts face (needs a CSS link) vs local/system
  weights?: string;           // wght axis values, e.g. '400;700' (default '400;700')
  license?: 'OFL' | 'APACHE2' | 'UFL';   // web-font entries only; omitted for system faces
  scripts?: string[];         // Google "subsets": 'latin', 'korean', ...
  eager?: boolean;            // true → loaded in the bootstrap CSS link
}
```

`license` is optional: the ~10 non-web system faces (`webFont: false`)
carry no license value because we never ship their bytes; only the
embeddable web-font entries are guaranteed to carry one of the three
licenses.

Generator scripts under `packages/frontend/scripts/` (run on demand —
**not** at every build, to keep the catalog deterministic and
reviewable) read `google/fonts` metadata and emit committed TS modules:

- `build-font-catalog.mjs` → `font-catalog.data.ts` (`FONT_CATALOG_DATA`,
  ~105 curated entries: Korean body + display, popular Latin sans/serif/mono,
  plus non-web system faces).
- `build-font-catalog-full.mjs` → `font-catalog.full.ts`
  (`FONT_CATALOG_FULL`, the full ~1,900-family library), consumed only by
  the "More fonts…" dialog via a dynamic import so the editor bundle isn't
  bloated.
- `build-font-files.mjs` → `font-files.data.ts` (per-family gstatic TTF
  URLs) for the PDF export-embed path.

`font-catalog.ts` keeps its existing **named exports and types** (the
`value: string` picker contract, `FONT_SIZE_PRESETS`, etc.) so call sites
don't change; only the data source is now the generated module
(`FONT_CATALOG = FONT_CATALOG_DATA`).

### Loading model: bootstrap-all → per-font lazy

The bootstrap injector was generalized into a **per-family** loader
(shipped):

- `useGoogleFontsLink` / `ensureGoogleFontsLink` still inject **one CSS
  `<link>` at view mount**, but `buildGoogleFontsHref()` now builds it
  from the **`eager`** web fonts only (the small set existing documents
  render with), not the whole catalog — so the dropdown previews are
  instant while the bootstrap request stays small.
- `ensureFontLink(family, weights)` injects a **per-family CSS `<link>`**
  the first time a non-eager family is *applied* — selection, or picker
  hover as a prefetch. It no-ops for system faces (`webFont: false`), for
  `eager` fonts already in the bootstrap link, and when a link for that
  family already exists; the DOM (`data-wafflebase-font` attribute), not
  module state, is the idempotency source so it survives HMR. It is wired
  into both editors' pickers and toolbars (Docs and Slides).
- `ensurePreviewFontLink(family, text, weights)` is the **preview**
  counterpart, and the one an in-view row calls. Merely painting a label
  needs a handful of glyphs, so it requests exactly those via the css2
  `&text=` parameter and exactly one weight (`previewWeight` — the family's
  *first* cut, never a hardcoded 400, because a family that ships no 400
  answers HTTP 400 and strands the row in a fallback face). Its links carry
  `data-wafflebase-font-preview`, a deliberately different marker from
  `data-wafflebase-font`, so a subset can never be mistaken for a full load
  and applying a previewed family still fetches the whole thing.
  - It also refuses to inject when the family is **already loaded in full by
    any stylesheet in the document** — including
    `packages/frontend/index.html`'s own app-shell link (`Inter`,
    `Fraunces`, `JetBrains Mono`), which no catalog flag describes. A
    `&text=` response has no `unicode-range`, so declared later it wins the
    cascade for every codepoint and would *remove* glyphs from a face that
    already had them.
  - A row whose weights are unknown does not preview yet: the picker's
    Recent section can name a family from the full library that the curated
    catalog has no entry for, so it pulls `loadFullFontCatalog()` and holds
    the row back until the weights resolve (or the load fails).
- `FontRegistry.ensureFont()` is unchanged — it already does
  `document.fonts.load()` + re-layout notification; the only addition is
  that the CSS `<link>` for that family must be present first, which
  `ensureFontLink` guarantees.
- FOUT is handled via `display=swap`; the re-layout listener repaints the
  Canvas when the real face resolves.

### UX: "More fonts…" dialog + recent / in-use

`font-family-picker.tsx` keeps its grouped dropdown of **curated +
recent** families, and has a **"More fonts…"** item at the bottom that
opens `MoreFontsDialog` (`more-fonts-dialog.tsx`, shipped):

- **Search** box over the full catalog.
- **Category** and **script** (Korean / Latin / …) filters
  (`more-fonts-filter.ts`: `FontCategoryFilter` / `FontScriptFilter`).
- Each visible row previews in its own family via an `IntersectionObserver`
  that calls `ensurePreviewFontLink` only for on-screen rows — so a row
  costs its own glyphs at one weight, not the family's whole character set.
- The dialog lazy-loads the full library through `loadFullFontCatalog()`
  (a memoized dynamic import of `font-catalog.full.ts`).
- Selecting a font adds it to the user's **recent** list, so it surfaces
  in the dropdown next time.

**Where the recent list lives:** "Recent" is a per-browser list in
`localStorage` (`font-recents.ts`: `getRecentFonts` / `addRecentFont`,
capped at `RECENT_FONTS_MAX`). The same shared dialog is reused by both
Docs and Slides.

> **Not yet built:** the originally-planned **per-presentation used-fonts
> set** (a `usedFonts: string[]` persisted on the Yorkie presentation/meta
> object, shared by collaborators and the export path) is not implemented —
> no such field exists. Only the local `localStorage` recents shipped.

### Export: license-aware embedding

**Status: P3-a shipped (Docs PDF).** Curated Google Fonts now embed their
real face in Docs PDF export. The frontend injects a `fontResolver`
(`PdfExportOptions.fontResolver`) backed by the generated
`font-files.data.ts` (per-family version-pinned gstatic TTF URLs from
`scripts/build-font-files.mjs`); `pdf-fonts.ts` `scanFontsUsed` collects
the curated families used on Latin text and `pdf-painter.ts`
`embedAllFonts` subset-embeds regular + bold (italic via oblique shim).
Scope is the curated catalog only; full-library picks and system fonts
fall back to Helvetica/Times. Slides PDF export is raster, so it embeds
nothing. License notices (P3-b) and PPTX embedding (P3-c) remain. See
[`docs/design/docs/docs-pdf-export.md`](../docs/docs-pdf-export.md).

How it shipped: `pdf-fonts.ts` historically hardcoded four Noto KR URLs
in `DEFAULT_URLS`. P3-a generalized that to resolve **any curated Google
Font** to its TTF via the generated
`packages/frontend/src/components/text-formatting/font-files.data.ts` —
per-family version-pinned `fonts.gstatic.com` static URLs (regular + bold),
not GitHub/jsdelivr raw paths. The existing IndexedDB cache + fontkit
subsetting is reused, so each used family is fetched once and
subset-embedded.

Remaining work: collect the license of every embedded family and surface
it on the in-app **open-source notices** page (P3-b), and — for PPTX
(P3-c) — embed per OOXML font-embedding rules. Without the embed path a
deck using a fancy font would export with a fallback face, so P0–P2
(on-screen) and this embed path were designed together.

### Phased rollout

| Phase | Status | Scope | Primary files |
| --- | --- | --- | --- |
| **P0** | ✅ Shipped | Generated curated catalog (~105) with `license`/`eager` fields; per-family lazy `ensureFontLink`; bootstrap loads `eager` set only | `scripts/build-font-catalog.mjs`, `font-catalog.data.ts`, `font-catalog.ts`, `fonts.ts` |
| **P1** | ✅ Shipped (used-fonts set deferred) | "More fonts…" dialog: search + category/script filters + in-view `IntersectionObserver` previews; `localStorage` recents. Per-doc used-fonts Yorkie persistence **not built**. | `more-fonts-dialog.tsx`, `more-fonts-filter.ts`, `font-recents.ts`, `font-family-picker.tsx` |
| **P2** | ✅ Shipped | Full ~1,900 library in the dialog (dynamic-imported `font-catalog.full.ts` via `loadFullFontCatalog`) | `font-catalog.full.ts`, `font-catalog-full-loader.ts` |
| **P3** | ◐ Partial (P3-a shipped) | Export embed for curated Google Fonts (Docs PDF, P3-a). Open-source notices page (P3-b) + PPTX embedding (P3-c) remain. | `pdf-fonts.ts`, `pdf-painter.ts`, `font-files.data.ts`, `scripts/build-font-files.mjs` |
| **P4 (deferred)** | Deferred | User-uploaded brand fonts + license attestation | out of scope here |

### Risks and Mitigation

- **Bundle bloat from the full catalog.** Mitigation: only the curated
  JSON is in the editor bundle; `packages/frontend/src/components/text-formatting/font-catalog.full.ts` is
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
