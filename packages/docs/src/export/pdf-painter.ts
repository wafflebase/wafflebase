import {
  PDFDocument, PDFPage, PDFFont, rgb,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  PDFName, PDFString, PDFArray,
} from 'pdf-lib';
import type { Document, PageSetup, TableCell } from '../model/types.js';
import { LIST_INDENT_PX, UNORDERED_MARKERS } from '../model/types.js';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import type { DocumentLayout, LayoutBlock, LayoutLine, LayoutRun } from '../view/layout.js';
import type { LayoutTable, LayoutTableCell } from '../view/table-layout.js';
import { computeMergedCellLineLayouts } from '../view/table-geometry.js';
import { Theme, ptToPx } from '../view/theme.js';
import { PdfFonts, type PdfFontKey } from './pdf-fonts.js';
import {
  resolveFontKey,
  splitMixedScript,
  styleColor,
  isItalicShim,
} from './pdf-style-map.js';
import { paintTablePageRange, type CellRect } from './pdf-table-painter.js';

/**
 * Forward-slant approximation (~12°) used to fake italic for Korean
 * fonts that lack an italic variant. Applied as the `c` skew factor of
 * a PDF text-state transformation matrix.
 */
const ITALIC_SHIM_SKEW = Math.tan((12 * Math.PI) / 180);

const PX_PER_PT = 96 / 72;
const px2pt = (px: number) => px / PX_PER_PT;

/**
 * The 12 PDF font keys that the painter may reference. Embedded once
 * per export so subsequent draw calls can index into a fixed record.
 */
const FONT_KEYS: PdfFontKey[] = [
  'sans-regular', 'sans-bold', 'sans-italic', 'sans-boldItalic',
  'serif-regular', 'serif-bold', 'serif-italic', 'serif-boldItalic',
  'kr-sans-regular', 'kr-sans-bold',
  'kr-serif-regular', 'kr-serif-bold',
];

export type EmbeddedFonts = Record<PdfFontKey, PDFFont>;

export interface PaintContext {
  doc: Document;
  imageMap: Map<string, { embedded: unknown; width: number; height: number }>;
  pageNumber?: number;
  /**
   * Pre-computed header/footer layouts. Computed once by `PdfExporter`
   * (they don't depend on the body's pagination) and reused on every
   * page so each page can paint its own header/footer with the correct
   * `pageNumber` substitution.
   */
  headerLayout?: DocumentLayout | null;
  footerLayout?: DocumentLayout | null;
  /**
   * Display strings for ordered list-items (blockId → marker like "1.").
   * Computed once over the body's block list by `PdfExporter`. Unordered
   * list markers are derived directly from `block.listLevel` against
   * `UNORDERED_MARKERS` so they don't need to live in this map.
   */
  listCounters?: Map<string, string>;
  /**
   * Per-block layout (including `layoutTable` for table blocks). The
   * table painter looks up `layoutBlocks[pl.blockIndex]` to get the
   * `LayoutTable` it needs to compute cell rectangles. Indexed by
   * `blockIndex` exactly as the body lines reference.
   */
  layoutBlocks?: LayoutBlock[];
}

export class PdfPainter {
  /**
   * Embed every PDF font we might need for this document. Subsequent
   * draw calls index into the returned record by `PdfFontKey`. Each
   * font is subset-embedded, so the resulting PDF only carries glyphs
   * the document actually references.
   */
  static async embedAllFonts(
    pdfDoc: PDFDocument,
    fonts: PdfFonts,
  ): Promise<EmbeddedFonts> {
    const out: Partial<EmbeddedFonts> = {};
    for (const key of FONT_KEYS) {
      const buf = await fonts.load(key);
      out[key] = await pdfDoc.embedFont(new Uint8Array(buf), { subset: true });
    }
    return out as EmbeddedFonts;
  }

  /**
   * Paint a single `LayoutPage` onto a `PDFPage`. Iterates each
   * `PageLine` and delegates to `paintLine` for the actual run draws.
   * Coordinate system note: pdf-lib's origin is bottom-left in points,
   * while the layout uses top-left in pixels. Conversion happens here.
   */
  static paintPage(
    page: PDFPage,
    layoutPage: LayoutPage,
    pageSetup: PageSetup,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const pageHeightPt = page.getHeight();

    // Body lines. Table blocks span N PageLines (one per row, plus extras
    // for split rows) — when we hit the first PageLine of a table on this
    // page we delegate to `paintTablePageRange` and then skip ahead past
    // every PageLine the table consumes, so the table is painted as a
    // single fragment instead of once per row.
    let i = 0;
    while (i < layoutPage.lines.length) {
      const pl = layoutPage.lines[i];
      const lb = ctx.layoutBlocks?.[pl.blockIndex];
      if (lb && lb.block.type === 'table' && lb.layoutTable) {
        paintTablePageRange(
          page, layoutPage, pl, i, lb, pageHeightPt,
          (cell, layoutCell, layoutTable, r, _c, rect) => {
            PdfPainter.paintCellContent(
              page, cell, layoutCell, layoutTable, r, rect,
              pageHeightPt, fonts, ctx,
            );
          },
        );
        // Advance past every consecutive PageLine that belongs to this
        // table block. `paintTablePageRange` already covered them all
        // via `computeTableRangeForPageLine`, so painting them again
        // would draw the chrome multiple times.
        i++;
        while (i < layoutPage.lines.length
            && layoutPage.lines[i].blockIndex === pl.blockIndex) {
          i++;
        }
        continue;
      }

      PdfPainter.paintListMarker(page, pl, pageHeightPt, fonts, ctx);
      PdfPainter.paintLine(page, pl, pageHeightPt, fonts, ctx);
      i++;
    }

    // Header/footer regions. Page-local Y is computed directly here
    // because the canvas-side helpers (`getHeaderYStart` /
    // `getFooterYStart`) return canvas-absolute coordinates that include
    // `Theme.pageGap` between pages — that has no analog in the PDF
    // file, where each page is its own coordinate space. The canvas
    // formula collapses to:
    //   header page-local Y = marginFromEdge
    //   footer page-local Y = pageHeight - marginFromEdge - footerLayout.totalHeight
    PdfPainter.paintHeaderFooter(
      page, layoutPage, pageSetup, pageHeightPt, fonts, ctx,
    );
  }

  /**
   * Lay out the (already-measured) header and footer block lists on this
   * page. Each line is rewrapped as a synthetic `PageLine` so it flows
   * through the same `paintLine` → `paintRun` pipeline as body content.
   * That means page-number substitution, font-shim italic, hyperlinks,
   * etc. all work in headers/footers without duplicating draw code.
   */
  private static paintHeaderFooter(
    page: PDFPage,
    layoutPage: LayoutPage,
    pageSetup: PageSetup,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const { margins } = pageSetup;
    const pageHeightPx = layoutPage.height;

    const header = ctx.doc.header;
    if (header && ctx.headerLayout && ctx.headerLayout.blocks.length > 0) {
      const regionTopPx = header.marginFromEdge;
      PdfPainter.paintHFRegion(
        page, ctx.headerLayout, margins.left, regionTopPx,
        pageHeightPt, fonts, ctx,
      );
    }

    const footer = ctx.doc.footer;
    if (footer && ctx.footerLayout && ctx.footerLayout.blocks.length > 0) {
      const regionTopPx = pageHeightPx - footer.marginFromEdge
        - ctx.footerLayout.totalHeight;
      PdfPainter.paintHFRegion(
        page, ctx.footerLayout, margins.left, regionTopPx,
        pageHeightPt, fonts, ctx,
      );
    }
  }

  /**
   * Walk a header/footer `DocumentLayout` and paint every line at the
   * given region origin. `regionTopPx` is the page-local Y of the
   * region's first block; line Y values are then `regionTopPx + lb.y +
   * line.y`, mirroring how `doc-canvas` composes header/footer Ys.
   */
  private static paintHFRegion(
    page: PDFPage,
    layout: DocumentLayout,
    xPx: number,
    regionTopPx: number,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    for (const lb of layout.blocks) {
      for (let li = 0; li < lb.lines.length; li++) {
        const line = lb.lines[li];
        const pseudoPl: PageLine = {
          blockIndex: 0,
          lineIndex: li,
          line,
          x: xPx,
          y: regionTopPx + lb.y + line.y,
        };
        PdfPainter.paintLine(page, pseudoPl, pageHeightPt, fonts, ctx);
      }
    }
  }

  /**
   * Draw the bullet/number marker for a body list-item line, when this
   * is the line that opens the block (`lineIndex === 0`). Wrapped lines
   * inside the same block are skipped — Word/Docs convention is to
   * render the marker once per item, in the gutter to the left of the
   * text. Unordered markers come from `UNORDERED_MARKERS` cycled by
   * `listLevel`; ordered markers come from `ctx.listCounters` (computed
   * once in `PdfExporter`). The marker uses `sans-regular` regardless
   * of the body run's style — this matches the typical Word/Docs
   * convention and keeps the gutter visually neutral.
   *
   * Header/footer pseudo-PageLines pass `blockIndex: 0` and a region
   * relative `x`/`y`, but their lines don't index into `ctx.doc.blocks`
   * — `paintHFRegion` is the only caller that produces those, and it
   * doesn't go through `paintPage`, so this method is naturally limited
   * to body lines.
   */
  private static paintListMarker(
    page: PDFPage,
    pl: PageLine,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    if (pl.lineIndex !== 0) return;
    const block = ctx.doc.blocks[pl.blockIndex];
    if (!block || block.type !== 'list-item') return;

    const level = block.listLevel ?? 0;
    const marker = block.listKind === 'unordered'
      ? UNORDERED_MARKERS[level % UNORDERED_MARKERS.length]
      : (ctx.listCounters?.get(block.id) ?? '1.');
    if (!marker) return;

    // Match canvas: markerX = pageX + margins.left + LIST_INDENT_PX *
    // level + LIST_INDENT_PX / 2 - 4. In PDF land each page is its own
    // coord space (no `pageX`), and `pl.x === margins.left` for body
    // lines — so the equivalent is `pl.x + LIST_INDENT_PX * level +
    // LIST_INDENT_PX / 2 - 4`.
    const markerXpx = pl.x + LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4;

    const firstRun = pl.line.runs[0];
    const sizePt = firstRun?.inline.style.fontSize ?? Theme.defaultFontSize;
    const fontSizePx = ptToPx(sizePt);
    // Same baseline formula as `paintRun` so the marker sits on the
    // body's baseline.
    const baselineYpx = pl.y + (pl.line.height + fontSizePx * 0.8) / 2;

    const c = styleColor(firstRun?.inline.style.color);
    const font = fonts['sans-regular'];
    page.drawText(marker, {
      x: px2pt(markerXpx),
      y: pageHeightPt - px2pt(baselineYpx),
      size: sizePt,
      font,
      color: rgb(c.r, c.g, c.b),
    });
  }

  /**
   * Paint every run on a single page line. `LayoutLine` does not carry
   * a baseline; instead each run's baseline is computed from the line
   * top + line height + the run's own font size, matching the canvas
   * renderer's formula in `doc-canvas.ts`.
   */
  private static paintLine(
    page: PDFPage,
    pl: PageLine,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const line: LayoutLine = pl.line;
    if (line.runs.length === 0) return;

    const lineYpx = pl.y;
    const lineHeightPx = line.height;
    const lineXpx = pl.x;

    for (const run of line.runs) {
      PdfPainter.paintRun(
        page,
        run,
        lineXpx,
        lineYpx,
        lineHeightPx,
        pageHeightPt,
        fonts,
        ctx,
      );
    }
  }

  /**
   * Paint a single table cell's content onto the page. Mirrors the
   * canvas-side `renderTableContent` text path: vertical alignment
   * (`top`/`middle`/`bottom`), merged-cell line redistribution for
   * `top`-aligned `rowSpan > 1` cells, and per-block list markers.
   *
   * `layoutCell.lines` is already laid out (wrapping, alignment,
   * sup/sub) by `computeTableLayout` against `cellWidth - padding * 2`,
   * so this method just walks lines and reuses `paintLine` to draw
   * runs at `cellContentX + run.x, cellContentY + line.y`.
   */
  static paintCellContent(
    page: PDFPage,
    cell: TableCell,
    layoutCell: LayoutTableCell,
    layoutTable: LayoutTable,
    row: number,
    rect: CellRect,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const padding = cell.style?.padding ?? 4;
    const cellX = rect.x;
    const cellY = rect.y;
    const cellHeight = rect.h;

    const verticalAlign = cell.style?.verticalAlign ?? 'top';
    const totalTextHeight = layoutCell.lines.reduce((s, l) => s + l.height, 0);

    // Cell-local Y of the first line's top (before line.y is added).
    let textYOffset: number;
    if (verticalAlign === 'middle') {
      textYOffset = padding + (cellHeight - padding * 2 - totalTextHeight) / 2;
    } else if (verticalAlign === 'bottom') {
      textYOffset = cellHeight - padding - totalTextHeight;
    } else {
      textYOffset = padding;
    }

    const rowSpan = cell.rowSpan ?? 1;
    const mergedLineLayouts =
      rowSpan > 1 && verticalAlign === 'top'
        ? computeMergedCellLineLayouts(
            layoutCell.lines,
            row,
            rowSpan,
            padding,
            layoutTable.rowYOffsets,
            layoutTable.rowHeights,
          )
        : undefined;

    // tableY = page-local Y of the table's top edge (rect.y is in
    // page-local coordinates, and rect.y - rowYOffsets[row] === tableY).
    const tableY = cellY - layoutTable.rowYOffsets[row];

    // 1. Lines.
    for (let li = 0; li < layoutCell.lines.length; li++) {
      const line = layoutCell.lines[li];
      let lineYpx: number;
      if (mergedLineLayouts) {
        lineYpx = tableY + mergedLineLayouts[li].runLineY;
      } else {
        lineYpx = cellY + textYOffset + line.y;
      }
      // Nested table painting is out of scope for Task 4.3 — the canvas
      // recurses here, but in PDF the nested-table fragment is not yet
      // wired through. Skip cleanly so the cell at least renders its
      // text lines without crashing.
      if (line.nestedTable) continue;

      const pseudoPl: PageLine = {
        blockIndex: 0,
        lineIndex: li,
        line,
        x: cellX + padding,
        y: lineYpx,
      };
      PdfPainter.paintLine(page, pseudoPl, pageHeightPt, fonts, ctx);
    }

    // 2. List markers for list-item blocks inside the cell. Tracks an
    // ordered counter per level (resets on non-list-item blocks and
    // when the kind changes), mirroring the canvas pass.
    const { blockBoundaries } = layoutCell;
    if (cell.blocks && blockBoundaries.length > 0) {
      const listCounters = new Map<number, number>();
      for (let bi = 0; bi < cell.blocks.length; bi++) {
        const cellBlock = cell.blocks[bi];
        if (cellBlock.type !== 'list-item') {
          listCounters.clear();
          continue;
        }
        const level = cellBlock.listLevel ?? 0;
        for (const [k] of listCounters) {
          if (k > level) listCounters.delete(k);
        }
        if (cellBlock.listKind === 'unordered') {
          listCounters.delete(level);
        }
        const count = cellBlock.listKind === 'ordered'
          ? (listCounters.get(level) ?? 0) + 1
          : 0;
        if (cellBlock.listKind === 'ordered') {
          listCounters.set(level, count);
        }

        const firstLineIdx = blockBoundaries[bi];
        if (firstLineIdx === undefined || firstLineIdx >= layoutCell.lines.length) continue;
        const firstLine = layoutCell.lines[firstLineIdx];

        let markerLineY: number;
        if (mergedLineLayouts) {
          markerLineY = tableY + mergedLineLayouts[firstLineIdx].runLineY;
        } else {
          markerLineY = cellY + textYOffset + firstLine.y;
        }

        const markerIndent = LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4;
        const markerXpx = cellX + padding + markerIndent;

        const marker = cellBlock.listKind === 'unordered'
          ? UNORDERED_MARKERS[level % UNORDERED_MARKERS.length]
          : `${count}.`;

        const sizePt = cellBlock.inlines[0]?.style.fontSize ?? Theme.defaultFontSize;
        const fontSizePx = ptToPx(sizePt);
        const baselineYpx = markerLineY + (firstLine.height + fontSizePx * 0.8) / 2;
        const c = styleColor(cellBlock.inlines[0]?.style.color);
        const font = fonts['sans-regular'];
        page.drawText(marker, {
          x: px2pt(markerXpx),
          y: pageHeightPt - px2pt(baselineYpx),
          size: sizePt,
          font,
          color: rgb(c.r, c.g, c.b),
        });
      }
    }
  }

  /**
   * Draw a single text run. Splits the run text on CJK boundaries so
   * Latin glyphs use Helvetica-family fonts and CJK glyphs use Noto KR.
   * Skips image runs — image painting will be added in a later task.
   */
  private static paintRun(
    page: PDFPage,
    run: LayoutRun,
    lineXpx: number,
    lineYpx: number,
    lineHeightPx: number,
    pageHeightPt: number,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const style = run.inline.style;

    // Image runs are handled separately in a later task.
    if (style.image) return;

    const sizePt = style.fontSize ?? Theme.defaultFontSize;
    const fontSizePx = ptToPx(sizePt);

    // Match the canvas renderer's alphabetic baseline placement:
    //   baselineY = lineY + (lineHeight + fontSizePx * 0.8) / 2
    // (See doc-canvas.ts > renderRun.) We deliberately omit the
    // Math.round() the canvas does — PDF coordinates are continuous
    // and rounding causes vertical drift between pages.
    const baselineYpx = lineYpx + (lineHeightPx + fontSizePx * 0.8) / 2;

    const c = styleColor(style.color);

    // Page-number substitution: the layout was computed once over the
    // header/footer block list with the inline's literal text (e.g.
    // `"X"`); on each per-page paint we swap in the actual page number.
    // We don't re-measure the run's `x`/`width`, mirroring the canvas
    // renderer's behaviour — the literal placeholder defines the slot.
    const runText = style.pageNumber && ctx.pageNumber !== undefined
      ? String(ctx.pageNumber)
      : run.text;
    const segments = splitMixedScript(runText);
    let xpx = lineXpx + run.x;

    // Superscript/subscript scale text to ~70% of the run's font size and
    // shift the baseline relative to the original. The shift is expressed
    // in px so it composes with the layout's px-based baselineYpx; pdf-lib
    // y grows upward, so a negative `yOffsetPx` (toward page top) becomes
    // `-yOffsetPx` after the `pageHeightPt - px2pt(...)` flip, which means
    // we add yOffsetPx to baselineYpx in layout space and the final y on
    // the page moves accordingly.
    const ascentPxForOffset = fontSizePx * 0.8;
    let drawSizePt = sizePt;
    let yOffsetPx = 0;
    if (style.superscript) {
      drawSizePt = sizePt * 0.7;
      yOffsetPx = -ascentPxForOffset * 0.4;
    } else if (style.subscript) {
      drawSizePt = sizePt * 0.7;
      yOffsetPx = ascentPxForOffset * 0.2;
    }
    const drawSizePx = ptToPx(drawSizePt);
    const drawBaselineYpx = baselineYpx + yOffsetPx;

    // Approximate font metrics derived from the *effective* draw size so
    // sup/sub backgrounds, underlines, and strikethroughs hug the smaller
    // glyphs at their shifted baseline.
    const drawAscentPx = drawSizePx * 0.8;
    const drawDescentPx = drawSizePx * 0.2;

    for (const seg of segments) {
      if (seg.text.length === 0) continue;
      const key = resolveFontKey(style, seg.isCJK);
      const font = fonts[key];
      // Compute the segment width once; reused for background, advance,
      // underline, and strikethrough draws below. Width must be measured
      // at the effective draw size so sup/sub advance matches the glyphs.
      const segWidthPt = font.widthOfTextAtSize(seg.text, drawSizePt);

      // Background must be drawn first so the text and decorations
      // appear on top of it. PDF rectangles are anchored at the bottom
      // edge in page-up coordinates; the bottom sits `descent` below
      // the baseline.
      if (style.backgroundColor) {
        const bg = styleColor(style.backgroundColor);
        page.drawRectangle({
          x: px2pt(xpx),
          y: pageHeightPt - px2pt(drawBaselineYpx + drawDescentPx),
          width: segWidthPt,
          height: px2pt(drawAscentPx + drawDescentPx),
          color: rgb(bg.r, bg.g, bg.b),
        });
      }

      // Korean italic shim: Noto Sans/Serif KR have no italic variant,
      // so we synthesize one with a CTM skew. We translate to the run's
      // baseline, apply the skew about y=0 there, draw at (0, 0), then
      // pop the graphics state so background/underline/strike stay
      // upright. Background and decoration draws sit *outside* this
      // block intentionally.
      if (isItalicShim(style, seg.isCJK)) {
        const tx = px2pt(xpx);
        const ty = pageHeightPt - px2pt(drawBaselineYpx);
        page.pushOperators(pushGraphicsState());
        page.pushOperators(
          concatTransformationMatrix(1, 0, ITALIC_SHIM_SKEW, 1, tx, ty),
        );
        page.drawText(seg.text, {
          x: 0,
          y: 0,
          size: drawSizePt,
          font,
          color: rgb(c.r, c.g, c.b),
        });
        page.pushOperators(popGraphicsState());
      } else {
        page.drawText(seg.text, {
          x: px2pt(xpx),
          y: pageHeightPt - px2pt(drawBaselineYpx),
          size: drawSizePt,
          font,
          color: rgb(c.r, c.g, c.b),
        });
      }

      // Underline sits ~1px below the baseline (matching the canvas
      // renderer's `baselineY + 2` approximation, scaled down to keep
      // the line tight against the glyphs in PDF output).
      if (style.underline) {
        const underlineYpx = drawBaselineYpx + 1;
        page.drawLine({
          start: { x: px2pt(xpx), y: pageHeightPt - px2pt(underlineYpx) },
          end: { x: px2pt(xpx) + segWidthPt, y: pageHeightPt - px2pt(underlineYpx) },
          thickness: Math.max(0.5, drawSizePt / 16),
          color: rgb(c.r, c.g, c.b),
        });
      }

      // Strikethrough crosses the glyphs at roughly the x-height,
      // approximated as half the ascent above the baseline.
      if (style.strikethrough) {
        const strikeYpx = drawBaselineYpx - drawAscentPx / 2;
        page.drawLine({
          start: { x: px2pt(xpx), y: pageHeightPt - px2pt(strikeYpx) },
          end: { x: px2pt(xpx) + segWidthPt, y: pageHeightPt - px2pt(strikeYpx) },
          thickness: Math.max(0.5, drawSizePt / 16),
          color: rgb(c.r, c.g, c.b),
        });
      }

      // Hyperlink annotation: pdf-lib has no high-level Link API, so we
      // construct the dictionary ourselves and append a PDFRef to the
      // page's Annots array. Rect uses the same baseline/ascent/descent
      // box as the background rectangle so click targets line up with
      // the visible glyph cell.
      if (style.href) {
        const x1Pt = px2pt(xpx);
        const y1Pt = pageHeightPt - px2pt(drawBaselineYpx + drawDescentPx);
        const x2Pt = px2pt(xpx) + segWidthPt;
        const y2Pt = pageHeightPt - px2pt(drawBaselineYpx - drawAscentPx);
        addLinkAnnotation(page, [x1Pt, y1Pt, x2Pt, y2Pt], style.href);
      }

      // Advance by the glyph width in the embedded font, converted
      // back to px so we stay in layout-space for the next segment.
      xpx += segWidthPt * PX_PER_PT;
    }
  }
}

/**
 * Append a Link annotation with a URI action to a page's `Annots`
 * array. Creates the array if it doesn't already exist. Used for
 * inline runs whose `style.href` is set; the rect should match the
 * drawn glyph box so click targets align with the rendered text.
 */
function addLinkAnnotation(
  page: PDFPage,
  rect: [number, number, number, number],
  uri: string,
): void {
  const ctx = page.doc.context;
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: ctx.obj({
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(uri),
    }),
  });
  const annotRef = ctx.register(annot);
  const existing = page.node.get(PDFName.of('Annots'));
  if (existing instanceof PDFArray) {
    existing.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), ctx.obj([annotRef]));
  }
}
