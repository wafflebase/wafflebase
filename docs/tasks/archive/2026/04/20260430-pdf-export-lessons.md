# Docs PDF Export — Lessons Learned

Companion to `20260430-pdf-export-todo.md`. Captures non-obvious findings
discovered during implementation that would have shaved time off Phase 1.

## Status

All 28 tasks complete on branch `feature/pdf-export`. 26 commits.
- `674` docs tests pass (was `622` baseline; PDF export added `52` tests)
- `177` frontend tests pass (`docx-actions` refactor unbroken)
- `verify:fast` clean

## pdf-lib + fontkit quirks

### jsdom ArrayBuffer realm mismatch
`pdfDoc.embedFont(fontBuf, { subset: true })` fails under `// @vitest-environment jsdom`
with "Cannot read properties of undefined" because jsdom swaps `globalThis.ArrayBuffer`
to a different realm than Node's `Buffer.buffer`. **Wrap font buffers in
`new Uint8Array(fontBuf)`** — its realm matches what pdf-lib's check expects, and the
view is also safer for production paths where buffers may cross worker boundaries.

### Producer / Creator auto-stamping
Both `PDFDocument.create()` and `PDFDocument.load()` call `updateInfoDict()` which
overwrites `Producer` (and sometimes `Creator`) with pdf-lib's defaults. Custom values
from `setProducer` / `setCreator` get clobbered on save. **Pass `{ updateMetadata: false }`**
to both to preserve our values. Also pass to `load()` in tests that read back metadata.

### Reference allocation API
The plan suggested `ctx.nextObjectNumber()` for outline tree refs — that does NOT exist.
Use `ctx.nextRef()` instead. (`ctx.register(obj)` allocates AND assigns; useful when the
object is fully built. For chicken-and-egg cases like outline Prev/Next chains, allocate
refs first via `nextRef`, then `assign` after building items.)

### Outline title encoding
Use `PDFHexString.fromText(title)` (UTF-16 BE w/ BOM) instead of `PDFString.of(title)`
for outline `Title` entries. Plain `PDFString` mangles non-ASCII (Korean, accents).

## Layout / pagination type shapes

The plan was written from the design doc, not from reading `view/layout.ts` source.
Several field names were wrong:

| Plan said | Actual |
|---|---|
| `layoutDocument(doc)` | `computeLayout(blocks, ctx, contentWidth, dirtyBlockIds?, cache?)` returning `{ layout, cache }` — requires a `CanvasRenderingContext2D` with a working `measureText` |
| `pl.line.baseline` | Doesn't exist. Compute per-run: `baselineY = lineY + (lineHeight + fontSizePx * 0.8) / 2` (mirrors `doc-canvas.ts:718`) |
| `LayoutRun.x` cast needed | No cast — `x` is a real field on `LayoutRun` |
| `cell.style.borders.{top,right,...}` | `cell.style.borderTop`, `cell.style.borderRight`, etc. — four separate fields, NOT a nested object |
| `tableData.columnWidths` are pixels | They are **fractions** (sum to ~1). `computeTableLayout` multiplies by `contentWidth` |

For mock 2D context in jsdom tests:
```ts
{ measureText: (text) => ({ width: text.length * 8 }), font: '' }
```
Works for layout sizing. Production uses the real Canvas 2D context after
`document.fonts.load()` for Noto KR.

## Table painting architecture

`view/table-geometry.ts` (extracted in Task 4.1) holds the pure helpers shared between
Canvas and PDF painters: `computeTableRangeForPageLine`, `cellOriginPx`, `isCellCovered`,
`computeMergedCellLineLayouts`, `getBlockIndexForLine`. Side benefit of the extraction:
broke a runtime cycle between `table-renderer` and `table-layout`.

Page-local cell composition (for PDF):
- `pageX = pl.x + cellOriginPx().x`
- `pageY = pl.y - layoutTable.rowYOffsets[pl.lineIndex] + cellOriginPx().y`

For row splits across pages: shift `tableY` by `-rowSplitOffset` so a row-local Y of
`rowSplitOffset` lands at `pl.y` on the continuation page. Use pdf-lib `pushGraphicsState`
+ `clip` operators to clip drawing to the fragment's vertical extent (mirrors Canvas's
`ctx.save() / clip()`).

## Header / footer rendering

`getHeaderYStart` / `getFooterYStart` in `view/pagination.ts` return canvas-absolute Y
(includes inter-page gaps). PDF pages are independent coordinate spaces — bypass those
helpers and compute page-local:
- Header top: `header.marginFromEdge`
- Footer top: `pageHeight - footer.marginFromEdge - footerLayout.totalHeight`

Layout the header/footer block lists ONCE per export (they're page-independent). Wrap each
header/footer line in a synthetic `PageLine` (`blockIndex: 0`, computed `x`/`y`) and feed
through the existing `paintLine` pipeline — this gets hyperlinks, sup/sub, italic shim,
mixed-script run splitting, etc. for free.

`pageNumber` substitution happens at `paintRun` level: if `style.pageNumber === true`,
swap `run.text` with `String(ctx.pageNumber)` before `splitMixedScript`. Don't re-measure;
the placeholder defines the slot (acceptable for typical digit widths).

## List markers

Use `computeListCounters(blocks)` (already in `view/layout.ts`) — it only handles ordered
markers; unordered come from `UNORDERED_MARKERS[block.listLevel]`. Marker fields live on
the **Block** itself (`block.listKind`, `block.listLevel`), NOT inside `block.style`.

Marker x position: `pl.x + LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4` (matches
`doc-canvas.ts:540`). Draw with `sans-regular` regardless of body style. Only on the
first wrapped line of a list-item block (`pl.lineIndex === 0`).

## Italic Korean (oblique shim)

Noto Sans/Serif KR ship no italic variant. When `isItalicShim(style, isCJK)` is true,
manually skew via `concatTransformationMatrix(1, 0, tan(12°), 1, tx, ty)` wrapped in
`pushGraphicsState` / `popGraphicsState`. The bg rect, underline, strikethrough should
NOT be inside the skewed transform — they stay upright.

The skew + translation matrix form `[1 0 c 1 tx ty]` translates first, then skews about
the new origin, keeping the baseline at the original drawing point. Visual confirmation
of slant requires manual inspection in a viewer (automated tests only check byte-diff
+ valid PDF re-load).

## Build prerequisites for the worktree

`pnpm install` in the worktree alone is not enough — `verify:fast` runs frontend tests
that import from `@wafflebase/docs` and `@wafflebase/sheets`. These imports get redirected
by `tests/resolve-hooks.mjs` to `dist/...` if it exists, else to `src/index.ts`. The src
path triggers Node's `--experimental-strip-types` which can't handle TypeScript constructor
parameter properties (used in `view/find-replace.ts`). **Run `pnpm sheets build` and
`pnpm --filter @wafflebase/docs build` in fresh worktrees** before `verify:fast`, or add
that to the worktree setup script.

## Image inline positioning

Use the canvas renderer's bottom-aligned formula (`doc-canvas.ts:626-638`):
- Image bottom-left at `(lineX + run.x, lineY + lineHeight)`
- Width = `run.width`, height = `run.imageHeight` (both already scale-to-fit-adjusted by `layout.ts`)

The plan's suggestion (`y = baseYpx + image.height - run.ascent`) anchored to baseline,
but Canvas bottom-aligns — and the painter must match Canvas to keep visual parity.

`style.image.rotation` and `cropLeft/Right/Top/Bottom` are **not honored** in the PDF
painter yet; Canvas's simple text path doesn't apply them either. Track as follow-up.

## Things we deferred to manual verification

Automated tests cover **structural correctness** (re-loadable PDF, page count, byte-size
deltas proving draw calls happened). The following need a human eye in a real PDF reader.
Items marked `[x]` were verified during local testing of a Korean document with table,
list markers, and CJK punctuation; the rest are the remaining checklist for reviewers:

- [x] Korean text renders correctly in macOS Preview
- [x] CJK punctuation (※, etc.) renders correctly
- [x] Bullet markers (●○■) render correctly in body and table cells
- [x] Table borders render including default 1px black on cells with no per-edge style
- [ ] Korean text renders correctly in Adobe Reader (only Preview tested locally)
- [ ] Cmd+C copies real Unicode (not glyph IDs)
- [ ] Cmd+F finds Korean and Latin
- [ ] Hyperlinks click open in browser
- [ ] Outline panel shows headings as a tree (currently flat sibling chain — Phase 2 nesting)
- [ ] Print preview pagination matches on-screen
- [ ] Italic Korean slant looks natural (12° skew is the design choice)
- [ ] Image positioning visually matches Canvas

## Korean font format / subset trade-off (current state)

Settled after multiple local-test iterations. Tried four configurations — only one
produces correct glyphs reliably across documents:

| Source | Format | `subset` | Result |
|---|---|---|---|
| Google Fonts CSS API (UA spoof, `text=` subset) | WOFF2 | `true` | Garbled glyphs — `@pdf-lib/fontkit` has no Brotli decoder, reads compressed bytes raw |
| `notofonts/noto-cjk` SubsetOTF/KR (jsdelivr) | OTF (CFF) | `true` | `RangeError: value argument is out of bounds` in `CFFSubset.encode` |
| `notofonts/noto-cjk` SubsetOTF/KR (jsdelivr) | OTF (CFF) | `false` | ✅ Correct glyphs, ~5–7 MB embedded font per variant |
| `google/fonts` variable TTF (raw GitHub) | TTF (variable wght) | `true` | Glyphs render *intermittently* — fontkit appears to drop characters when subsetting variable outlines (e.g., "오픈소스" → only "소" visible) |

Current `pdf-fonts.ts` uses the third row: full Noto Sans/Serif KR OTF embedded with
`subset: false`. Trade-off: every Korean export carries the full font binary (~5–7 MB
each for the 4 Korean variants used). Acceptable for now; reduces to design-time concern.

Future paths if PDF size becomes a problem:
- Find a static-instance Korean TTF (not variable) and re-enable subsetting.
- Build a Korean font subsetter on the backend that returns a per-document TTF.
- Try a newer fontkit release that fixes the CFF subset bug; pdf-lib hasn't bumped its
  fontkit fork since the bug was filed.

## Follow-ups (not blocking ship)

- Self-host Noto Sans/Serif KR for stability (currently jsdelivr-served from
  `notofonts/noto-cjk@main` — fine while the upstream tag is stable).
- Resolve the size trade-off above so PDFs stop carrying ~25 MB of fonts.
- Nested tables inside cells (currently skipped: `if (line.nestedTable) continue;`).
- Image rotation + cropping.
- Heading-level outline nesting (currently flat sibling chain).
- Sub-path export (`@wafflebase/docs/pdf-exporter`) if bundle audit shows static-side
  imports drag PDF code into the main chunk.
- Verify the chunk-size gate (`harness.config.json`) accepts the new dynamic-import
  PDF chunk before pushing to CI; or split out a worker / sub-route to keep within the
  710 KB threshold.
