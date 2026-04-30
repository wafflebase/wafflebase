import {
  PDFDocument, PDFPage, PDFFont, rgb,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  PDFName, PDFString, PDFArray,
} from 'pdf-lib';
import type { Document, PageSetup } from '../model/types.js';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import type { LayoutLine, LayoutRun } from '../view/layout.js';
import { Theme, ptToPx } from '../view/theme.js';
import { PdfFonts, type PdfFontKey } from './pdf-fonts.js';
import {
  resolveFontKey,
  splitMixedScript,
  styleColor,
  isItalicShim,
} from './pdf-style-map.js';

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
    _pageSetup: PageSetup,
    fonts: EmbeddedFonts,
    ctx: PaintContext,
  ): void {
    const pageHeightPt = page.getHeight();
    for (const pl of layoutPage.lines) {
      PdfPainter.paintLine(page, pl, pageHeightPt, fonts, ctx);
    }
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
    _ctx: PaintContext,
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
    const segments = splitMixedScript(run.text);
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
