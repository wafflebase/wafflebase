---
title: slides-pptx-export
target-version: 0.5.0
---

# Slides PPTX Export

## Summary

A Node-safe PPTX (OOXML) writer for `@wafflebase/slides` that is the
inverse of the existing PPTX importer (`src/import/pptx/`). It serializes
a `SlidesDocument` into a valid `.pptx` byte stream, mirroring the
architecture of the docs `DocxExporter` (string-based DrawingML +
`jszip`, no DOM/Canvas). The CLI's `slides export <doc-id> <file>`
command wraps it, completing the Slides CLI's parity with the Docs CLI
(which already has `docs export pdf|docx`).

The fidelity target is **full round-trip**: every element type, theme,
master, layout, effect, animation, and transition the importer reads is
written back. Success is defined by a **model-equivalence round-trip** —
`import(.pptx) → export → re-import` yields a `SlidesDocument` that is
deep-equal to the first import under a defined normalization (§6).

## Goals / Non-Goals

### Goals

- Serialize a `SlidesDocument` to a valid `.pptx` that opens in
  PowerPoint and Google Slides.
- Cover every element type the importer handles: text boxes, shapes
  (parametric `prstGeom` + `freeform` `custGeom`), images (crop /
  opacity / recolor), tables (merges / per-side borders), connectors,
  and nested groups.
- Preserve rich text (`Block[]`/`Inline` → `<a:p>`/`<a:r>`/`<a:rPr>`),
  theme color roles (`ThemeColor` → `schemeClr`/`srgbClr`), effects
  (drop shadow / reflection), speaker notes, and best-effort
  animations/transitions (round-tripping preserved `pptxPreset` data).
- Be DOM-free and exposed from `@wafflebase/slides/node` so the CLI and
  backend can call it.
- Expose `wafflebase slides export <doc-id> <file>` with schema entry,
  bundled skill, and `cli.md` documentation.
- Verify with a model-equivalence round-trip over the existing importer
  fixtures.

### Non-Goals

- Pixel-perfect visual parity with PowerPoint's own renderer (we emit
  semantically faithful OOXML; final layout is the consumer's renderer's
  job).
- Exporting fields the importer never reads (no new model data is
  invented to satisfy OOXML completeness).
- A separate PDF export (tracked separately; PDF needs Canvas raster).
- Editing/streaming `.pptx` in place — export always writes a fresh deck.
- Image *upload* — images already in the deck (`data:` URLs or server
  URLs) are embedded as media parts; the CLI resolves them via the
  existing `ImageFetcher`.

## Proposal Details

### 1. Package Structure

New directory `packages/slides/src/export/pptx/`, mirroring the
importer's module split (so each importer module is the reference spec
for its inverse). Architecture follows the docs `DocxExporter`:
string-interpolated XML + `jszip`, zero DOM/Canvas.

```text
index.ts        exportPptx(deck, opts): Promise<Uint8Array> — orchestrator
zip.ts          JSZip assembly + part / rels / [Content_Types] registry
xml.ts          escapeXmlText / escapeXmlAttr / attribute builders
units.ts        px ↔ EMU (914400 EMU/inch; slide 12192000×6858000 EMU)
color.ts        ThemeColor → <a:solidFill> (srgbClr / schemeClr + alpha)
text.ts         TextBody / Block[] / Inline → <a:txBody>/<a:p>/<a:r>/<a:rPr>
shape.ts        ShapeElement → <p:sp> (prstGeom from kind + adjustments)
freeform.ts     FreeformPath → <a:custGeom><a:pathLst>
image.ts        ImageElement → <p:pic> + media part (crop / opacity / recolor)
table.ts        TableElement → <p:graphicFrame><a:tbl> (merges / borders)
connector.ts    ConnectorElement → <p:cxnSp>
group.ts        GroupElement → <p:grpSp> (recursive, group-local child coords)
effects.ts      Effects → <a:effectLst> (outerShdw / reflection)
animation.ts    SlideAnimation / SlideTransition → <p:timing>/<p:transition>
slide.ts        Slide → ppt/slides/slideN.xml (+ notes slide)
theme.ts        Theme → ppt/theme/themeN.xml (clrScheme / fontScheme)
master.ts       Master → ppt/slideMasters/slideMasterN.xml
layout.ts       Layout → ppt/slideLayouts/slideLayoutN.xml
presentation.ts ppt/presentation.xml (slide size, slide/master id lists)
templates.ts    [Content_Types].xml, _rels/.rels boilerplate builders
```

Target ≈ 2,000–3,000 LOC of source plus tests. Module isolation keeps
each file reviewable and independently testable.

### 2. Part / Relationship Assembly (`zip.ts`)

A `PptxWriter` accumulates parts and their relationships, mirroring the
DOCX exporter's counter pattern but scaled to PPTX's multi-part layout:

```ts
class PptxWriter {
  addPart(path: string, xml: string, contentType?: string): void;
  addMedia(bytes: Uint8Array, ext: string): string;   // → media path
  addRel(ownerPart: string, type: string, target: string): string; // → rId
  build(): Promise<Uint8Array>;                        // jszip.generateAsync
}
```

OOXML parts emitted:

- `[Content_Types].xml` — Default (rels, xml, png/jpeg/…) + Override per
  slide/layout/master/theme/notes/presentation part.
- `_rels/.rels` → `ppt/presentation.xml`.
- `ppt/presentation.xml` + `ppt/_rels/presentation.xml.rels` — slide
  size (`<p:sldSz cx cy>`), `<p:sldIdLst>`, `<p:sldMasterIdLst>`,
  `<p:notesMasterIdLst>` (if notes present).
- `ppt/slides/slideN.xml` + `_rels` — one per `deck.slides[]`.
- `ppt/slideLayouts/slideLayoutN.xml` + `_rels` — one per `deck.layouts[]`.
- `ppt/slideMasters/slideMasterN.xml` + `_rels` — one per `deck.masters[]`.
- `ppt/theme/themeN.xml` — one per `deck.themes[]`.
- `ppt/notesSlides/notesSlideN.xml` (+ a `ppt/notesMasters/…` when any
  slide has notes).
- `ppt/media/imageN.{ext}` — deduplicated by `src`.

Relationships wire slide→layout→master→theme exactly as the importer
expects to resolve them.

### 3. Coordinates, Colors, Text

- **Units (`units.ts`)**: model frames are slide-logical px against
  `SLIDE_WIDTH`/`SLIDE_HEIGHT`. EMU = `round(px / SLIDE_WIDTH * 12192000)`
  on X and `/ SLIDE_HEIGHT * 6858000` on Y (the importer's inverse
  factor). Rotation: degrees → 60000ths in `<a:xfrm rot>`.
- **Colors (`color.ts`)**: `ThemeColor` →
  - `{ kind: 'role', role }` → `<a:schemeClr val="…">` (role → OOXML
    scheme name map, inverse of the importer's scheme→role map),
  - `{ kind: 'srgb', hex }` → `<a:srgbClr val="RRGGBB">`,
  - alpha → child `<a:alpha val="…">`.
- **Text (`text.ts`)**: `TextBody.blocks` → `<a:txBody>` with
  `<a:bodyPr>` (autofit: none→`noAutofit`, shrink→`normAutofit`,
  grow→`spAutoFit`; `verticalAnchor`→`anchor`). Each `Block` → `<a:p>`
  with `<a:pPr>` (alignment, list level/bullet, indent); each `Inline`
  → `<a:r>` with `<a:rPr>` (bold/italic/underline/strike, size in
  hundredths of a point, color, font family via `<a:latin typeface>`),
  link → `<a:hlinkClick>`. Reuses the docs `Block`/`Inline` types
  already shared with slides.

### 4. Elements

| Element     | OOXML target            | Notes                                                                 |
| ----------- | ----------------------- | --------------------------------------------------------------------- |
| Text        | `<p:sp>` + `<a:txBody>` | `<a:prstGeom prst="rect">`; placeholder via `<p:ph>` when `placeholderRef` set |
| Shape       | `<p:sp>`                | `kind`→`prstGeom prst` (inverse of importer's `prst`→`kind`); `adjustments`→`<a:avLst><a:gd>`; fill/stroke; optional `text` body |
| Freeform    | `<p:sp>` + `<a:custGeom>` | normalized path → `<a:pathLst>` with moveTo/lnTo/cubicBezTo/close      |
| Image       | `<p:pic>`               | `<a:blip r:embed>` + media part; `crop`→`<a:srcRect>`; `opacity`→`<a:alphaModFix>`; `recolor`→`<a:grayscl>`/`<a:duotone>`; brightness/contrast→`<a:lum>` |
| Table       | `<p:graphicFrame><a:tbl>` | `columnWidths`→`<a:gridCol>`; rows→`<a:tr>`; merges via `gridSpan`/`rowSpan` (and `hMerge`/`vMerge` on covered cells); per-side borders→`<a:lnL/R/T/B>` |
| Connector   | `<p:cxnSp>`             | endpoint geometry + `<a:prstGeom>` line/elbow/curve; connection sites preserved |
| Group       | `<p:grpSp>`             | `<a:grpSpPr>` with `<a:chOff>/<a:chExt>` so child coords match the importer's group-local read; recurse |

Effects (`effects.ts`) attach an `<a:effectLst>` (`<a:outerShdw>`,
`<a:reflection>`) to any element's `spPr`.

### 5. Theme / Master / Layout / Animation

- **Theme**: `ColorScheme` → `<a:clrScheme>` (12 OOXML slots),
  `FontScheme` → `<a:fontScheme>` major/minor. Emit one `themeN.xml` per
  stored theme; the master references its theme by rId.
- **Master / Layout**: emit `<p:sldMaster>`/`<p:sldLayout>` with the
  stored background + placeholder specs. Layout carries `type="…"` in
  `<p:sldLayout matchingName>`/`<p:cSld>` so the importer re-derives the
  same built-in layout id on re-import (round-trip stability — §6).
- **Animations / transitions (`animation.ts`)**: best-effort. The
  importer preserves OOXML preset ids on `SlideAnimation`/
  `SlideTransition` (`pptxPreset`-style fields); the exporter writes them
  straight back into `<p:timing>` / `<p:transition>`. Where the model
  carries only the abstracted form, emit the closest preset.

### 6. Round-Trip Verification & Normalization

The acceptance bar is a **model-equivalence round-trip**, reusing the
importer's existing fixtures:

```text
for each fixture .pptx:
  a = importPptx(fixture)
  bytes = exportPptx(a, { fetchImage: fromDataUrl })
  b = importPptx(bytes)
  expect(normalize(b)).toEqual(normalize(a))
```

`normalize()` projects out fields that cannot survive a round-trip by
construction, so the test asserts *semantic* equivalence:

- **Generated ids**: `Slide.id` and `Element.id` come from
  `generateId()` (random). Normalization strips/zeroes them (and any
  intra-deck references are compared structurally, not by id value).
- **Order-insensitive collections**: sorted before compare where the
  model does not guarantee order.
- **Render-derived fields**: live-derived values never stored (e.g.
  autofit shrink scale) are excluded.
- **Known importer loss**: spots where the *importer itself* is lossy or
  approximating (documented per-case in code + this section) are
  excluded from the projection. "Full round-trip" therefore means
  *deep-equal on the normalized projection*, not byte-identical OOXML.

A second, lighter test tier emits a tiny synthetic deck and asserts the
zip contains the required parts with well-formed XML (parseable by the
importer's `DOMParser`), guarding the part/rels wiring independently of
fixture coverage.

### 7. CLI Integration

Mirrors `docs export`:

- `packages/cli/src/slides/pptx-export.ts` — `exportPptxCli(deck, opts)`
  thin wrapper returning `Uint8Array` (like `docx-export.ts`).
- `packages/cli/src/commands/slides.ts` — new
  `slides export <doc-id> <file>` action: `getSlidesContent` → resolve
  images via the existing `createImageFetcher` (handles `data:` URLs and
  server-relative `src`) → `exportPptxCli` → `writeBinary` with
  `--force`. Format inferred from the `.pptx` extension or `--format
  pptx`.
- `schema/registry.ts` — `slides.export` entry (`read-only`; file write
  is local), aliases `slide.export`/`deck.export`.
- `skills/slides-export-pptx.md` + SKILL.md index row.
- `docs/design/cli.md` — add `slides export` to the command tree and
  schema tables; drop the "PPTX export has no engine" deferral note.

### 8. Public Surface

- `packages/slides/src/export/pptx/index.ts` exports `exportPptx` +
  `ExportPptxOptions`.
- `packages/slides/src/node.ts` re-exports both (DOM-free audit per the
  file's existing contract). The browser entry (`src/index.ts`)
  re-exports them too for the in-app "Download as .pptx" path (wiring
  the editor button is out of scope here but the API is ready).

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Single-PR scope is large (~2–3k LOC + tests) | Strict module isolation (§1); each element module lands with its own unit test; round-trip fixtures gate the whole. Reviewable file-by-file. |
| 100% model equivalence is impossible where the importer is lossy | Define success as deep-equal on a normalized projection (§6); document every excluded field in code and the spec. |
| Generated ids defeat naive deep-equal | `normalize()` strips ids and compares references structurally. |
| Layout/theme round-trip instability (importer maps OOXML→built-in ids) | Emit `type`/`matchingName` so the importer re-derives the same id; covered by the round-trip test. |
| OOXML invalidity (PowerPoint refuses to open) | Lighter test tier asserts required parts + well-formed XML; spot-check generated decks in PowerPoint/Google Slides during review. |
| DOM leak into the node entry | Audit transitive imports before re-exporting from `node.ts`; the exporter uses only `jszip` + string building, like `DocxExporter`. |
| Freeform/connector geometry drift | Reuse the model's normalized path + the importer's connection-site math as the inverse reference; round-trip fixtures with freeform/connectors cover it. |
| Bundle size | Negligible — `jszip` is already a slides dependency (used by the importer). |
