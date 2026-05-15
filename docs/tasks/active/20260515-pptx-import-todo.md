# PPTX Import (PR2 of slides-themes-layouts-import)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created**: 2026-05-15

**Goal:** Ship best-effort PPTX import so a user can drag a `.pptx` onto the deck list (or run `slides import file.pptx` from the CLI) and start editing. Benchmark is the 36-slide Yorkie 캐즘 deck.

**Architecture:** Pure-TypeScript, client-side parser under `packages/slides/src/import/pptx/`. Reuses `jszip` (already in `@wafflebase/docs` for DOCX import) and `@xmldom/xmldom` (already in `@wafflebase/cli`). Maps OOXML theme/master/layout/slide → `SlidesDocument`. Images go through the existing workspace `/images` upload API. No new backend endpoints.

**Spec:** `docs/design/slides/slides-themes-layouts-import.md` (PR2 section + "Yorkie 캐즘 deck — re-validated gap (2026-05-15)" subsection)

**Tech Stack:** TypeScript, Vitest (slides), node:test (frontend), jszip, @xmldom/xmldom, NestJS (backend, only for the e2e gate).

**Re-validated reality (delta from spec written before v0.4.0):**

- 117 `ShapeKind` registered — all 13 `prstGeom` kinds used by the benchmark map directly. No "placeholder rect" fallback for these.
- First-class `ConnectorElement` with `stCxn`/`endCxn`-style attached endpoints — `curvedConnector2/3` + `straightConnector1` map directly.
- 4-tier theming (Theme/Master/Layout/Slide) and 11 built-in layouts already shipped.
- `Inline.style.backgroundColor` (`<a:highlight>` ✅) and `Inline.style.href` (`<a:hlinkClick>` ✅) already exist in `@wafflebase/docs`.
- Real model gaps confirmed lossy-acceptable: `<a:normAutofit>` (pre-scale fontSize), `<a:outerShdw>` (drop), slide canvas (1920×1080 hardcoded — rescale EMU→px from deck's `<p:sldSz>`).

**Why mostly TDD:** Each parser is a pure `(xmlNode) → DomainObject` function — small XML fixtures, deterministic outputs. End-to-end uses the benchmark deck through `MemSlidesStore`.

---

## File Map

| File | Role |
|------|------|
| `packages/slides/src/import/pptx/index.ts` | New: `importPptx(buffer): Promise<SlidesDocument>` public entry |
| `packages/slides/src/import/pptx/unzip.ts` | New: jszip wrapper, returns `Map<path, Uint8Array \| string>` |
| `packages/slides/src/import/pptx/xml.ts` | New: xmldom wrapper, namespace-tolerant element traversal helpers |
| `packages/slides/src/import/pptx/rels.ts` | New: parse `*.rels` into `Map<id, { type, target }>` |
| `packages/slides/src/import/pptx/geometry.ts` | New: EMU↔px (deck-size driven), rotation degrees→radians, prst→`ShapeKind` lookup |
| `packages/slides/src/import/pptx/color.ts` | New: schemeClr/srgbClr/sysClr/prstClr + tint/shade → `ThemeColor` |
| `packages/slides/src/import/pptx/font.ts` | New: typeface resolution + Korean (Noto Sans KR) fallback |
| `packages/slides/src/import/pptx/theme.ts` | New: `<a:theme>` → `Theme` (ColorScheme + FontScheme) |
| `packages/slides/src/import/pptx/master.ts` | New: `<p:sldMaster>` → `Master` + placeholder styles |
| `packages/slides/src/import/pptx/layout.ts` | New: `<p:sldLayout>` → `Layout`; classify type (`title`/`secHead`/`tx`/`body`/`titleOnly`/`blank`/…) and map to nearest built-in layout id |
| `packages/slides/src/import/pptx/slide.ts` | New: `<p:sld>` + its rels → `Slide` (background + elements + notes) |
| `packages/slides/src/import/pptx/shape.ts` | New: dispatcher for `<p:sp>` / `<p:pic>` / `<p:cxnSp>` / `<p:grpSp>` / `<p:graphicFrame>` |
| `packages/slides/src/import/pptx/text.ts` | New: `<p:txBody>` → `Block[]`; handles `<a:r>` (runs), `<a:p>` (paragraphs), `<a:pPr>` (alignment, bullet, indent, line-spacing), `<a:rPr>` (bold, underline, size, font, color, **highlight**, **hyperlink**), `<a:br>`, `<a:normAutofit>` pre-scale |
| `packages/slides/src/import/pptx/group.ts` | New: flatten `<p:grpSp>` — compose `chOff/chExt`+ `off/ext` group transform into each child's frame |
| `packages/slides/src/import/pptx/table.ts` | New: `<a:tbl>` → matrix of `TextElement` + border `ShapeElement` per cell |
| `packages/slides/src/import/pptx/image.ts` | New: `<p:pic>` → upload bytes via injected `uploadImage(bytes, mime) → src` callback, produce `ImageElement` |
| `packages/slides/src/import/pptx/report.ts` | New: `ImportReport` — counts of flattened groups, tables, dropped shadows, pre-scaled text boxes, unknown shapes |
| `packages/slides/src/import/pptx/__fixtures__/` | New: small per-parser XML fixtures + a tiny synthetic `.pptx` |
| `packages/slides/src/index.ts` + `node.ts` | Re-export `importPptx` and `ImportReport` |
| `packages/frontend/src/app/decks/import-pptx-button.tsx` | New: `<ImportPptxButton />` — file input + drag-drop zone; calls `importPptx`, creates a deck via existing REST, populates Yorkie doc |
| `packages/frontend/src/app/decks/deck-list-page.tsx` | Wire `<ImportPptxButton />` next to "+ New Deck"; drop zone overlay on the page |
| `packages/frontend/src/types/slides-document.ts` | Verify Yorkie schema can absorb output (no new fields expected; lint if drift) |
| `packages/cli/src/commands/slides/import.ts` | New: `slides import <file.pptx> [--workspace <id>] [--title <name>]` |
| `packages/cli/src/commands/slides/index.ts` | Register `import` subcommand |
| `packages/backend/test/slides-pptx-import.e2e-spec.ts` | New: end-to-end CLI import of the 36-slide benchmark, gated by `RUN_DB_INTEGRATION_TESTS` + `RUN_YORKIE_INTEGRATION_TESTS` |
| `packages/frontend/tests/app/slides/pptx-import.test.ts` | New: small `.pptx` fixture → `MemSlidesStore` → assert slide count, element counts, content hashes |
| `docs/design/slides/slides-themes-layouts-import.md` | Update mapping-table stale rows (already done in PR2 design refresh) |
| `docs/tasks/active/20260515-pptx-import-lessons.md` | Capture lessons during implementation |

---

## Task 1 — `feat(slides): pptx unzip + xml parser scaffold`

**Files:** `packages/slides/src/import/pptx/{unzip,xml,rels,geometry,color,font,report,index}.ts`, `__fixtures__/minimal.pptx`

Set up the I/O surface and the shared utilities every later parser uses. After this task `importPptx(buffer)` returns an empty `SlidesDocument` for a minimal valid `.pptx` (one blank slide).

- [ ] **Step 1.** Add `jszip` and `@xmldom/xmldom` to `packages/slides/package.json` (devDeps via `pnpm add -D --filter @wafflebase/slides ...`); confirm both are already top-level deps in their existing homes (no version duplication).
- [ ] **Step 2.** `unzip.ts`: `unzipPptx(buffer: ArrayBuffer): Promise<PptxArchive>` returning `{ readText(path), readBytes(path), list(prefix) }`. Tests: load `__fixtures__/minimal.pptx`, list `ppt/slides/*.xml`.
- [ ] **Step 3.** `xml.ts`: `parseXml(text): Document` + helpers `child(el, localName, namespace?)`, `children(...)`, `attr(el, name)`, `text(el)`. Namespace-tolerant: match on `localName` to survive `p:`/`a:`/`r:` prefixes. Tests: parse a tiny snippet with mixed namespaces.
- [ ] **Step 4.** `rels.ts`: `parseRels(text): Map<id, { type, target }>`. Tests: small `.rels` fixture with image, hyperlink, and slideLayout entries.
- [ ] **Step 5.** `geometry.ts`: export `emuToPxScale(sldSzCx, sldSzCy) → { sx, sy }`; `emuToFrame(off, ext, scale)`; `rotEmuToRad(rot)`; `prstToShapeKind(prst): ShapeKind | null` (covers the 13 kinds used by the benchmark — verify with `Object.keys(PATH_BUILDERS)`). Tests cover both standard (9144000×5143500) and widescreen (12192000×6858000) decks.
- [ ] **Step 6.** `color.ts`: `parseColor(node, theme?): ThemeColor` — handles `<a:schemeClr val>` → `{kind:'role', role}`, `<a:srgbClr val>` → `{kind:'srgb', value}`, `<a:sysClr lastClr>` → `{kind:'srgb'}`, `<a:prstClr val>` → preset color table lookup. Preserve `<a:tint>`/`<a:shade>` as numbers on the resulting `ThemeColor`. Tests for each variant.
- [ ] **Step 7.** `font.ts`: `parseTypeface(latin, ea, cs): ThemeFont`. If Hangul characters appear in the run text *and* no `ea` typeface, suggest 'Noto Sans KR' fallback. Tests use a tiny Korean sample.
- [ ] **Step 8.** `report.ts`: `class ImportReport` with counters (`tablesFlattened`, `groupsFlattened`, `shadowsDropped`, `textBoxesPreScaled`, `unknownShapes`, `skippedImages`) and `summary(): string`. Tests are trivial.
- [ ] **Step 9.** `index.ts`: `importPptx(buffer, opts: { uploadImage }): Promise<{ document: SlidesDocument; report: ImportReport }>` — scaffold only, returns an empty `SlidesDocument` keyed to a fresh theme/master/layout and reads `<p:sldSz>` for the scale. Test: minimal `.pptx` round-trips to a one-slide deck.
- [ ] **Step 10.** Synthesise `__fixtures__/minimal.pptx` via a tiny generator script (Node, runs in tests only). Commit the generator + the resulting `.pptx`.
- [ ] **Step 11.** Re-export `importPptx` from `packages/slides/src/index.ts` and `node.ts`. Confirm both `pnpm slides build` and `pnpm verify:fast` are green.

---

## Task 2 — `feat(slides): pptx theme/master/layout parsers`

**Files:** `theme.ts`, `master.ts`, `layout.ts`

After this task: a deck's own visual identity (custom palette, fonts, layouts) is imported as a *new* `Theme` + `Master` + `Layout[]`. `SlidesDocument.meta.themeId/masterId` point at the imported pair.

- [ ] **Step 1.** `theme.ts`: walk `<a:clrScheme>` → 12-slot `ColorScheme`; `<a:fontScheme>` (`majorFont/minorFont`'s `latin typeface`) → `FontScheme`. Test against the benchmark's theme1.xml — confirm `accent1` resolves to `#058DC7`.
- [ ] **Step 2.** `master.ts`: parse `<p:sldMaster>`'s `<p:bg>` → `Background`; walk placeholder shapes to derive `placeholderStyles` (title, body) using `parseTypeface` + `parseColor`. Test on a master fixture.
- [ ] **Step 3.** `layout.ts`: parse `<p:sldLayout>`'s `type` attribute and map to built-in `Layout.id`:
  - `title` → `title-slide`
  - `secHead` → `section-header`
  - `tx` / `obj` → `title-body`
  - `body` → `one-column-text`
  - `titleOnly` → `title-only`
  - `twoColTx` → `title-two-columns`
  - `blank` → `blank`
  - everything else → `title-body` with a `report.unknownLayoutType` count
- [ ] **Step 4.** Parse layout placeholders (their `<p:ph type idx>`) into `PlaceholderSpec[]`. Layout `background?` overrides only when `<p:bg>` is present on the layout itself.
- [ ] **Step 5.** Wire all three into `importPptx`: read `ppt/theme/theme1.xml`, `ppt/slideMasters/slideMaster1.xml`, `ppt/slideLayouts/*.xml`. Populate `document.themes`, `document.masters`, `document.layouts`. Test: the benchmark deck produces exactly 11 imported layouts (or however many it ships).
- [ ] **Step 6.** Run `pnpm verify:fast`.

---

## Task 3 — `feat(slides): pptx slide + shape parsers (text, image, basic shapes, connectors)`

**Files:** `slide.ts`, `shape.ts`, `text.ts`, `image.ts`

This is the big one. After this task: text boxes, images, basic shapes, and connectors round-trip with high fidelity.

- [ ] **Step 1.** `slide.ts`: parse `<p:sld>` — walk `<p:spTree>` and dispatch each child to `shape.ts`. Read sibling rels file for image and hyperlink resolution.
- [ ] **Step 2.** Slide-level background: respect `<p:bg>` on the slide; otherwise `slide.background = undefined` (inherit). Confirm 4 benchmark slides report a non-inherited background.
- [ ] **Step 3.** Notes: read `notesSlideN.xml` via rels, parse its `<p:txBody>` runs into a `Block[]` for `Slide.notes`.
- [ ] **Step 4.** `shape.ts` — text box (`<p:sp txBox="1">` or `<p:sp>` with `<p:txBody>` containing visible runs): build `TextElement` via `text.ts`.
- [ ] **Step 5.** `shape.ts` — non-text shape: `prstToShapeKind` → `ShapeElement`. Parse `<a:avLst><a:gd>` into `adjustments` (preserve OOXML thousandths). Parse `<p:spPr>`'s `<a:solidFill>` and `<a:ln>` into `fill` + `stroke`. Drop `<a:outerShdw>` and bump `report.shadowsDropped`. Unknown `prst` → fallback `rect` and bump `report.unknownShapes`.
- [ ] **Step 6.** `image.ts`: `<p:pic>` — resolve `<a:blip r:embed>` via rels to a media path, read bytes, call injected `uploadImage(bytes, mime)`. Build `ImageElement`. Honor `<a:srcRect l t r b>` as `crop` (the 1 case in the benchmark). Honor `<a:alphaModFix amt>` — store in element as appropriate (skip if model doesn't support, but defer alpha to v2 if needed).
- [ ] **Step 7.** Connectors (`<p:cxnSp>`): `prstGeom` `straightConnector1` → routing `'straight'`; `curvedConnector2/3` → `'curved'`; anything else with elbow-y geometry → `'elbow'`. `stCxn id idx`/`endCxn id idx` → `attached` endpoint (use the shape's id mapping built during the same pass). Arrowheads `<a:headEnd>`/`<a:tailEnd>` `type` → `'triangle'`/`'open-triangle'`/`'diamond'`/`'circle'`. Test against the benchmark slide that has 4 connectors.
- [ ] **Step 8.** `text.ts` — paragraphs and runs:
  - `<a:p>` → docs `Block`. `<a:pPr algn="">` → alignment. `<a:pPr lvl indent marL>` → indent. `<a:lnSpc>` → lineHeight. `<a:buChar char>` / `<a:buAutoNum type>` / `<a:buNone>` → list style on the block. `<a:br/>` → soft break.
  - `<a:r><a:rPr.../><a:t>...</a:t></a:r>` → docs `Inline`. `rPr@b="1"` → bold; `rPr@u="sng"` → underline; `rPr@sz` → fontSize (PPTX hundredths-of-pt → our pt); `<a:latin typeface>` / `<a:ea typeface>` → fontFamily via `font.ts`. `<a:solidFill>` (inside rPr) → color. **`<a:highlight>` → `Inline.style.backgroundColor`.** **`<a:hlinkClick r:id>` → `Inline.style.href` resolved via rels.**
  - `<a:bodyPr><a:normAutofit fontScale=>` → pre-multiply every run's `fontSize` by `fontScale/100000`; bump `report.textBoxesPreScaled`. Note in `lessons.md` if the visual diff exceeds tolerance.
- [ ] **Step 9.** Element ids: assign deterministic ids during parse (e.g. `slide${idx}-el${nvSpPr.cNvPr@id}`) so connectors can resolve `stCxn id` to the right element. Build a per-slide `Map<number, string>` to translate.
- [ ] **Step 10.** Fixtures: per-shape XML fixtures under `__fixtures__/` for every distinct `prst` kind in the benchmark (rect, roundRect, ellipse, rtTriangle, chevron, blockArc, uturnArrow, flowChartOffpageConnector, rightArrowCallout, leftBracket, homePlate, donut, can) + 3 connector variants + 1 text-with-highlight-and-hyperlink + 1 cropped image.
- [ ] **Step 11.** `pnpm verify:fast`.

---

## Task 4 — `feat(slides): pptx fallbacks (group flatten, table flatten, unknown shape)`

**Files:** `group.ts`, `table.ts`, plus extensions to `shape.ts`

- [ ] **Step 1.** `group.ts`: `flattenGroup(grpSp, parentScale, parentOff)`. Compose group `<a:xfrm off="X Y" ext="W H" chOff="x y" chExt="w h">` into each child's frame using the affine formula `child_off_world = parent_off + (child_off_local - chOff) * (ext / chExt)`. Recursive on nested groups (depth 1 in the benchmark, but support arbitrary). Bump `report.groupsFlattened` per group.
- [ ] **Step 2.** `table.ts`: walk `<a:tbl>` rows and cells. Compute each cell's world frame from `<a:tblGrid><a:gridCol w>` widths and `<a:tr h>` heights against the graphicFrame's `<p:xfrm off ext>`. For each cell: produce a borderless `ShapeElement` (kind `'rect'`, no fill or transparent) with the cell's borders applied as a 4-stroke synthesis — or, if border-strokes-per-side aren't supported in our model, a single stroke with the dominant color and a `report.tableBordersApproximated` count. Inside the cell, place a `TextElement` from `<a:txBody>`. Bump `report.tablesFlattened`. Cell merges (`<a:gridSpan>`/`<a:rowSpan>`/`<a:hMerge>`/`<a:vMerge>`) — benchmark has 0; emit a `report.tableMergesIgnored` for future decks.
- [ ] **Step 3.** Wire group + table into `shape.ts` dispatcher.
- [ ] **Step 4.** Pre-flight sanity test on the benchmark: 36 slides parsed; 218 shapes + 51 connectors + 63 images appear in `document.slides[*].elements`; 48 groups counted in report.groupsFlattened; 7 tables in report.tablesFlattened. (Element totals may differ slightly because tables explode to N text + N border shapes.)
- [ ] **Step 5.** `pnpm verify:fast`.

---

## Task 5 — `feat(frontend): import-pptx UI (button + drag-drop)`

**Files:** `packages/frontend/src/app/decks/import-pptx-button.tsx`, `deck-list-page.tsx`, sibling tests

- [ ] **Step 1.** `<ImportPptxButton />` — a button next to "+ New Deck" labeled "↑ Import .pptx". `<input type="file" accept=".pptx" />` hidden; clicking the button triggers it.
- [ ] **Step 2.** On file selected: read as `ArrayBuffer`, show a progress modal ("Importing… 0/36 slides"), invoke `importPptx(buffer, { uploadImage })`. `uploadImage` is bound to the existing workspace `POST /api/v1/workspaces/:wid/images` endpoint.
- [ ] **Step 3.** On success: create a new deck via the existing `POST /documents` REST endpoint with `type='slides'` and an empty doc; then attach to Yorkie, push the parsed `SlidesDocument`, and navigate to `/slides/:id`. Show a toast with `report.summary()`.
- [ ] **Step 4.** Drag-and-drop: a full-page invisible drop zone on `deck-list-page.tsx`; when a `.pptx` is dragged, show a translucent "Drop to import" overlay. Drop → same flow as step 2.
- [ ] **Step 5.** Error handling: parser exceptions, image upload failures, and Yorkie attach failures all surface a user-visible error toast and *do not* leave a half-populated deck (delete the placeholder document on failure).
- [ ] **Step 6.** Tests in `packages/frontend/tests/app/slides/pptx-import.test.ts` — small `.pptx` fixture → assert deck created, slide count, image count, content text hashes per slide.
- [ ] **Step 7.** `pnpm verify:fast` + manual smoke with the benchmark deck in `pnpm dev`.

---

## Task 6 — `feat(cli): slides import command`

**Files:** `packages/cli/src/commands/slides/import.ts`, `packages/cli/src/commands/slides/index.ts`, backend e2e

- [ ] **Step 1.** Mirror the existing `docs import` command shape (read it first). Signature: `wafflebase slides import <file.pptx> [--workspace <id>] [--title <name>]`. Title defaults to the file basename.
- [ ] **Step 2.** Wire to the slides parser: read the file, call `importPptx(buffer, { uploadImage })`. `uploadImage` uses the CLI's existing API client.
- [ ] **Step 3.** Create deck via REST (`POST /api/v1/workspaces/:wid/documents` with `type='slides'`), attach to Yorkie, write `SlidesDocument`, print the import report (slide count, image count, fallback counts).
- [ ] **Step 4.** Register the subcommand in `slides/index.ts`.
- [ ] **Step 5.** `packages/backend/test/slides-pptx-import.e2e-spec.ts`: gated by both `RUN_DB_INTEGRATION_TESTS=true` and `RUN_YORKIE_INTEGRATION_TESTS=true`. Reads the benchmark `.pptx` from a fixtures directory (copied in during setup; do not commit the actual user file — commit a sanitised variant or instruct CI to skip if missing). Asserts: 36 slides, image count, per-slide text-content SHA matches a checked-in expectations JSON.
- [ ] **Step 6.** `pnpm verify:integration:docker` locally; ensure CI's `verify-integration` job picks up the test.
- [ ] **Step 7.** `pnpm verify:fast` final.

---

## Out of scope (PR3 or v2)

- Theme builder UI (PR3 of design doc).
- PPTX *export* (v2).
- Animations / transitions (v2).
- Embedded font loading (`.fntdata` decryption).
- SmartArt / charts inside PPTX (none in benchmark).
- Group elements as first-class kind (flatten is the v1 strategy).
- Multi-master decks (benchmark uses 1; assume 1 in v1, log if more).

## Risks

| Risk | Mitigation |
|---|---|
| `<p:cxnSp>` connector `stCxn id` references a shape that hasn't been parsed yet (forward reference). | Two-pass per slide: build id map first, then resolve endpoints. |
| `<a:normAutofit fontScale=>` pre-scale gives wrong size if text reflows differently in our renderer. | Acceptable for v1; toast count. Lessons file should capture observed magnitude of mismatch. |
| Table border-per-side semantics don't map to our single-stroke `ShapeStroke`. | Use dominant border color; report `tableBordersApproximated`. Revisit when docs-tables ships. |
| Image upload concurrency starves the importer or backend. | Batch uploads at 5 concurrent; per-image failure → placeholder + count in report. |
| Aspect ratio ≠ 16:9. | Fit-by-width, center vertically; toast warning. Benchmark is 16:9 so this path is not exercised by primary fixture. |
| Bundle size — `jszip` + `@xmldom/xmldom` together (~150 KB gzipped). | Code-split the importer behind dynamic `import()` from the deck list page. Frontend chunk-gate must stay green. |

## Acceptance

- 36-slide Yorkie 캐즘 deck imports in <30 s (cold).
- Slide count = 36; image count = 25 unique media (63 references); connector count = 51; element-type histogram within ±5% of expectations (tables explode).
- `report.summary()` printed at end of import, contains all six counters.
- Two-user Yorkie integration test (lighter, in `packages/frontend/tests/app/slides/`) confirms the imported deck replicates between peers without divergence.
- Visual smoke: manually compare the first 5 slides side-by-side against the original PPT in PowerPoint or Google Slides; no missing elements; text content hashes match.
- `pnpm verify:fast` + `pnpm verify:integration` + `pnpm verify:browser:docker` all green.
