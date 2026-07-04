import type { Inline, InlineStyle, BlockStyle, PageSetup, PageMargins, PaperSize } from '../model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../model/types.js';
import { mapRunProperties, mapParagraphProperties } from './docx-style-map.js';
import { twipsToPx, pointsToEmus, pxToEmus } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** An image placement parsed from a run: rId + EMU extent (0 = natural size). */
type ImageRef = { rId: string; cx: number; cy: number };

/**
 * Convert a VML CSS length (e.g. "108pt", "2in", "3cm", "96px") to EMUs.
 * A bare number defaults to points, matching VML's implicit unit. Unknown
 * or unparseable values yield 0 so the natural image size is used instead.
 */
function vmlLengthToEmus(raw: string | undefined): number {
  if (!raw) return 0;
  const m = /^([0-9.]+)\s*(pt|in|cm|mm|px)?$/i.exec(raw.trim());
  if (!m) return 0;
  const value = parseFloat(m[1]);
  switch ((m[2] || 'pt').toLowerCase()) {
    case 'in':
      return Math.round(value * 914400);
    case 'cm':
      return Math.round(value * 360000);
    case 'mm':
      return Math.round(value * 36000);
    case 'px':
      return pxToEmus(value);
    default:
      return pointsToEmus(value);
  }
}

/**
 * Parse a legacy VML shape's CSS `style` attribute into an EMU extent so it
 * shares the DrawingML `<wp:extent>` contract downstream (e.g.
 * "width:108pt;height:155.25pt").
 */
function parseVmlExtent(styleAttr: string | null): { cx: number; cy: number } {
  if (!styleAttr) return { cx: 0, cy: 0 };
  const w = /(?:^|;)\s*width:\s*([^;]+)/i.exec(styleAttr);
  const h = /(?:^|;)\s*height:\s*([^;]+)/i.exec(styleAttr);
  return { cx: vmlLengthToEmus(w?.[1]), cy: vmlLengthToEmus(h?.[1]) };
}

/**
 * Emit a pending image inline plus its extent ref using the shared contract
 * the importer resolves after upload: an OBJECT REPLACEMENT CHARACTER inline
 * carrying a `__pending__:<rId>` src that convertParagraph later swaps for the
 * uploaded URL, sized from the EMU extent. Shared by the DrawingML and VML
 * paths so the placeholder contract lives in one place.
 */
function pushPendingImage(
  inlines: Inline[],
  imageRefs: ImageRef[],
  rId: string,
  cx: number,
  cy: number,
  style: InlineStyle,
): void {
  imageRefs.push({ rId, cx, cy });
  inlines.push({
    text: '\uFFFC',
    style: { ...style, image: { src: `__pending__:${rId}`, width: 0, height: 0 } },
  });
}

/**
 * Import a legacy VML inline image from a `<w:pict>`. Returns true when an
 * image inline was emitted (so the caller may skip the run's text). Returns
 * false when the pict is not an embedded inline image — no `<v:imagedata>`,
 * an empty rId, or a floating/absolutely-positioned shape (watermark,
 * behind-text). This mirrors the DrawingML path, which imports only
 * `<wp:inline>` and skips floating `<wp:anchor>` shapes; returning false lets
 * the caller preserve any sibling text such non-image picts may carry.
 */
function tryImportVmlImage(
  pict: Element,
  style: InlineStyle,
  inlines: Inline[],
  imageRefs: ImageRef[],
): boolean {
  const imagedata = pict.getElementsByTagNameNS(V, 'imagedata')[0];
  if (!imagedata) return false;
  const rId = imagedata.getAttributeNS(R_NS, 'id') || imagedata.getAttribute('r:id') || '';
  if (!rId) return false;
  const styleAttr = imagedata.parentElement?.getAttribute('style') ?? null;
  // Skip floating shapes to match the DrawingML inline-only behavior.
  if (styleAttr && /position:\s*absolute/i.test(styleAttr)) return false;
  const { cx, cy } = parseVmlExtent(styleAttr);
  pushPendingImage(inlines, imageRefs, rId, cx, cy, style);
  return true;
}

export interface RelEntry {
  target: string;
  type: string;
}

/**
 * Parse a .rels XML file into a Map of relationship ID → target + type.
 */
export function parseRelationships(xml: string): Map<string, RelEntry> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rels = new Map<string, RelEntry>();
  const elements = doc.getElementsByTagNameNS(RELS, 'Relationship');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const id = el.getAttribute('Id') || '';
    const target = el.getAttribute('Target') || '';
    const fullType = el.getAttribute('Type') || '';
    // Extract short type from the full URI
    const type = fullType.split('/').pop() || '';
    rels.set(id, { target, type });
  }
  return rels;
}

/**
 * Parse a <w:p> element into inlines and block metadata.
 */
export function parseParagraph(pEl: Element): {
  inlines: Inline[];
  blockStyle: BlockStyle;
  blockType: string;
  headingLevel?: number;
  imageRefs: ImageRef[];
} {
  let blockStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  let blockType = 'paragraph';
  let headingLevel: number | undefined;
  const imageRefs: ImageRef[] = [];

  const pPr = pEl.getElementsByTagNameNS(W, 'pPr')[0];
  if (pPr) {
    const mapped = mapParagraphProperties(pPr);
    blockStyle = mapped.blockStyle;
    if (mapped.blockType) blockType = mapped.blockType;
    if (mapped.headingLevel) headingLevel = mapped.headingLevel;
  }

  const inlines: Inline[] = [];
  const runs = pEl.getElementsByTagNameNS(W, 'r');
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    // Skip runs that are not a direct child of the paragraph or a hyperlink.
    // Without this guard, runs inside nested structures we don't handle
    // (e.g. w:sdt) leak into the surrounding paragraph's inline list.
    if (r.parentElement !== pEl && r.parentElement?.localName !== 'hyperlink') {
      continue;
    }

    let style: InlineStyle = {};
    const rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
    if (rPr) {
      style = mapRunProperties(rPr);
    }

    // Check for DrawingML image (<w:drawing> → <wp:inline> → <a:blip>).
    const drawing = r.getElementsByTagNameNS(W, 'drawing')[0];
    if (drawing) {
      const inlineDrawing = drawing.getElementsByTagNameNS(WP, 'inline')[0];
      if (inlineDrawing) {
        const extent = inlineDrawing.getElementsByTagNameNS(WP, 'extent')[0];
        const cx = extent ? parseInt(extent.getAttribute('cx') || '0', 10) : 0;
        const cy = extent ? parseInt(extent.getAttribute('cy') || '0', 10) : 0;

        const blip = inlineDrawing.getElementsByTagNameNS(A, 'blip')[0];
        const rId = blip?.getAttributeNS(R_NS, 'embed') || blip?.getAttribute('r:embed') || '';

        if (rId) pushPendingImage(inlines, imageRefs, rId, cx, cy, style);
      }
      // A <w:drawing> run carries no sibling text, so always skip it.
      continue;
    }

    // Check for legacy VML image (<w:pict> → <v:shape> → <v:imagedata>).
    // Older Word / Google-Docs exports embed pictures this way instead of
    // DrawingML. Only skip the run's text when an inline image was actually
    // emitted — a <w:pict> can also be a non-image VML shape (rule, watermark)
    // that carries sibling text which must survive.
    const pict = r.getElementsByTagNameNS(W, 'pict')[0];
    if (pict && tryImportVmlImage(pict, style, inlines, imageRefs)) {
      continue;
    }

    // Walk direct children in document order so that a run like
    // "A<w:tab/>B<w:br/>C" produces "A\tB\nC" rather than collapsing all
    // text into "ABC\t\n".
    let text = '';
    for (let j = 0; j < r.childNodes.length; j++) {
      const child = r.childNodes[j];
      if (child.nodeType !== 1) continue;
      const childEl = child as Element;
      if (childEl.namespaceURI !== W) continue;
      const local = childEl.localName;
      if (local === 't') {
        text += childEl.textContent || '';
      } else if (local === 'tab') {
        text += '\t';
      } else if (local === 'br') {
        text += '\n';
      }
    }

    if (text) {
      inlines.push({ text, style });
    }
  }

  // Ensure at least one inline (empty paragraphs)
  if (inlines.length === 0) {
    inlines.push({ text: '', style: {} });
  }

  return { inlines, blockStyle, blockType, headingLevel, imageRefs };
}

/**
 * Parse <w:sectPr> into PageSetup.
 */
export function parsePageSetup(sectPr: Element): PageSetup {
  const pgSz = sectPr.getElementsByTagNameNS(W, 'pgSz')[0];
  const pgMar = sectPr.getElementsByTagNameNS(W, 'pgMar')[0];

  let width = 816; // Letter default
  let height = 1056;
  let orientation: 'portrait' | 'landscape' = 'portrait';

  if (pgSz) {
    const w = pgSz.getAttributeNS(W, 'w') || pgSz.getAttribute('w:w');
    const h = pgSz.getAttributeNS(W, 'h') || pgSz.getAttribute('w:h');
    const orient = pgSz.getAttributeNS(W, 'orient') || pgSz.getAttribute('w:orient');
    if (w) width = Math.round(twipsToPx(parseInt(w, 10)));
    if (h) height = Math.round(twipsToPx(parseInt(h, 10)));
    if (orient === 'landscape') orientation = 'landscape';
  }

  const margins: PageMargins = { top: 96, bottom: 96, left: 96, right: 96 };
  if (pgMar) {
    const getMargin = (name: string) => {
      const val = pgMar.getAttributeNS(W, name) || pgMar.getAttribute(`w:${name}`);
      return val ? Math.round(twipsToPx(parseInt(val, 10))) : undefined;
    };
    const t = getMargin('top');     if (t !== undefined) margins.top = t;
    const b = getMargin('bottom');  if (b !== undefined) margins.bottom = b;
    const l = getMargin('left');    if (l !== undefined) margins.left = l;
    const r = getMargin('right');   if (r !== undefined) margins.right = r;
  }

  const paperSize: PaperSize = { name: 'Custom', width, height };

  return { paperSize, orientation, margins };
}
