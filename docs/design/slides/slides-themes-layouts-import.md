---
title: slides-themes-layouts-import
target-version: 0.4.0
---

# Slides Themes, Layouts, and PPTX Import

## Summary

Bring the `@wafflebase/slides` package up to **Google Slides** parity in
three pillars:

1. **Themes** — color scheme + font scheme + master + layouts as a single
   swappable bundle, applied across the whole deck.
2. **Layouts** — eleven built-in layouts (Title slide, Section header,
   Title and body, Title and two columns, Title only, One column text,
   Main point, Section title and description, Caption, Big number, Blank)
   matching Google Slides' standard set.
3. **PPTX best-effort import** — accept `.pptx` upload, map the OOXML
   theme / master / layout / slide hierarchy onto the new model, fall
   back gracefully for tables, groups, and unsupported shapes.

The work is delivered as **three PRs** organized by user-visible value
units, not by implementation layer:

- **PR1 (Themed authoring)** — theme + 11 layouts + themed color/font
  pickers. New decks become noticeably better.
- **PR2 (Import existing deck)** — PPTX importer (UI + CLI).
- **PR3 (Customize the theme)** — Theme builder mode (View → Theme
  builder), edit master/layout colors, fonts, placeholder positions.

PR3 is deferrable to v1.5 if the five built-in themes prove sufficient.

### Goals

- Match the **mental model** of Google Slides: Theme→Master→Layout→Slide
  4-tier inheritance, hybrid color binding (theme role *or* concrete
  hex), 11 built-in layouts.
- Ship a **theme picker** + **5 built-in themes** (Simple Light, Simple
  Dark, Streamline, Focus, Material) so a user can re-skin a deck in one
  click.
- Make color and font pickers **theme-aware**: top row of color picker
  shows the 12 theme swatches; font picker has a "Theme fonts" section
  showing the current heading + body fonts.
- Import a 36-slide real-world PPTX (the Yorkie 캐즘 deck used as the
  benchmark for this work) with text, images, and simple shapes intact;
  surface fallbacks for tables, groups, and unsupported shapes via a
  single non-blocking toast.
- **Zero visual regression** on existing v1 decks. Migration is
  read-time, idempotent, and persists on the next write.
- Keep `@wafflebase/slides` as a pure domain library — UI lives in
  `frontend`, parser is pure TS and runs client-side.

### Non-Goals

- **PPTX export** — out of scope. PDF export remains the only export
  format. PPTX export is on the v2 backlog (see `slides.md`).
- **Animations / transitions** — still out of scope; PPTX
  `<p:transition>` and `<p:timing>` are stripped on import.
- **Embedded fonts** in PPTX (`.fntdata`) — ignored. Fallback uses our
  existing font registry plus Noto Sans KR for Hangul.
- **Group elements as a first-class kind** — still v2. PPTX `<p:grpSp>`
  is flattened on import (children's frames composed with the group
  transform).
- **Theme builder editing static elements on master/layout** — v1 limits
  master/layout editing to colors, fonts, and placeholder positions.
  Adding/removing static elements (logo bars etc.) on the master is
  v1.5.
- **Server-side import** — the parser runs in the browser. Files larger
  than ~50 MB or that fail in the browser are not auto-routed to a
  backend importer in v1.
- **Shape library expansion beyond rect/ellipse/line/arrow/roundRect** —
  v2 work. Unsupported PPTX shapes become a placeholder rect on import.

## Proposal Details

### Data model — 4-tier hierarchy

Mirror the OOXML / Google Slides hierarchy so that PPTX import is
mechanical and the user mental model is unchanged.

```
Theme
 ├─ ColorScheme (12 slots)
 ├─ FontScheme  (heading + body)
 └─ Master      (1 per deck)
       ├─ background
       ├─ placeholderStyles { title, body, … }
       └─ Layouts (many; e.g. Title slide, Section header, …)
              ├─ background?  (overrides master)
              ├─ placeholders (positions + per-placeholder style overrides)
              └─ staticElements (logos, decorative shapes — v1.5)

Slide
 ├─ layoutId   (selects one Layout under the deck's Master)
 ├─ background?  (overrides Layout/Master)
 ├─ elements   (the user's content; can override placeholder content)
 └─ notes
```

```ts
type SlidesDocument = {
  meta: { title: string; themeId: string; masterId: string };
  themes: Theme[];          // usually 1 active + (post-import) imported theme
  masters: Master[];        // usually 1
  layouts: Layout[];        // usually 11 (built-in) + imported layouts
  slides: Slide[];
};

type Theme = {
  id: string;
  name: string;
  colors: ColorScheme;
  fonts: FontScheme;
};

type ColorScheme = {
  text: string;            // dk1
  background: string;      // lt1
  textSecondary: string;   // dk2
  backgroundAlt: string;   // lt2
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hyperlink: string;
  visitedHyperlink: string;
};

type FontScheme = {
  heading: string;   // majorFont
  body: string;      // minorFont
};

type Master = {
  id: string;
  themeId: string;
  background: Background;
  placeholderStyles: {
    title: PlaceholderStyle;
    body: PlaceholderStyle;
    [key: string]: PlaceholderStyle; // e.g. 'subtitle', 'caption'
  };
};

type PlaceholderStyle = {
  fontRole: 'heading' | 'body';
  fontSize: number;
  colorRole: keyof ColorScheme;
  align: 'left' | 'center' | 'right';
  // additional per-style attributes (line height, letter spacing) added as needed
};

type Layout = {
  id: string;
  masterId: string;
  name: string;
  background?: Background;
  placeholders: PlaceholderSpec[];
  staticElements: Element[]; // v1: empty array; v1.5 allows masters/layouts to add static
};
```

### ColorScheme rationale

Twelve slots match OOXML one-to-one, so PPTX import preserves the deck
author's intent. Google Slides' picker exposes the same twelve. The UI
groups them as: **Text** (text, background, textSecondary, backgroundAlt
— shown subdued), **Accents** (accent1–6 — main row), **Links**
(hyperlink, visitedHyperlink — shown only when a hyperlink is selected).

### Hybrid color binding (`ThemeColor`)

Element-level colors store either a *theme role* or a *concrete hex*:

```ts
type ThemeColor =
  | { kind: 'role'; role: keyof ColorScheme; tint?: number; shade?: number }
  | { kind: 'srgb'; value: string };

type ThemeFont =
  | { kind: 'role'; role: 'heading' | 'body' }
  | { kind: 'family'; family: string };
```

- Picking a swatch from the **Theme** row of the color picker stores
  `{ kind: 'role', role: 'accent1' }`. Switching the deck's theme then
  re-renders that element with the new theme's `accent1`.
- Typing a hex in **Custom** stores `{ kind: 'srgb', value: '#FF9900' }`.
  Theme switches do not affect this element.
- `tint` / `shade` are imported from PPTX (`<a:tint val="50000"/>`) but
  not editable in the v1 UI. They are applied at resolve time.

`resolveColor(themeColor: ThemeColor, theme: Theme): string` and
`resolveFont(themeFont: ThemeFont, theme: Theme): string` are the only
APIs the renderer calls. Every existing `ctx.fillStyle = ...` and
`font: ...` in `view/canvas/*.ts` is routed through these resolvers.

### Element-level changes

The `string` color fields in existing element types become `ThemeColor`:

- `ShapeElement.fill`, `ShapeElement.stroke.color`
- `Background.fill` (slide / master / layout)
- Through the docs ripple (below): `Block.style.color`,
  `Inline.style.color` inside `TextElement.data.blocks`

`BUILT_IN_LAYOUTS` placeholders gain a `style?: Partial<PlaceholderStyle>`
override slot. Empty for the existing three; populated for the new
eight.

### docs package ripple

Slides text reuses docs `Block` / `Inline` shapes. To support theme
binding on text color, `@wafflebase/docs` extends `Block.style.color`
and `Inline.style.color` to `string | ThemeColor`.

- The change is **additive**. Existing `string` callers (sheets formula
  cells, docs editor, all current consumers) keep working.
- A helper `wrapLegacyColor(c: string | ThemeColor): ThemeColor` is
  added to docs and used at the slides/docs boundary.
- docs renderer is unchanged in v1: it resolves `ThemeColor` through a
  trivial fallback (`{ kind: 'srgb' }` returns hex; `{ kind: 'role' }`
  returns a passed-in palette or a sensible default). When docs gains
  themes (out of scope), it'll wire its own resolver.

This is option (a) from brainstorming: docs absorbs the type widening.
It avoids a parallel "theme overlay" map in slides and keeps a single
source of truth.

### Built-in themes (5)

`packages/slides/src/themes/` — each theme is a TS module exporting a
`Theme` literal. Five themes ship in PR1:

| id | name | character |
|---|---|---|
| `default-light` | Simple Light | Inter; black-on-white; restrained accents. Reproduces the v1 visual baseline byte-for-byte. |
| `default-dark` | Simple Dark | Inter; white-on-near-black. |
| `streamline` | Streamline | Roboto + Roboto; neutral grays + blue accent. |
| `focus` | Focus | Lora (heading) + Inter (body); cream background; warm accents. |
| `material` | Material | Roboto + Roboto; Material color palette (M2). |

Korean fallback is reused from docs (Noto Sans KR). Each theme exports
both a TS literal and a CSS variables map for use in non-canvas UI
(theme picker thumbnails, color swatches in pickers).

### Built-in layouts (11)

`packages/slides/src/model/layout.ts` defines:

| id | name | placeholders |
|---|---|---|
| `blank` | Blank | (none) |
| `title-slide` | Title slide | center-title (large) + subtitle |
| `section-header` | Section header | left-aligned big title |
| `title-body` | Title and body | top title + body |
| `title-two-columns` | Title and two columns | title + left body + right body |
| `title-only` | Title only | top title |
| `one-column-text` | One column text | full-width body (no title) |
| `main-point` | Main point | center single line, very large |
| `section-title-description` | Section title and description | big title + paragraph |
| `caption` | Caption | image placeholder + caption text |
| `big-number` | Big number | center number (huge) + caption |

Existing v1 IDs (`blank`, `title`, `title-body`) map as: `blank` → kept,
`title` → `title-slide`, `title-body` → `title-body` (kept). Existing
decks using `title` are remapped on first load.

### Theme picker UI (PR1)

A "Theme" button on the right side of the top toolbar opens a
right-docked side panel (Google Slides parity):

```
┌─ Theme panel (right dock) ─────────────────┐
│ Current: Simple Light                      │
│                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐                │
│  │ aA   │ │ aA   │ │ aA   │   thumbnails  │
│  │light │ │ dark │ │stream│   (160×90 SVG)│
│  └──────┘ └──────┘ └──────┘                │
│  ┌──────┐ ┌──────┐                         │
│  │ aA   │ │ aA   │                         │
│  │focus │ │matrl │                         │
│  └──────┘ └──────┘                         │
│                                            │
│  [ Apply to all slides ]                   │
└────────────────────────────────────────────┘
```

Apply commits via `store.batch` so theme switching is a single undo
step. Per-slide theme override is **not** in v1 (Google Slides also
makes this awkward; YAGNI).

### Themed color and font pickers (PR1)

The existing color and font pickers in the contextual toolbar gain a
**Theme** section at the top:

- Color picker: top row shows 12 swatches (text, background, …,
  accent1–6, hyperlink, visitedHyperlink). Click stores
  `{ kind: 'role' }`. The custom hex input below stores
  `{ kind: 'srgb' }`.
- Font picker: a "Theme fonts" section above the global font list,
  showing the heading and body family names. Click stores
  `{ kind: 'role' }`.

Selected role swatches are visually marked (small dot) so the user can
tell role-bound colors from concrete ones.

### PPTX best-effort import (PR2)

#### Pipeline

```
file.pptx
  └─► fflate (unzip)
        └─► fast-xml-parser (each XML → JS tree)
              ├─► theme[].xml         → Theme
              ├─► slideMaster1.xml    → Master
              ├─► slideLayoutN.xml    → Layout (×11+ from PPTX)
              └─► slideN.xml          → Slide + Element[]
        └─► media/*.{png,jpg,gif}
              └─► workspace image API upload → URL
```

#### Module layout

```
packages/slides/src/import/pptx/
├── index.ts          # importPptx(buffer): SlidesDocument
├── unzip.ts          # jszip wrapper
├── xml.ts            # XML parser wrapper, namespace handling
├── theme.ts          # parseTheme    → Theme
├── master.ts         # parseMaster   → Master
├── layout.ts         # parseLayout   → Layout
├── slide.ts          # parseSlide    → Slide
├── shape.ts          # sp/pic/cxnSp/grpSp dispatcher
├── geometry.ts       # EMU↔px, prst preset → ShapeKind
├── color.ts          # schemeClr/srgbClr/sysClr/prstClr → ThemeColor
└── font.ts           # typeface lookup + Hangul fallback
```

Dependency reuse: `jszip` is already in `@wafflebase/docs` (DOCX
import); reuse it for unzip. `@xmldom/xmldom` is already in
`@wafflebase/cli`; reuse it for XML parsing unless a measurable
ergonomics or size win justifies adding `fast-xml-parser`. The default
choice is **reuse existing**.

#### Mapping table

| OOXML | Mapping | Faithfulness |
|---|---|---|
| `<p:sp txBox="1">` | TextElement | ✅ |
| `<p:pic>` | ImageElement (after upload) | ✅ |
| `<p:sp>` `prst="rect"\|"ellipse"\|"line"` | ShapeElement | ✅ |
| `<p:sp>` `prst="roundRect"` | ShapeElement (kind: 'roundRect') | ✅ (new shape kind) |
| `<p:sp>` other `prst` (chevron, donut, blockArc, can, uturnArrow, …) | ShapeElement rect placeholder; toast warns. v2 expands shape library | ⚠️ |
| `<p:cxnSp>` | ShapeElement (line/arrow) | ✅ |
| `<p:grpSp>` | Flatten: child frames composed with group transform | ⚠️ (group lost) |
| `<p:graphicFrame><a:tbl>` | Matrix of TextElements + border ShapeElements per cell | ⚠️ (until docs-tables integration in v1.5) |
| `<p:sp>` with `<a:blipFill>` | ImageElement (shape `xfrm` → frame); full-bleed template visuals built as `custGeom`/`prstGeom` + blip | ✅ (non-rect freeform clip path lost) |
| `<a:blipFill>` `<a:srcRect>` | source crop → `ImageElement.data.crop` | ✅ |
| `<a:blipFill>` `<a:stretch><a:fillRect>` (negative insets) | "Fill" / cover crop → equivalent `data.crop`. Cover case only; positive-inset letterbox falls back to full stretch; not composed with `srcRect` | ✅ |
| `<a:blip>` `alphaModFix` | `amt / 100_000` → `ImageElement.data.opacity` (clamped to `[0, 1]`; dropped at 1) | ✅ |
| `<a:blip>` recolor / duotone | dropped | ❌ |
| `frame.rotation` (`rot`) | EMU degrees → radians | ✅ |
| `<a:schemeClr>` | `ThemeColor { kind: 'role' }` | ✅ |
| `<a:srgbClr>` | `ThemeColor { kind: 'srgb' }` | ✅ |
| `<a:tint>` / `<a:shade>` | preserved on `ThemeColor`, applied at resolve | ✅ |
| `<a:fontScheme>` | FontScheme | ✅ |
| `<a:clrScheme>` | ColorScheme | ✅ |
| Slide master + layouts | Imported as a *new* Theme + Master + Layouts in the document. `meta.themeId` and `meta.masterId` switch to the imported pair so the deck renders with the original look. The five built-in themes remain available in the picker for re-skinning. | ✅ |
| `notesSlide*.xml` | Slide.notes (rich text) | ✅ |
| Slide transitions / animations | dropped silently | n/a |
| Embedded fonts (`ppt/fonts/*.fntdata`) | dropped; fallback to system fonts + Noto Sans KR | ⚠️ |

A single toast summarizes lossy elements: "Imported with N tables
flattened, M groups expanded, K shapes simplified."

#### Multi-master decks and layout-background inheritance (2026-07-10)

Real decks can carry **several slide masters**, each owning its own set
of layouts (e.g. the Naver deck: `slideMaster1` owns `slideLayout1–9`,
`slideMaster2` owns `slideLayout10–21`; slide 1 uses `slideLayout1`). The
importer walks **every** master in `<p:sldMasterIdLst>` order via
`orderedMasterTargets`, calling `loadMasterAndLayouts` per master and
merging all layouts + `layoutMap` entries. The **first** master in that
list is the *primary*: its color map, `<p:txStyles>`, background, and
`meta.masterId` drive the deck (our model still stores a single master).
Secondary masters contribute only their layouts, so every slide can
resolve the real layout it references. (Previously the importer loaded a
single master picked by rels-iteration order, silently dropping the other
master's layouts and their placeholder sizes / backgrounds — which is why
slide 1's background image went missing.)

PPTX background inheritance is **slide → layout → master**. The runtime
already resolves this at paint time (`resolveBackgroundFill` /
`resolveBackgroundImage`), but only the *fill* / master image cascade
faithfully because imported layouts **collapse onto the 11 built-in layout
ids** (many OOXML layouts → one id), making a per-layout-id background
ambiguous. So layout-level `<p:bg>` (a `blipFill` image such as slide 1's
bottom gradient, or an explicit `solidFill`) is parsed by `parseLayout`,
carried on `LayoutResolution.background` keyed by the **exact layout part
path**, and **baked onto each slide that has no `<p:bg>` of its own** in
`parseSlide` — unambiguous because the slide names its exact layout. A
baked image keeps the slide's `fill` as the inheritable `background` role
so theme fill changes still cascade; only the image is pinned. A
`<p:bgRef>` style-matrix reference (unhandled) or a bare role fill is left
off so it can't clobber the built-in layout it merges onto.

The same slide → layout inheritance applies to **placeholder geometry**. A
slide placeholder `<p:sp>` may omit its own `<p:spPr><a:xfrm>` and inherit
position + size from the matching layout placeholder (e.g. slide 1's "2026
년 3월" content placeholder `<p:ph idx="10"/>`, whose bottom-left frame lives
only on `slideLayout1`). `parseLayout` records each layout placeholder's
scaled frame in `LayoutResolution.placeholderFrames` (keyed
`"{ooxmlType}:{idx}"`, parallel to the existing `placeholderSizes` font-size
map), and `parseSp` (`resolvePlaceholderFrame`) fills in each axis the slide
omits from it: no `<a:xfrm>` at all inherits the whole layout frame, while a
partial override (offset-only or extent-only `<a:xfrm>`) keeps the slide's
value on the present axis and inherits the other — otherwise `parseXfrm`
collapses the missing axis to `0` (a top-left `(0,0,0,0)` box, or a zero-size
invisible one). (This too only surfaced once multi-master loading actually
imported `slideLayout1`.) Placeholder keys normalize OOXML type aliases
(`ctrTitle` → `title`) via `phKey` so a slide `<p:ph type="title"/>` inherits
a layout that stored its center title as `ctrTitle` (Google-Slides exports).

Known limitations of the collapse (acceptable for v1):

- **One color map for the whole deck.** All slides — and all baked layout
  backgrounds — resolve `<a:schemeClr>` through the *primary* master's
  `<p:clrMap>`. A secondary master whose `clrMap` remaps a scheme slot
  differently will render a `solidFill` layout background off by that slot.
  Image (`blipFill`) backgrounds are unaffected (no color resolution). The
  common case (the gradient here) is a `blipFill`.
- **Eager, per-layout background uploads.** Each layout's `<p:bg>` image is
  uploaded during import even if no slide references that layout, so a
  template-heavy deck can leave a few orphan image blobs. Bounded by the
  layout count; a lazy/at-bake upload pass is deferred.
- **Primary master = `<p:sldMasterIdLst>` first entry** (was: first
  `slideMaster` rel, which was iteration-order-dependent and picked the
  *wrong* master on this deck). Deterministic and matches PowerPoint's
  canonical primary.
- **An explicit layout `solidFill` of the `background` role (`schemeClr
  bg1`) is not baked.** A bare `background`-role fill is, by model
  definition (`isInheritableFill`), "inherit" — there is no way to mark
  "explicitly the background role, don't inherit" without a model change.
  In practice it resolves to the same theme background the master's `bgRef`
  would, so the visible result matches except in the rare case of a
  secondary master with a genuinely different (non-`bg1`) background.
- **`phKey` alias collision.** A single (non-conformant) layout declaring
  both `<p:ph type="title">` and `<p:ph type="ctrTitle">` at the same `idx`
  collapses to one key (last wins). Conformant decks never pair them; the
  alias is what lets the common title/ctrTitle mismatch inherit at all.

#### EMU and slide size

PPTX uses EMU (914 400 EMU = 1 inch). Our logical canvas is fixed at
1920×1080 px (16:9), defined as `SLIDE_WIDTH` / `SLIDE_HEIGHT` constants
in `packages/slides/src/model/presentation.ts`. The deck's own
`<p:sldSz cx cy>` is read at parse time and used to derive the scale:
`px_x = emu * 1920 / cx`, `px_y = emu * 1080 / cy`. Both common 16:9
PPTX sizes (standard 9 144 000 × 5 143 500 EMU = 10″×5.625″, and
widescreen 12 192 000 × 6 858 000 EMU = 13.333″×7.5″) map without
aspect distortion. Decks with non-16:9 aspect are imported scaled to
fit and a toast warns of the aspect change.

#### Yorkie 캐즘 deck — re-validated gap (2026-05-15)

After v0.4.0 shipped the 117-kind shape registry, first-class
connectors, 11 built-in layouts, and 4-tier theming, the benchmark deck
was re-inventoried against the actual current model. The gap is
significantly smaller than the original mapping table assumed.

**Inventory (36 slides, 16:9 standard 10″×5.625″, NOT widescreen):**

| OOXML element | Count | Notes |
|---|---|---|
| `<p:sp>` (shapes, all `prstGeom`, 0 `custGeom`) | 218 | 13 distinct kinds: rect, roundRect, ellipse, rtTriangle, chevron, blockArc, uturnArrow, flowChartOffpageConnector, rightArrowCallout, leftBracket, homePlate, donut, can — **all 13 already in `ShapeKind`** |
| `<p:pic>` | 63 | 25 unique media files (png/jpg/gif); 1 `srcRect` (crop), rest plain stretch |
| `<p:cxnSp>` | 51 | `curvedConnector2`(28) + `straightConnector1`(20) + `curvedConnector3`(3); `stCxn`/`endCxn` shape-anchored; 38 triangle arrowheads |
| `<p:grpSp>` | 48 | max nesting depth = 1 |
| `<p:graphicFrame><a:tbl>` | 7 | ~3×3, 0 cell merges |
| Animations / transitions / charts / SmartArt | 0 | none — all explicitly out of scope |
| `<a:highlight>` (text bg highlight) | 136 | **most frequent custom text effect in this deck** |
| `<a:hlinkClick>` (text hyperlink) | 31 | external URLs |
| `<a:normAutofit fontScale=...>` | many | shrink-to-fit on title boxes |
| `<a:outerShdw>` | 7 | drop shadow on shapes |
| Slide-level `<p:bg>` overrides | 4 | rest inherit master |
| Layouts referenced | tx(23), secHead(7), body(5), title(1) | all map to existing 11 built-ins |
| Theme | custom 12-color palette (`accent1=#058DC7` ...) | imported as a new `Theme` |
| Embedded fonts | Roboto, Roboto Thin/Medium, Nanum Gothic (14 `.fntdata`) | dropped, Noto Sans KR fallback |
| Notes | Korean text on nearly every slide | map to `Slide.notes` |

**Verified model support (file:line evidence in
`docs/tasks/active/`):**

| Feature in deck | Model has it? | Mapping |
|---|---|---|
| 13 distinct `prstGeom` kinds | ✅ all 13 in `ShapeKind` (`packages/slides/src/model/element.ts`) | direct preset → `kind` |
| `<a:highlight>` text bg | ✅ `Inline.style.backgroundColor` (`packages/docs/src/model/types.ts:123`) | direct |
| `<a:hlinkClick>` on text | ✅ `Inline.style.href` (`packages/docs/src/model/types.ts:126`) | resolve via slide `_rels` |
| `<a:schemeClr>` / `<a:srgbClr>` | ✅ `ThemeColor { kind: 'role' \| 'srgb' }` | direct |
| Connectors with shape anchors | ✅ `ConnectorElement` endpoint (`packages/slides/src/model/connector.ts`) | `stCxn id/idx` → `attached` endpoint |
| `curvedConnector2/3` | ✅ routing `'curved'` | direct |
| `straightConnector1` | ✅ routing `'straight'` | direct |
| Triangle arrowheads | ✅ 8 arrowhead kinds | direct |
| Slide-level background | ✅ `Slide.background` | direct |
| `<a:normAutofit>` (shrink-to-fit) | ❌ `TextElement.data` has only `blocks` — no autoFit field | **lossy:** pre-apply `fontScale` to each run's stored `fontSize` at parse time; the original is approximated, no live re-fit. Acceptable: shrink-to-fit only affects display, not content. |
| `<a:bodyPr anchor>` (vertical text anchor) | ✅ `TextElement.data.verticalAnchor` (`packages/slides/src/import/pptx/text.ts:detectVerticalAnchor`) | **paint offset:** rendered via `packages/slides/src/view/canvas/text-renderer.ts:computeVerticalOriginY` (mirrored in `packages/docs/src/view/text-box-editor.ts` for in-place edit parity). `t/ctr/b` map to `top/middle/bottom`; `just`/`dist` collapse to `top`; empty / absent → undefined (inherit). **Overflow:** middle/bottom keep the anchor relationship (text extends above the frame top) to match PowerPoint / Google Slides; use `<a:normAutofit>` (`autofit: 'shrink'`) to keep oversized content inside the frame. |
| `<a:outerShdw>` shape effects | ❌ `ShapeElement.data` has only `{kind, adjustments, fill, stroke}` | **drop**, 7 cases only; toast counts |
| Slide canvas size flexibility | ❌ `SLIDE_WIDTH/HEIGHT` are module constants in `presentation.ts:50-51`; `SlidesDocument` has no `canvasSize` field | **rescale** EMU→px using deck's own `<p:sldSz>` so geometry preserves at the deck's aspect; if aspect ≠ 16:9, fit + toast warning |

**Net result:** of the original mapping table's ⚠️/❌ rows, only 3
real model gaps remain for this deck (autoFit, shape shadow, dynamic
canvas size) — and all 3 have acceptable lossy fallbacks. The 117-kind
registry and first-class connectors absorb what the original v1 plan
called out as "shape placeholder" fallbacks. **No new model fields are
required to import this deck.**

**Revised PR2 scope adjustments:**

1. PR2 mapping table row "other `prst` → placeholder rect" is now
   stale. Replace with: "any `prst` whose name matches a registered
   `ShapeKind` → that `ShapeKind`; unknown `prst` (rare) →
   `rect` + toast." All 13 kinds in this deck hit the supported path.
2. PR2 mapping table row "roundRect → new shape kind" is stale —
   `roundRect` ships in v0.4.0. Drop the "new" note.
3. Add explicit rows for highlight, hyperlink, autoFit (lossy), and
   shape shadow (dropped). Include their counts in the post-import
   toast: "Imported with N tables flattened, M groups expanded, K
   shadows dropped, L text boxes pre-scaled."
4. Coordinate scaling reads `<p:sldSz>` per deck rather than hardcoding
   widescreen EMU.

#### UI / CLI surface

- **UI**: deck list page, primary action group gains
  "↑ Import .pptx" next to "+ New". Drag-drop `.pptx` onto the deck
  list also imports.
- **CLI**: `slides import <file.pptx> [--workspace <id>] [--title <name>]`
  follows the existing `docs import` shape. Creates a new deck and
  pushes the parsed document to Yorkie.
- **Backend**: no new endpoints. The importer runs in the browser; only
  image bytes are POSTed to the existing workspace `/images` API.

### Theme builder (PR3)

`View → Theme builder` enters a special editing mode. The thumbnail
panel switches to listing **layouts** (under the deck's master) instead
of slides. Clicking a layout edits it; clicking the master edits the
master. Edits propagate immediately to all slides using that layout (or
to all slides for master edits).

v1 editing surface:

- Master / layout colors and fonts (theme palette + role swatches in
  pickers behave the same as in slide editing)
- Placeholder positions (drag handles, same UX as slide elements)
- Master / layout background fill

Out of v1 scope (deferred to v1.5):

- Adding or removing static (non-placeholder) elements on the master or
  layout (e.g. a logo bar, a footer line)
- Reordering or renaming placeholders

#### Re-review (2026-06-25): cascade reality grounded in current code

The original PR3 plan assumed every builder edit "propagates immediately
to all slides." Investigating the shipped code (`store/memory.ts`,
`model/layout.ts`, `model/placeholder-blocks.ts`,
`view/canvas/slide-renderer.ts`) shows propagation splits into two
distinct mechanisms, which reshapes the commit plan:

| Builder edit | How it reaches existing slides today | PR3 work |
|---|---|---|
| Theme color (role-bound) | `resolveColor` runs at **render** against `doc.themes[meta.themeId]` → automatic on repaint | none — just `updateTheme` + repaint |
| Theme font (role-bound) | `resolveFont` at render → automatic | `updateTheme`; concrete `srgb`/`{kind:'family'}` runs and docs `InlineStyle.fontFamily: string` text do **not** follow (known limitation) |
| Master background fill | `slide-renderer` reads `master.background` at render → automatic | `updateMaster`; repaint only |
| Layout placeholder **position** | slide element `frame` is **copied** at slide-creation via `applyLayoutToSlide`; later layout edits do **not** move existing elements | explicit re-flow cascade required |
| Master placeholder **type style** (`fontSize`, `align`, `lineHeight`) | seeded into text `blocks` at creation by `placeholder-blocks.ts`; concrete values, not re-resolved at render | explicit re-seed cascade required (unmodified placeholders only) |

So "edit master color → all slides update <100 ms" is essentially a free
repaint, but **position and type-style edits need an explicit cascade**
that re-applies geometry/typography to the ref-bearing placeholder
elements on affected slides, reusing the existing
`applyLayoutToSlide` `(type,index)` slot-matching so user-demoted /
user-added elements are left untouched.

**Store gaps (pre-implementation finding, now addressed):** at re-review
the store had **no** `updateTheme` / `updateMaster` / `updateLayout`
mutations — `applyTheme` only set `meta.themeId`. PR3 added these (plus
`updateLayoutPlaceholderFrame`) to the `SlidesStore` interface and both
implementations (`MemSlidesStore`, `YorkieSlidesStore`), all
`batch()`-wrapped so an edit + its cascade is one undo unit.

**Editing a built-in theme:** `themes`/`masters` already live in
`doc.themes[]` / `doc.masters[]` (document-local copies, not the shared
`BUILT_IN_THEMES` literals), so editing is in-place on the doc copy — no
"fork built-in into doc" step needed. They are stored as **plain JSON
arrays** in Yorkie (not `Yorkie.Array`), so concurrent edits to the same
theme/master field are last-write-wins; acceptable for v1 (see Risks).

**Frontend deltas since the original plan:** the right-panel slot now
arbitrates `theme | format | motion | null` (Format options + Motion
panels shipped after PR1), and the built-in theme count grew 5 → 23
(`slides-theme-catalog.md`). Builder mode follows the
`presentingFrom`-style state-machine + conditional-mount pattern; the
thumbnail panel (`mountThumbnailPanel`, vanilla from `@wafflebase/slides`)
switches to a layouts+master list variant.

**As shipped:** the builder is reached via the Theme panel's "Customize"
tab (no separate toolbar button), editing the active theme + master
through `updateTheme` / `updateMaster`. Edits apply live to all slides.
Per-layout placeholder geometry editing (canvas drag) remains a
follow-up; its store methods (`updateLayout` /
`updateLayoutPlaceholderFrame`) already ship.

#### Commit 5 — canvas layout-editing mode (designed 2026-06-27)

The remaining builder surface: drag a layout's placeholders on the canvas
to edit their geometry, committing through the already-shipped
`updateLayoutPlaceholderFrame` (+ its `cascadeLayoutFrame` re-flow). Decided
2026-06-27: **layouts only** on canvas (master background/colors/fonts stay
in the Customize panel — a master has no positioned placeholders to drag),
entered via a **Customize-tab button**.

**Approach — synthetic-slide reuse.** Rather than build a second canvas
editor, feed the existing `SlidesEditor` a transient `Slide` built from a
layout and route its geometry commits to the layout. The editor already
funnels every slide read through one method (`currentSlide()` →
`store.read().slides`) and reads `this.options.store` *dynamically* at
commit time, so a store-level proxy is a clean "virtual-slide gate":

1. **`buildLayoutSlide(layout, master, theme): Slide`** (pure, slides
   package) — materializes a transient slide (synthetic id
   `__layout__<layoutId>`) from the layout's `placeholders`, each element
   carrying its `placeholderRef`. Reuses `applyLayoutToSlide` on an empty
   slide so geometry/typography match real slides. Never persisted.

2. **`LayoutEditStore`** (a `SlidesStore` proxy) — wraps the real store +
   the current `layoutId`.
   - `read()` → `{ ...realDoc, slides: [buildLayoutSlide(...)] }`, keeping
     the real `themes`/`masters`/`layouts` so the renderer resolves
     correctly.
   - `updateElementFrame(_, elementId, frame)` → map element →
     `placeholderRef` → `real.updateLayoutPlaceholderFrame(layoutId, ref,
     frame)`. The shipped cascade re-flows live slides.
   - `batch` / `onChange` delegate to the real store → one undo unit, and
     edits repaint live slides immediately.
   - Structural mutations (`addElement`, `removeElement*`,
     `withTextElement`, table/connector/guide ops) → guarded no-ops, so no
     layout edit can leak into slide content.

3. **Editor `layoutEditMode` flag** — the UX gate the proxy can't cover.
   When set: allow select / move / resize / rotate of placeholders;
   suppress text-edit entry (double-click), delete, insert, duplicate, and
   structural context-menu items. `enterLayoutEditMode(store, layoutId)` /
   `exitLayoutEditMode()` swap `options.store` (new `setStore`) and toggle
   the flag, reusing `setCurrentSlide`'s reset (exits crop, clears
   selection, repaints).

4. **`mountLayoutListPanel`** (vanilla, slides package) — in layout-edit
   mode the left rail renders the layouts as a selectable list instead of
   slide thumbnails (the existing `mountThumbnailPanel` is slide-specific —
   reorder / new / duplicate / delete — so a separate small panel is
   cleaner than overloading it). Click a layout → re-point the proxy's
   `layoutId` + `editor.setCurrentSlide('__layout__…')`.

5. **Frontend wiring** (`DesktopSlidesLayout` + `slides-view.tsx` +
   `theme-panel.tsx`) — a `layoutEditTarget: layoutId | null` state
   (parallel to `presentingFrom`); an **"Edit layout positions"** button in
   the Customize tab enters the mode; `slides-view` swaps the left rail to
   `mountLayoutListPanel` and calls `editor.enterLayoutEditMode` while
   active; an exit affordance restores normal editing + the previous slide.

Component boundaries are independently testable: `buildLayoutSlide` and
`LayoutEditStore` get vitest coverage (layout → slide elements with refs;
drag → `updateLayoutPlaceholderFrame`; structural ops no-op; single batch);
the editor flag, layout list panel, and frontend wiring are covered by the
browser lane (enter mode, drag a placeholder).

#### Customization + theme-switching UX (model A — in-place edit, re-pick resets)

Decided 2026-06-26. The theme builder edits the deck's active theme **in
place**; there is no fork/override copy. The flows that make this
predictable:

- **Picking a theme always (re)applies a pristine clone.** `applyBuiltInTheme`
  runs, in one batch, `addTheme(builtin)` (ensure present) +
  `updateTheme(id, {name, colors, fonts})` (full overwrite to the
  pristine built-in) + `applyTheme(id)`. So re-selecting the active theme
  resets it, and switching away then back resets too — fixing the prior
  idempotent-`addTheme` bug where a re-pick re-activated the *edited*
  copy with no way back to the original. No new store API: it reuses
  `addTheme` + `updateTheme` (which overwrites every role when handed a
  full `colors`/`fonts`).
- **Themes tab shows two sections.** A top **"In this presentation"**
  section appears *only when the active theme differs from a pristine
  built-in* — i.e. an edited built-in or a PPTX-imported theme — and
  renders that live active palette as the selected thumbnail (resolving
  the canvas/thumbnail mismatch). Below it, a **"Themes"** section lists
  the pristine built-in palettes; clicking one applies it fresh
  (reset/switch). When the active theme is an unedited built-in, no top
  section shows and the matching built-in carries the selection ring.
- **`isThemeModified(activeDocTheme, builtin)`** deep-compares
  colors/fonts/name; true only when the active id is a built-in and
  differs. Imported (non-built-in) active themes have no origin to
  compare, so they show in the top section but offer no reset.
- **Customize tab** edits in place and shows a **"Reset to original"**
  control when the active theme is a modified built-in →
  `applyBuiltInTheme(activeId)`.
- **Loss protection is undo-only.** Switching away from or resetting an
  edited theme discards the edits with no confirm dialog; each switch /
  reset is a single undo unit, so `Cmd/Ctrl+Z` restores the previous
  edited state.
- **Out of v1 scope:** saving/forking named custom themes, resetting
  imported themes, theme renaming.

### Migration

- `meta.themeId` / `meta.masterId` / `themes[]` / `masters[]` /
  `layouts[]` are added to the document root with a default value
  matching `default-light` if missing.
- Migration runs at **read time** in the Yorkie store adapter and is
  **idempotent**. The first write to the document persists the
  migrated state; pure reads do not write.
- Existing element-level `string` colors are wrapped lazily by the
  resolver via `wrapLegacyColor` — they remain `string` in storage
  until that element is next written, at which point they normalize to
  `{ kind: 'srgb' }`. Visual output is identical.
- Layout ID `title` (existing v1 deck) maps to `title-slide` (the new
  Google-Slides-named layout) on first read.
- Yorkie clients running pre-PR1 code see only the new top-level fields
  they don't read; they continue to operate on `slides` and `meta` as
  before. PR1 is therefore a **forward-compatible** schema change. (Old
  clients can't *create* themed elements, but rendering is unaffected.)

## PR Plan

**Status:** PR1 (themes + 11 layouts) and PR2 (PPTX best-effort import)
shipped. PR3 (in-editor theme builder) re-reviewed 2026-06-25 against the
current codebase and re-scoped (see the Theme builder "Re-review"
subsection and the regrounded PR3 commit plan below); v1 editing surface
unchanged.

### PR1 — Themed authoring (XL)

User value: theme switching, 11 layouts, themed pickers — all in one
mental unit.

Single PR, commit-layered for review. Each commit independently passes
`pnpm verify:fast`:

1. `feat(slides): Theme/Master/Layout types and resolve fns`
2. `feat(slides): renderer reads through resolveColor/resolveFont`
3. `feat(slides): yorkie schema + read-time migration`
4. `feat(docs): extend Block/Inline style.color to ThemeColor`
5. `feat(slides): five built-in themes (Simple Light/Dark, Streamline, Focus, Material)`
6. `feat(frontend): theme picker side panel`
7. `feat(slides): eleven Google-Slides-parity built-in layouts`
8. `feat(frontend): themed color picker + themed font picker`

Acceptance:

- All five built-in themes apply across the harness slides scenarios
- Existing v1 deck visual regression count = 0 (manual smoke + harness)
- Two-user Yorkie integration test covers `applyTheme` convergence
- PDF export renders identically to canvas under each theme

### PR2 — Import existing deck (L)

User value: drag a `.pptx` and start working.

Single PR. Commit layering:

1. `feat(slides): pptx unzip + xml parser scaffold`
2. `feat(slides): pptx theme/master/layout parsers`
3. `feat(slides): pptx slide + shape parsers (text, image, basic shapes)`
4. `feat(slides): pptx fallbacks (table flatten, group flatten, shape placeholder)`
5. `feat(frontend): import-pptx UI (button + drag-drop)`
6. `feat(cli): slides import command`

Acceptance:

- 36-slide Yorkie 캐즘 deck round-trip e2e: slide count match, image
  count match, text content hash match (per slide), explicit fallback
  count reported in toast
- `pnpm verify:integration` passes (DB + Yorkie required)

### PR3 — Customize the theme (M)

User value: brand-fit edits without leaving the editor.

Single PR. Commit layering **(regrounded 2026-06-25 — see the Theme
builder "Re-review" subsection above):**

1. `feat(slides): updateTheme/updateMaster/updateLayout store mutations` —
   add the three in-place edit methods to the `SlidesStore` interface,
   `MemSlidesStore`, and `YorkieSlidesStore`, all `batch()`-wrapped and
   `requireBatch()`-guarded. Includes per-placeholder geometry edit on a
   layout. Vitest unit coverage for each.
2. `feat(slides): cascade layout geometry + master placeholder styles` —
   re-flow layout placeholder position/size and master placeholder
   type-styles onto existing ref-bearing slide elements, reusing
   `applyLayoutToSlide`'s `(type,index)` slot matching (user-added /
   demoted elements untouched). Color/font/background already cascade via
   render resolution — covered by repaint, not by this commit.
3. `feat(slides): theme builder mode + layouts/master thumbnail panel` —
   builder-mode state (presentation-mode-style flag), thumbnail panel
   switches from slides to a layouts + master list, click-to-select a
   layout/master.
4. `feat(frontend): theme builder UI shell + editing surface` —
   `View → Theme builder` entry, right-panel editing surface for
   colors / fonts / background fill, placeholder drag reuses the existing
   element selection handles.

Acceptance:

- Edit theme/master color → all slides repaint with the new color
  (<100 ms; role-resolved at render)
- Edit layout placeholder position → only slides on that layout re-flow
  their matching placeholders; user-moved/added elements untouched
- Edit master placeholder font size → unmodified placeholders on
  affected slides pick it up; user-edited text untouched
- Each edit + cascade is a single undo unit
- Two-user Yorkie test for concurrent master + slide edits
- `pnpm verify:browser:docker` covers the theme builder entry point

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Extending `Block.style.color` to `ThemeColor` ripples into sheets and docs callers and breaks builds. | PR1 stalls. | Make the type strictly *additive* (`string \| ThemeColor`). Provide `wrapLegacyColor`. sheets passes only `string` → unchanged. docs editor unchanged unless it opts in. |
| Existing v1 decks render differently after migration. | Loss of trust, perceived data corruption. | Visual snapshot golden fixture per existing deck. Migration is read-time and idempotent. `default-light` reproduces v1 byte-for-byte. |
| Yorkie schema additions break clients on the previous version. | Sync errors, presence breakage. | All additions are new top-level fields. Old clients ignore unknown fields. Presence is unchanged. PR1 is forward-compatible. |
| 36-slide PPTX import takes >30 s. | UX. | Async parser with progress callback. Image uploads batched (5 concurrent). Per-slide failure → placeholder + retry, not whole-deck failure. |
| Theme builder edits master and layout concurrently → CRDT race. | Data corruption. | All builder edits go through `store.batch`. Layouts use `Yorkie.Array.move` for placeholder reordering. Two-user integration test gates the PR. |
| Eleven layouts + five themes balloon the bundle. | Frontend chunk-gate fails. | Themes are small TS literals (~1 KB each, all five must load for the picker thumbnails); layouts are pure data (~3 KB total). Theme thumbnails are SVG generated at build time so PNG assets aren't shipped. Chunk gate measured before merge. |
| docs package becomes a coupling point — slides design rate-limited by docs. | PR conflicts, slow iteration. | Pin the slides-facing docs surface to explicit re-exports from `packages/docs/src/index.ts`. Internal docs changes don't require coordination. |

## Testing Strategy

### Unit (Vitest, in `packages/slides/src/**/*.test.ts`)

- `model/theme.test.ts` — `resolveColor` / `resolveFont` with role,
  srgb, tint, shade combinations
- `model/layout.test.ts` — every built-in layout produces valid
  placeholders that hit-test correctly
- `import/pptx/*.test.ts` — small XML fixture per parser (theme,
  master, layout, slide, shape variants, color variants)
- `model/migration.test.ts` — pre-PR1 deck JSON loads with no diff in
  rendered output

### Visual regression (single lane: harness)

Slides scenarios live under
`packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
and are captured by `pnpm verify:browser:docker` (Docker-based for
cross-platform byte stability). Baselines under
`packages/frontend/tests/visual/baselines/harness-visual.browser.slides-*.png`.

Coverage:

- Five themes × shared composition (title + accent rect) — one
  scenario per theme; switches role colors to the new palette.
- Three structurally diverse layouts (section-header, title-body,
  big-number) under default-light — placeholder geometry coverage.
- UI surfaces — formatting toolbar, theme picker side panel,
  contextual color + font pickers — rendered standalone.

There is intentionally no separate node-canvas golden lane for the
slides package: the harness Docker run is the single source of truth
for visual regression.

### Integration (frontend, in `packages/frontend/tests/app/slides/`)

- `theme-apply.yorkie.test.ts` — two-user `applyTheme` convergence
- `pptx-import.test.ts` — small `.pptx` fixture round-trips through
  the importer + `MemSlidesStore` to a known JSON shape

### E2E (backend, in `packages/backend/test/`)

- `slides-pptx-import.e2e-spec.ts` — Yorkie 캐즘 36-slide deck
  end-to-end through the CLI, gated by
  `RUN_DB_INTEGRATION_TESTS=true` + `RUN_YORKIE_INTEGRATION_TESTS=true`

### Browser (visual + interaction)

`pnpm verify:browser:docker` extended with:

- Theme picker → click "Material" → screenshot
- Drag a small `.pptx` onto the deck list → screenshot of imported deck
- View → Theme builder → edit master color → screenshot

### Verification gates

- PR1: `pnpm verify:fast` per commit + `pnpm verify:browser:docker`
  for the harness slides scenarios
- PR2: `pnpm verify:integration` + 36-slide e2e
- PR3: `pnpm verify:browser:docker`

### Editor parity (post-import)

Vertical anchor is honored across the slide canvas renderer, the read-only present mode, and the in-place text-box editor (commits on branch `slides-pptx-text-vertical-anchor`). Paint, caret, selection, and click hit-test all align with the configured anchor.

Known carve-outs:

- Empty placeholder ghost text ("Click to add title" hints rendered by `drawHint`) still paints at the top of the frame regardless of `verticalAnchor`. The hint disappears the moment the user starts typing, so the divergence is short-lived; revisit when authoring tools that lean on the hint surface land.

## Future / Out of Scope

The following remain out of scope but are unblocked by this work:

- **PPTX export** — symmetric inverse mapping of the import pipeline;
  fonts and embedded media remain the hard parts
- **Theme gallery beyond five** — community / brand themes; the model
  supports unlimited themes from PR1 onward
- **Per-slide theme override** — Google Slides exposes this awkwardly;
  add only on demand
- **Master / layout static elements** — adding logos / footers in the
  theme builder; v1.5
- **docs theming** — docs absorbs `ThemeColor` in PR1 but does not
  expose it in its own UI; a docs-side theme picker is its own design
- **Animations** — still v2
- **Group / ungroup elements** — still v2
- **Shape library expansion** — chevron, donut, blockArc, can, etc.
  remain placeholder rects on import until v2
