import type { InlineStyle, BlockStyle } from '../model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../model/types.js';
import { twipsToPx, halfPointsToPoints } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function getW(el: Element, localName: string): Element | null {
  return el.getElementsByTagNameNS(W, localName)[0] ?? null;
}

function getWAttr(el: Element, attr: string): string | null {
  return el.getAttributeNS(W, attr) || el.getAttribute(`w:${attr}`);
}

/**
 * Map <w:rPr> element to InlineStyle.
 */
export function mapRunProperties(rPr: Element): InlineStyle {
  const style: InlineStyle = {};

  if (getW(rPr, 'b')) style.bold = true;
  if (getW(rPr, 'i')) style.italic = true;
  if (getW(rPr, 'strike')) style.strikethrough = true;

  const u = getW(rPr, 'u');
  if (u) {
    const val = getWAttr(u, 'val');
    if (val && val !== 'none') style.underline = true;
  }

  const sz = getW(rPr, 'sz');
  if (sz) {
    const val = getWAttr(sz, 'val');
    if (val) style.fontSize = halfPointsToPoints(parseInt(val, 10));
  }

  const rFonts = getW(rPr, 'rFonts');
  if (rFonts) {
    const font = getWAttr(rFonts, 'ascii') || getWAttr(rFonts, 'eastAsia') || getWAttr(rFonts, 'hAnsi');
    if (font) style.fontFamily = font;
  }

  const color = getW(rPr, 'color');
  if (color) {
    const val = getWAttr(color, 'val');
    if (val && val !== 'auto') style.color = `#${val}`;
  }

  const highlight = getW(rPr, 'highlight');
  if (highlight) {
    const val = getWAttr(highlight, 'val');
    if (val) style.backgroundColor = mapHighlightColor(val);
  }

  const shd = getW(rPr, 'shd');
  if (shd && !style.backgroundColor) {
    const fill = getWAttr(shd, 'fill');
    if (fill && fill !== 'auto') style.backgroundColor = `#${fill}`;
  }

  const vertAlign = getW(rPr, 'vertAlign');
  if (vertAlign) {
    const val = getWAttr(vertAlign, 'val');
    if (val === 'superscript') style.superscript = true;
    if (val === 'subscript') style.subscript = true;
  }

  return style;
}

/**
 * Map <w:pPr> element to block style + block type metadata.
 */
export function mapParagraphProperties(pPr: Element): {
  blockStyle: BlockStyle;
  headingLevel?: number;
  blockType?: string;
} {
  const blockStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  let headingLevel: number | undefined;
  let blockType: string | undefined;

  const jc = getW(pPr, 'jc');
  if (jc) {
    const val = getWAttr(jc, 'val');
    if (val === 'center') blockStyle.alignment = 'center';
    else if (val === 'right') blockStyle.alignment = 'right';
    else if (val === 'both') blockStyle.alignment = 'justify';
    else blockStyle.alignment = 'left';
  }

  const spacing = getW(pPr, 'spacing');
  if (spacing) {
    const before = getWAttr(spacing, 'before');
    if (before) blockStyle.marginTop = twipsToPx(parseInt(before, 10));
    const after = getWAttr(spacing, 'after');
    if (after) blockStyle.marginBottom = twipsToPx(parseInt(after, 10));
    const line = getWAttr(spacing, 'line');
    if (line) {
      const lineVal = parseInt(line, 10);
      // line value of 240 = single spacing (1.0)
      if (lineVal > 0) blockStyle.lineHeight = lineVal / 240;
    }
  }

  const ind = getW(pPr, 'ind');
  if (ind) {
    const firstLine = getWAttr(ind, 'firstLine');
    if (firstLine) blockStyle.textIndent = twipsToPx(parseInt(firstLine, 10));
    const left = getWAttr(ind, 'left');
    if (left) blockStyle.marginLeft = twipsToPx(parseInt(left, 10));
  }

  const pStyle = getW(pPr, 'pStyle');
  if (pStyle) {
    const val = getWAttr(pStyle, 'val');
    if (val) {
      // Common heading style IDs
      const headingMatch = val.match(/^(?:Heading|heading)(\d)$/);
      if (headingMatch) {
        headingLevel = parseInt(headingMatch[1], 10);
        blockType = 'heading';
      }
      // Korean style IDs are sometimes just numbers
      if (/^\d$/.test(val)) {
        headingLevel = parseInt(val, 10);
        blockType = 'heading';
      }
    }
  }

  return { blockStyle, headingLevel, blockType };
}

/**
 * Map <w:tcPr> to cell background and border styles.
 */
export function mapTableCellProperties(tcPr: Element): {
  backgroundColor?: string;
  borderTop?: { width: number; color: string; style: 'solid' | 'none' };
  borderBottom?: { width: number; color: string; style: 'solid' | 'none' };
  borderLeft?: { width: number; color: string; style: 'solid' | 'none' };
  borderRight?: { width: number; color: string; style: 'solid' | 'none' };
  colSpan?: number;
  vMerge?: 'restart' | 'continue';
} {
  const result: ReturnType<typeof mapTableCellProperties> = {};

  const shd = getW(tcPr, 'shd');
  if (shd) {
    const fill = getWAttr(shd, 'fill');
    if (fill && fill !== 'auto') result.backgroundColor = `#${fill}`;
  }

  const gridSpan = getW(tcPr, 'gridSpan');
  if (gridSpan) {
    const val = getWAttr(gridSpan, 'val');
    if (val) result.colSpan = parseInt(val, 10);
  }

  const vMerge = getW(tcPr, 'vMerge');
  if (vMerge) {
    const val = getWAttr(vMerge, 'val');
    result.vMerge = val === 'restart' ? 'restart' : 'continue';
  }

  const tcBorders = getW(tcPr, 'tcBorders');
  if (tcBorders) {
    const sides = [
      ['top', 'borderTop'],
      ['bottom', 'borderBottom'],
      ['left', 'borderLeft'],
      ['right', 'borderRight'],
    ] as const;
    for (const [side, key] of sides) {
      const borderEl = getW(tcBorders, side);
      if (borderEl) {
        const sz = getWAttr(borderEl, 'sz');
        const color = getWAttr(borderEl, 'color');
        const val = getWAttr(borderEl, 'val');
        result[key] = {
          width: sz ? parseInt(sz, 10) / 8 : 1, // eighths of a point → px approximation
          color: color && color !== 'auto' ? `#${color}` : '#000000',
          style: val === 'none' || val === 'nil' ? 'none' : 'solid',
        };
      }
    }
  }

  return result;
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FFFF00',
  green: '#00FF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  blue: '#0000FF',
  red: '#FF0000',
  darkBlue: '#00008B',
  darkCyan: '#008B8B',
  darkGreen: '#006400',
  darkMagenta: '#8B008B',
  darkRed: '#8B0000',
  darkYellow: '#808000',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
  black: '#000000',
  white: '#FFFFFF',
};

export function mapHighlightColor(name: string): string {
  return HIGHLIGHT_COLORS[name] ?? '#FFFF00';
}
