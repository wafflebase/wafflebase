import {
  getHeadingDefaults,
  TITLE_DEFAULTS,
  SUBTITLE_DEFAULTS,
  LIST_INDENT_PX,
  type Block,
  type BlockCellInfo,
  type HeadingLevel,
  type Inline,
  type InlineStyle,
} from '../model/types.js';
import { Theme, ptToPx } from './theme.js';
import type { ResolvedFont, TextMeasurer } from './measurer.js';
import { computeTableLayout, type LayoutTable } from './table-layout.js';

/**
 * Stable string key for a `ResolvedFont`. Used as the prefix of the
 * `measureCache` key — same shape as the old CSS shorthand so cache
 * keys remain readable when debugging.
 */
function fontKey(font: ResolvedFont): string {
  return `${font.style}|${font.weight}|${font.size}|${font.family}`;
}

const measureCache = new Map<string, number>();

export function cachedMeasureText(
  measurer: TextMeasurer,
  text: string,
  font: ResolvedFont,
): number {
  const key = `${fontKey(font)}\t${text}`;
  let width = measureCache.get(key);
  if (width === undefined) {
    width = measurer.measureWidth(text, font);
    measureCache.set(key, width);
  }
  return width;
}

export function clearMeasureCache(): void {
  measureCache.clear();
}

/**
 * Convert an `InlineStyle` (and an optional super/subscript flag) into the
 * `ResolvedFont` measurement structure used by `TextMeasurer`. Centralised
 * here so layout, table-layout, and hit-testing share the same conversion
 * rules — getting these inconsistent quietly miscalculates line widths.
 *
 * Sup/sub runs measure at 60% of the inline's font size; the original
 * pt-based fontSize is converted to pixels via `ptToPx`.
 */
export function resolveInlineFont(
  style: InlineStyle,
  isSuperOrSub?: boolean,
): ResolvedFont {
  const baseSizePt = style.fontSize ?? Theme.defaultFontSize;
  const sizePt = isSuperOrSub ? baseSizePt * 0.6 : baseSizePt;
  return {
    family: style.fontFamily ?? Theme.defaultFontFamily,
    size: ptToPx(sizePt),
    weight: style.bold ? 'bold' : 'normal',
    style: style.italic ? 'italic' : 'normal',
  };
}

/**
 * For heading blocks, return inlines with heading default styles merged in.
 * Heading defaults act as a base layer; explicit inline styles override them.
 */
export function resolveBlockInlines(block: Block): Inline[] {
  let defaults: Partial<InlineStyle> | undefined;
  if (block.type === 'heading' && block.headingLevel) {
    defaults = getHeadingDefaults(block.headingLevel as HeadingLevel);
  } else if (block.type === 'title') {
    defaults = TITLE_DEFAULTS;
  } else if (block.type === 'subtitle') {
    defaults = SUBTITLE_DEFAULTS;
  }
  if (defaults) {
    return block.inlines.map((inline) => ({
      text: inline.text,
      style: { ...defaults, ...inline.style },
    }));
  }
  return block.inlines;
}

/**
 * A measured run of text within a line.
 */
export interface LayoutRun {
  inline: Inline;
  text: string;
  x: number;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  /** Cumulative pixel widths: charOffsets[i] = width of text.slice(0, i+1). Length === text.length. */
  charOffsets: number[];
  /**
   * For image inlines, the pixel height of the (possibly scaled) image.
   * Line height must grow to accommodate this. Undefined for text runs.
   */
  imageHeight?: number;
}

/**
 * A wrapped line within a block.
 */
export interface LayoutLine {
  runs: LayoutRun[];
  y: number;
  height: number;
  width: number;
  nestedTable?: LayoutTable;
}

/**
 * A positioned block in the document layout.
 */
export interface LayoutBlock {
  block: Block;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LayoutLine[];
  layoutTable?: LayoutTable;
}

/**
 * Full document layout result.
 */
export interface DocumentLayout {
  blocks: LayoutBlock[];
  totalHeight: number;
  blockParentMap: Map<string, BlockCellInfo>;
}

/**
 * Cache of per-block layout results for incremental recomputation.
 */
export interface LayoutCache {
  blocks: Map<string, LayoutBlock>;
  contentWidth: number;
}

/**
 * A segment of text with uniform style, ready for measurement.
 * Tracks which inline it came from and character offsets.
 */
interface MeasuredSegment {
  text: string;
  style: InlineStyle;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  font: ResolvedFont;
  /**
   * Intrinsic image dimensions for image inlines. When present, this segment
   * is treated as unbreakable and rendered as an image run. Width is the
   * intrinsic pixel width (pre-scale); rendering may scale down to fit.
   */
  image?: { width: number; height: number };
}

/**
 * Compute the full document layout.
 *
 * When `dirtyBlockIds` and `cache` are provided, only blocks whose IDs
 * appear in the dirty set are re-laid-out; cached line/run data is reused
 * for the rest. Y offsets are always recalculated for every block.
 */
export function computeLayout(
  blocks: Block[],
  measurer: TextMeasurer,
  contentWidth: number,
  dirtyBlockIds?: Set<string>,
  cache?: LayoutCache,
): { layout: DocumentLayout; cache: LayoutCache } {
  const availableWidth = contentWidth;
  const canUseCache = cache != null
    && dirtyBlockIds != null
    && cache.contentWidth === contentWidth;

  const newCacheBlocks = new Map<string, LayoutBlock>();
  const layoutBlocks: LayoutBlock[] = [];
  const blockParentMap = new Map<string, BlockCellInfo>();
  let y = 0;

  for (const block of blocks) {
    y += block.style.marginTop;

    // Apply list indent for list items
    let effectiveBlock = block;
    if (block.type === 'list-item') {
      const listIndent = LIST_INDENT_PX * ((block.listLevel ?? 0) + 1);
      effectiveBlock = {
        ...block,
        style: {
          ...block.style,
          marginLeft: (block.style.marginLeft ?? 0) + listIndent,
        },
      };
    }

    let lines: LayoutLine[];

    if (block.type === 'table' && block.tableData) {
      const tableLayout = computeTableLayout(block.tableData, block.id, measurer, availableWidth);
      // Merge per-table blockParentMap into document-level map
      for (const [k, v] of tableLayout.blockParentMap) {
        blockParentMap.set(k, v);
      }
      lines = [{ runs: [], y: 0, height: tableLayout.totalHeight, width: availableWidth }];
      const lb: LayoutBlock = {
        block,
        x: 0,
        y,
        width: availableWidth,
        height: tableLayout.totalHeight,
        lines,
        layoutTable: tableLayout,
      };
      layoutBlocks.push(lb);
      newCacheBlocks.set(block.id, lb);
      y += tableLayout.totalHeight + block.style.marginBottom;
      continue;
    }

    if (block.type === 'horizontal-rule' || block.type === 'page-break') {
      const HR_HEIGHT = 20;
      lines = [{ runs: [], y: 0, height: HR_HEIGHT, width: availableWidth }];
    } else if (canUseCache && !dirtyBlockIds!.has(block.id) && cache!.blocks.has(block.id)) {
      lines = cache!.blocks.get(block.id)!.lines;
    } else {
      lines = layoutBlock(effectiveBlock, measurer, availableWidth);
      assignLineHeights(lines, effectiveBlock);

      const alignWidth = availableWidth - effectiveBlock.style.marginLeft;
      for (let li = 0; li < lines.length; li++) {
        applyAlignment(lines[li], alignWidth, effectiveBlock.style.alignment, li === lines.length - 1);
      }
    }

    const blockHeight = lines.reduce((sum, l) => sum + l.height, 0);
    const lb: LayoutBlock = {
      block,
      x: 0,
      y,
      width: availableWidth,
      height: blockHeight,
      lines,
    };

    layoutBlocks.push(lb);
    newCacheBlocks.set(block.id, lb);
    y += blockHeight + block.style.marginBottom;
  }

  return {
    layout: { blocks: layoutBlocks, totalHeight: y, blockParentMap },
    cache: { blocks: newCacheBlocks, contentWidth },
  };
}

/**
 * Compute cumulative character pixel offsets for a run.
 * charOffsets[i] = width of text.slice(0, i + 1).
 */
export function computeCharOffsets(
  measurer: TextMeasurer,
  text: string,
  font: ResolvedFont,
): number[] {
  if (text.length === 0) return [];
  const offsets = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) {
    offsets[i] = measurer.measureWidth(text.slice(0, i + 1), font);
  }
  return offsets;
}

/**
 * Layout a single block into wrapped lines.
 */
export function layoutBlock(
  block: Block,
  measurer: TextMeasurer,
  maxWidth: number,
): LayoutLine[] {
  // Resolve heading defaults into inlines before measurement
  const inlines = resolveBlockInlines(block);
  // Measure all segments (word-level)
  const segments = measureSegments(inlines, measurer);

  if (segments.length === 0) {
    // Empty block — one empty line
    return [{ runs: [], y: 0, height: 0, width: 0 }];
  }

  const marginLeft = block.style.marginLeft ?? 0;
  const textIndent = block.style.textIndent ?? 0;

  // Word-wrap into lines
  const lines: LayoutLine[] = [];
  let currentRuns: LayoutRun[] = [];
  let lineWidth = 0;
  let lineStartX = marginLeft + textIndent;
  let effectiveWidth = maxWidth - marginLeft - textIndent;

  const flushLine = () => {
    lines.push({
      runs: currentRuns,
      y: 0,
      height: 0,
      width: lineWidth,
    });
    currentRuns = [];
    lineWidth = 0;
    lineStartX = marginLeft;
    effectiveWidth = maxWidth - marginLeft;
  };

  for (const seg of segments) {
    // Image segments are unbreakable. Scale down to fit the effective line
    // width if necessary, then emit a single run carrying the image height.
    if (seg.image) {
      let displayWidth = seg.image.width;
      let displayHeight = seg.image.height;
      if (effectiveWidth > 0 && displayWidth > effectiveWidth) {
        const scale = effectiveWidth / displayWidth;
        displayWidth = effectiveWidth;
        displayHeight = seg.image.height * scale;
      }
      // Wrap to next line if the scaled image won't fit next to existing runs.
      if (lineWidth + displayWidth > effectiveWidth && currentRuns.length > 0) {
        flushLine();
      }
      currentRuns.push({
        inline: inlines[seg.inlineIndex],
        text: seg.text,
        x: lineStartX + lineWidth,
        width: displayWidth,
        inlineIndex: seg.inlineIndex,
        charStart: seg.charStart,
        charEnd: seg.charEnd,
        // Single-character placeholder: charOffsets has one entry equal to width.
        charOffsets: seg.text.length > 0 ? [displayWidth] : [],
        imageHeight: displayHeight,
      });
      lineWidth += displayWidth;
      continue;
    }

    // If adding this segment exceeds effective width and line is not empty,
    // wrap to next line
    if (lineWidth + seg.width > effectiveWidth && currentRuns.length > 0) {
      flushLine();
    }

    // Character-level fallback for segments wider than effectiveWidth
    if (seg.width > effectiveWidth && seg.text.length > 1) {
      // `seg.font` was resolved with the same sup/sub adjustment as the
      // word-level measurement, so re-using it here keeps character
      // widths consistent with the segment's nominal width.
      const charFont = seg.font;
      let charIdx = 0;
      while (charIdx < seg.text.length) {
        let endIdx = charIdx + 1;
        let runWidth = measurer.measureWidth(seg.text.slice(charIdx, endIdx), charFont);
        while (endIdx < seg.text.length) {
          const nextWidth = measurer.measureWidth(seg.text.slice(charIdx, endIdx + 1), charFont);
          if (lineWidth + nextWidth > effectiveWidth && endIdx > charIdx + 1) break;
          runWidth = nextWidth;
          endIdx++;
        }
        // If even a single char exceeds effectiveWidth and line is not empty, flush first
        if (lineWidth + runWidth > effectiveWidth && currentRuns.length > 0) {
          flushLine();
          continue; // Re-measure from charIdx on fresh line
        }
        const sliceText = seg.text.slice(charIdx, endIdx);
        currentRuns.push({
          inline: inlines[seg.inlineIndex],
          text: sliceText,
          x: lineStartX + lineWidth,
          width: runWidth,
          inlineIndex: seg.inlineIndex,
          charStart: seg.charStart + charIdx,
          charEnd: seg.charStart + endIdx,
          charOffsets: computeCharOffsets(measurer, sliceText, charFont),
        });
        lineWidth += runWidth;
        charIdx = endIdx;
        if (lineWidth >= effectiveWidth && charIdx < seg.text.length) {
          flushLine();
        }
      }
      continue;
    }

    currentRuns.push({
      inline: inlines[seg.inlineIndex],
      text: seg.text,
      x: lineStartX + lineWidth,
      width: seg.width,
      inlineIndex: seg.inlineIndex,
      charStart: seg.charStart,
      charEnd: seg.charEnd,
      charOffsets: computeCharOffsets(measurer, seg.text, seg.font),
    });
    lineWidth += seg.width;
  }

  // Flush remaining runs
  if (currentRuns.length > 0) {
    lines.push({
      runs: currentRuns,
      y: 0,
      height: 0,
      width: lineWidth,
    });
  }

  return lines;
}

/**
 * Set `line.y` and `line.height` for each line based on the block's
 * lineHeight multiplier, the tallest run font size, and image runs.
 *
 * Body paragraphs and cell paragraphs both use this so wrapped-line
 * heights are computed identically.
 */
export function assignLineHeights(lines: LayoutLine[], block: Block): void {
  // Floor at 1.0: a sub-1.0 multiplier collapses the line below the font's
  // own pixel height, so characters from adjacent lines overlap. The DOCX
  // import path can plant such values when <w:spacing w:line="N"
  // w:lineRule="exact|atLeast"/> is read as a 240ths-of-a-line multiplier.
  const lineHeightMultiplier = Math.max(1, block.style.lineHeight ?? 1.5);
  let blockY = 0;
  for (const line of lines) {
    const maxFontSize = getLineMaxFontSizePx(line, block);
    let lineHeight = lineHeightMultiplier * maxFontSize;
    for (const run of line.runs) {
      if (run.imageHeight !== undefined && run.imageHeight > lineHeight) {
        lineHeight = run.imageHeight;
      }
    }
    line.y = blockY;
    line.height = lineHeight;
    blockY += lineHeight;
  }
}

/**
 * Break inlines into word-level segments and measure each.
 */
function measureSegments(
  inlines: Inline[],
  measurer: TextMeasurer,
): MeasuredSegment[] {
  const segments: MeasuredSegment[] = [];

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    // Superscript/subscript runs use 60% of the original font size for measurement
    const isSuperOrSub = !!(inline.style.superscript || inline.style.subscript);
    const font = resolveInlineFont(inline.style, isSuperOrSub);

    // Image inlines are a single unbreakable segment spanning the entire
    // inline text (the Object Replacement Character placeholder). Width
    // comes from the image metadata rather than text measurement; any
    // scale-to-fit is applied later in layoutBlock.
    if (inline.style.image) {
      const image = inline.style.image;
      segments.push({
        text: inline.text,
        style: inline.style,
        width: image.width,
        inlineIndex: i,
        charStart: 0,
        charEnd: inline.text.length,
        font,
        image: { width: image.width, height: image.height },
      });
      continue;
    }

    // Split on word boundaries (keep spaces attached to preceding word)
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const width = cachedMeasureText(measurer, word, font);
      segments.push({
        text: word,
        style: inline.style,
        width,
        inlineIndex: i,
        charStart: charPos,
        charEnd: charPos + word.length,
        font,
      });
      charPos += word.length;
    }
  }

  return segments;
}

/**
 * Split text into words, keeping trailing spaces with the word.
 */
function splitWords(text: string): string[] {
  if (text.length === 0) return [];

  const words: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    current += text[i];
    // Break after space if the next char is not a space
    if (text[i] === ' ' && i + 1 < text.length && text[i + 1] !== ' ') {
      words.push(current);
      current = '';
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

/**
 * Apply horizontal alignment to a line's runs.
 */
export function applyAlignment(
  line: LayoutLine,
  maxWidth: number,
  alignment: string,
  isLastLine: boolean,
): void {
  if (alignment === 'left' || line.runs.length === 0) return;

  if (alignment === 'justify') {
    // Don't justify the last line of a block
    if (isLastLine || line.runs.length <= 1) return;
    const extraSpace = maxWidth - line.width;
    if (extraSpace <= 0) return;
    const gaps = line.runs.length - 1;
    const perGap = extraSpace / gaps;
    for (let i = 1; i < line.runs.length; i++) {
      line.runs[i].x += perGap * i;
    }
    line.width = maxWidth;
    return;
  }

  const offset =
    alignment === 'center'
      ? (maxWidth - line.width) / 2
      : maxWidth - line.width; // right

  for (const run of line.runs) {
    run.x += offset;
  }
}

/**
 * Get the maximum font size across all runs in a line.
 * Falls back to the block's first inline or the theme default.
 */
function getLineMaxFontSizePx(line: LayoutLine, block: Block): number {
  let max = 0;
  for (const run of line.runs) {
    const size = ptToPx(run.inline.style.fontSize ?? Theme.defaultFontSize);
    if (size > max) max = size;
  }
  if (max > 0) return max;

  // For empty lines, resolve font size from block type defaults
  let fallbackSize: number | undefined;
  if (block.type === 'title') {
    fallbackSize = TITLE_DEFAULTS.fontSize;
  } else if (block.type === 'subtitle') {
    fallbackSize = SUBTITLE_DEFAULTS.fontSize;
  } else if (block.type === 'heading' && block.headingLevel) {
    fallbackSize = getHeadingDefaults(block.headingLevel as HeadingLevel).fontSize;
  }
  if (block.inlines.length > 0 && block.inlines[0].style.fontSize) {
    fallbackSize = block.inlines[0].style.fontSize;
  }
  return ptToPx(fallbackSize ?? Theme.defaultFontSize);
}

/**
 * Compute display numbers for ordered list items.
 * Returns a map of blockId → display number string.
 * Consecutive ordered list-items at the same level share a counter.
 */
export function computeListCounters(blocks: Block[]): Map<string, string> {
  const counters = new Map<string, string>();
  const levelCounters: number[] = [];

  for (const block of blocks) {
    if (block.type !== 'list-item' || block.listKind !== 'ordered') {
      levelCounters.length = 0; // Reset on non-list block
      continue;
    }
    const level = block.listLevel ?? 0;
    // Trim counters above this level
    levelCounters.length = Math.max(levelCounters.length, level + 1);
    if (levelCounters[level] === undefined) levelCounters[level] = 0;
    levelCounters[level]++;
    // Reset deeper levels
    for (let i = level + 1; i < levelCounters.length; i++) {
      levelCounters[i] = 0;
    }
    counters.set(block.id, formatOrderedMarker(levelCounters[level], level));
  }
  return counters;
}

function formatOrderedMarker(num: number, level: number): string {
  const format = level % 3;
  if (format === 0) return `${num}.`;
  if (format === 1) return `${String.fromCharCode(96 + ((num - 1) % 26) + 1)}.`;
  // lower-roman for level 2, 5, 8...
  return `${toRoman(num)}.`;
}

function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}

