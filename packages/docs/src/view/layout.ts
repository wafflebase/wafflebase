import type { Block, Inline, InlineStyle } from '../model/types.js';
import { Theme, buildFont } from './theme.js';

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
 */
export function computeLayout(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): DocumentLayout {
  const availableWidth = canvasWidth - Theme.pagePaddingX * 2;
  const layoutBlocks: LayoutBlock[] = [];
  let y = Theme.pagePaddingTop;

  for (const block of blocks) {
    y += block.style.marginTop;

    const lines = layoutBlock(block, ctx, availableWidth);
    const lineHeightMultiplier = block.style.lineHeight ?? 1.5;

    let blockHeight = 0;
    for (const line of lines) {
      const maxFontSize = getLineMaxFontSize(line, block);
      const lineHeight = lineHeightMultiplier * maxFontSize;
      line.y = blockHeight;
      line.height = lineHeight;
      blockHeight += lineHeight;
    }

    // Apply alignment
    for (const line of lines) {
      applyAlignment(line, availableWidth, block.style.alignment);
    }

    const layoutBlock_: LayoutBlock = {
      block,
      x: Theme.pagePaddingX,
      y,
      width: availableWidth,
      height: blockHeight,
      lines,
    };

    layoutBlocks.push(layoutBlock_);
    y += blockHeight + block.style.marginBottom;
  }

  return { blocks: layoutBlocks, totalHeight: y };
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

  // Word-wrap into lines
  const lines: LayoutLine[] = [];
  let currentRuns: LayoutRun[] = [];
  let lineWidth = 0;

  for (const seg of segments) {
    // If adding this segment exceeds max width and line is not empty,
    // wrap to next line
    if (lineWidth + seg.width > maxWidth && currentRuns.length > 0) {
      lines.push({
        runs: currentRuns,
        y: 0,
        height: 0,
        width: lineWidth,
      });
      currentRuns = [];
      lineWidth = 0;
    }

    // Character-level fallback for segments wider than maxWidth
    if (seg.width > maxWidth && seg.text.length > 1) {
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
          if (lineWidth + nextWidth > maxWidth && endIdx > charIdx + 1) break;
          runWidth = nextWidth;
          endIdx++;
        }
        // If even a single char exceeds maxWidth and line is not empty, flush first
        if (lineWidth + runWidth > maxWidth && currentRuns.length > 0) {
          lines.push({ runs: currentRuns, y: 0, height: 0, width: lineWidth });
          currentRuns = [];
          lineWidth = 0;
          continue; // Re-measure from charIdx on fresh line
        }
        currentRuns.push({
          inline: block.inlines[seg.inlineIndex],
          text: seg.text.slice(charIdx, endIdx),
          x: lineWidth,
          width: runWidth,
          inlineIndex: seg.inlineIndex,
          charStart: seg.charStart + charIdx,
          charEnd: seg.charStart + endIdx,
        });
        lineWidth += runWidth;
        charIdx = endIdx;
        if (lineWidth >= maxWidth && charIdx < seg.text.length) {
          lines.push({ runs: currentRuns, y: 0, height: 0, width: lineWidth });
          currentRuns = [];
          lineWidth = 0;
        }
      }
      continue;
    }

    currentRuns.push({
      inline: block.inlines[seg.inlineIndex],
      text: seg.text,
      x: lineWidth,
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
    ctx.font = buildFont(
      inline.style.fontSize,
      inline.style.fontFamily,
      inline.style.bold,
      inline.style.italic,
    );

    // Split on word boundaries (keep spaces attached to preceding word)
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const metrics = ctx.measureText(word);
      segments.push({
        text: word,
        style: inline.style,
        width: metrics.width,
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
function getLineMaxFontSize(line: LayoutLine, block: Block): number {
  let max = 0;
  for (const run of line.runs) {
    const size = run.inline.style.fontSize ?? Theme.defaultFontSize;
    if (size > max) max = size;
  }
  if (max > 0) return max;
  if (block.inlines.length > 0 && block.inlines[0].style.fontSize) {
    return block.inlines[0].style.fontSize;
  }
  return Theme.defaultFontSize;
}

// --- Coordinate mapping ---

/**
 * Find the layout block for a given block ID.
 */
export function findLayoutBlock(
  layout: DocumentLayout,
  blockId: string,
): LayoutBlock | undefined {
  return layout.blocks.find((lb) => lb.block.id === blockId);
}

/**
 * Convert a document position (blockId + offset) to pixel coordinates.
 */
export function positionToPixel(
  layout: DocumentLayout,
  blockId: string,
  offset: number,
  ctx: CanvasRenderingContext2D,
): { x: number; y: number; height: number } | undefined {
  const lb = findLayoutBlock(layout, blockId);
  if (!lb) return undefined;

  // Walk through lines/runs to find the offset
  let charCount = 0;
  for (const line of lb.lines) {
    for (const run of line.runs) {
      const runLength = run.charEnd - run.charStart;
      if (charCount + runLength >= offset && charCount <= offset) {
        // The offset is within this run
        const localOffset = offset - charCount;
        const textBefore = run.text.slice(0, localOffset);
        ctx.font = buildFont(
          run.inline.style.fontSize,
          run.inline.style.fontFamily,
          run.inline.style.bold,
          run.inline.style.italic,
        );
        const x = lb.x + run.x + ctx.measureText(textBefore).width;
        return { x, y: lb.y + line.y, height: line.height };
      }
      charCount += runLength;
    }
  }

  // Offset is past the end — position at end of last line
  const lastLine = lb.lines[lb.lines.length - 1];
  if (lastLine && lastLine.runs.length > 0) {
    const lastRun = lastLine.runs[lastLine.runs.length - 1];
    return {
      x: lb.x + lastRun.x + lastRun.width,
      y: lb.y + lastLine.y,
      height: lastLine.height,
    };
  }

  return { x: lb.x, y: lb.y, height: lb.lines[0]?.height ?? 24 };
}

/**
 * Convert pixel coordinates to a document position.
 */
export function pixelToPosition(
  layout: DocumentLayout,
  px: number,
  py: number,
  ctx: CanvasRenderingContext2D,
): { blockId: string; offset: number } | undefined {
  if (layout.blocks.length === 0) return undefined;

  // Find the block at this Y position
  let targetBlock = layout.blocks[0];
  for (const lb of layout.blocks) {
    if (py >= lb.y) {
      targetBlock = lb;
    } else {
      break;
    }
  }

  // Find the line at this Y position within the block
  let targetLine = targetBlock.lines[0];
  for (const line of targetBlock.lines) {
    if (py >= targetBlock.y + line.y) {
      targetLine = line;
    } else {
      break;
    }
  }

  if (!targetLine || targetLine.runs.length === 0) {
    return { blockId: targetBlock.block.id, offset: 0 };
  }

  // Find character position within the line
  const localX = px - targetBlock.x;

  // Count characters before this line
  let charsBeforeLine = 0;
  for (const line of targetBlock.lines) {
    if (line === targetLine) break;
    for (const run of line.runs) {
      charsBeforeLine += run.charEnd - run.charStart;
    }
  }

  // Walk through runs to find the exact character
  let charsBeforeRun = 0;
  for (const run of targetLine.runs) {
    if (localX >= run.x && localX <= run.x + run.width) {
      // Within this run — find exact character
      ctx.font = buildFont(
        run.inline.style.fontSize,
        run.inline.style.fontFamily,
        run.inline.style.bold,
        run.inline.style.italic,
      );

      let bestOffset = 0;
      let bestDist = Infinity;
      for (let i = 0; i <= run.text.length; i++) {
        const w = ctx.measureText(run.text.slice(0, i)).width;
        const dist = Math.abs(run.x + w - localX);
        if (dist < bestDist) {
          bestDist = dist;
          bestOffset = i;
        }
      }

      return {
        blockId: targetBlock.block.id,
        offset: charsBeforeLine + charsBeforeRun + bestOffset,
      };
    }
    charsBeforeRun += run.text.length;
  }

  // Past the end of the line — position at end
  const lineCharCount = targetLine.runs.reduce(
    (sum, r) => sum + (r.charEnd - r.charStart),
    0,
  );
  return {
    blockId: targetBlock.block.id,
    offset: charsBeforeLine + lineCharCount,
  };
}
