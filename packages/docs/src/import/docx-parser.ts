import type { Inline, InlineStyle, BlockStyle, PageSetup, PageMargins, PaperSize } from '../model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../model/types.js';
import { mapRunProperties, mapParagraphProperties } from './docx-style-map.js';
import { twipsToPx } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

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
  imageRefs: Array<{ rId: string; cx: number; cy: number }>;
} {
  let blockStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  let blockType = 'paragraph';
  let headingLevel: number | undefined;
  const imageRefs: Array<{ rId: string; cx: number; cy: number }> = [];

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
    // Check if this run is a direct child (not inside a nested element like hyperlink)
    // by verifying its parent is either the paragraph or a hyperlink
    if (r.parentElement !== pEl && r.parentElement?.localName !== 'hyperlink') {
      // Skip runs inside nested structures we don't handle
    }

    let style: InlineStyle = {};
    const rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
    if (rPr) {
      style = mapRunProperties(rPr);
    }

    // Check for drawing (image)
    const drawing = r.getElementsByTagNameNS(W, 'drawing')[0];
    if (drawing) {
      const inlineDrawing = drawing.getElementsByTagNameNS(WP, 'inline')[0];
      if (inlineDrawing) {
        const extent = inlineDrawing.getElementsByTagNameNS(WP, 'extent')[0];
        const cx = extent ? parseInt(extent.getAttribute('cx') || '0', 10) : 0;
        const cy = extent ? parseInt(extent.getAttribute('cy') || '0', 10) : 0;

        const blip = inlineDrawing.getElementsByTagNameNS(A, 'blip')[0];
        const rId = blip?.getAttributeNS(R_NS, 'embed') || blip?.getAttribute('r:embed') || '';

        if (rId) {
          imageRefs.push({ rId, cx, cy });
          // Placeholder — the importer will fill in the actual URL after upload
          inlines.push({
            text: '\uFFFC',
            style: { ...style, image: { src: `__pending__:${rId}`, width: 0, height: 0 } },
          });
        }
      }
      continue;
    }

    // Regular text
    const textEls = r.getElementsByTagNameNS(W, 't');
    let text = '';
    for (let j = 0; j < textEls.length; j++) {
      text += textEls[j].textContent || '';
    }

    // Tab and break elements
    const tabs = r.getElementsByTagNameNS(W, 'tab');
    if (tabs.length > 0) text += '\t';
    const brs = r.getElementsByTagNameNS(W, 'br');
    if (brs.length > 0) text += '\n';

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
