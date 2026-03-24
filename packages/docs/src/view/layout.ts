import type { Block, Inline, InlineStyle } from '../model/types.js';
import { Theme, buildFont, ptToPx } from './theme.js';

const measureCache = new Map<string, number>();

export function cachedMeasureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
): number {
  const key = `${font}\t${text}`;
  let width = measureCache.get(key);
  if (width === undefined) {
    ctx.font = font;
    width = ctx.measureText(text).width;
    measureCache.set(key, width);
  }
  return width;
}

export function clearMeasureCache(): void {
  measureCache.clear();
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
}

/**
 * A wrapped line within a block.
 */
export interface LayoutLine {
  runs: LayoutRun[];
  y: number;
  height: number;
  width: number;
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
}

/**
 * Full document layout result.
 */
export interface DocumentLayout {
  blocks: LayoutBlock[];
  totalHeight: number;
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
  ctx: CanvasRenderingContext2D,
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
  let y = 0;

  for (const block of blocks) {
    y += block.style.marginTop;

    let lines: LayoutLine[];

    if (canUseCache && !dirtyBlockIds!.has(block.id) && cache!.blocks.has(block.id)) {
      lines = cache!.blocks.get(block.id)!.lines;
    } else {
      lines = layoutBlock(block, ctx, availableWidth);
      const lineHeightMultiplier = block.style.lineHeight ?? 1.5;

      let blockY = 0;
      for (const line of lines) {
        const maxFontSize = getLineMaxFontSizePx(line, block);
        const lineHeight = lineHeightMultiplier * maxFontSize;
        line.y = blockY;
        line.height = lineHeight;
        blockY += lineHeight;
      }

      const alignWidth = availableWidth - block.style.marginLeft;
      for (const line of lines) {
        applyAlignment(line, alignWidth, block.style.alignment);
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
    layout: { blocks: layoutBlocks, totalHeight: y },
    cache: { blocks: newCacheBlocks, contentWidth },
  };
}

/**
 * Layout a single block into wrapped lines.
 */
function layoutBlock(
  block: Block,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  // Measure all segments (word-level)
  const segments = measureSegments(block, ctx);

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
    // If adding this segment exceeds effective width and line is not empty,
    // wrap to next line
    if (lineWidth + seg.width > effectiveWidth && currentRuns.length > 0) {
      flushLine();
    }

    // Character-level fallback for segments wider than effectiveWidth
    if (seg.width > effectiveWidth && seg.text.length > 1) {
      ctx.font = buildFont(
        seg.style.fontSize,
        seg.style.fontFamily,
        seg.style.bold,
        seg.style.italic,
      );
      let charIdx = 0;
      while (charIdx < seg.text.length) {
        let endIdx = charIdx + 1;
        let runWidth = ctx.measureText(seg.text.slice(charIdx, endIdx)).width;
        while (endIdx < seg.text.length) {
          const nextWidth = ctx.measureText(seg.text.slice(charIdx, endIdx + 1)).width;
          if (lineWidth + nextWidth > effectiveWidth && endIdx > charIdx + 1) break;
          runWidth = nextWidth;
          endIdx++;
        }
        // If even a single char exceeds effectiveWidth and line is not empty, flush first
        if (lineWidth + runWidth > effectiveWidth && currentRuns.length > 0) {
          flushLine();
          continue; // Re-measure from charIdx on fresh line
        }
        currentRuns.push({
          inline: block.inlines[seg.inlineIndex],
          text: seg.text.slice(charIdx, endIdx),
          x: lineStartX + lineWidth,
          width: runWidth,
          inlineIndex: seg.inlineIndex,
          charStart: seg.charStart + charIdx,
          charEnd: seg.charStart + endIdx,
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
      inline: block.inlines[seg.inlineIndex],
      text: seg.text,
      x: lineStartX + lineWidth,
      width: seg.width,
      inlineIndex: seg.inlineIndex,
      charStart: seg.charStart,
      charEnd: seg.charEnd,
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
 * Break inlines into word-level segments and measure each.
 */
function measureSegments(
  block: Block,
  ctx: CanvasRenderingContext2D,
): MeasuredSegment[] {
  const segments: MeasuredSegment[] = [];

  for (let i = 0; i < block.inlines.length; i++) {
    const inline = block.inlines[i];
    const font = buildFont(
      inline.style.fontSize,
      inline.style.fontFamily,
      inline.style.bold,
      inline.style.italic,
    );

    // Split on word boundaries (keep spaces attached to preceding word)
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const width = cachedMeasureText(ctx, word, font);
      segments.push({
        text: word,
        style: inline.style,
        width,
        inlineIndex: i,
        charStart: charPos,
        charEnd: charPos + word.length,
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
function applyAlignment(
  line: LayoutLine,
  maxWidth: number,
  alignment: string,
): void {
  if (alignment === 'left' || line.runs.length === 0) return;

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
  if (block.inlines.length > 0 && block.inlines[0].style.fontSize) {
    return ptToPx(block.inlines[0].style.fontSize);
  }
  return ptToPx(Theme.defaultFontSize);
}

